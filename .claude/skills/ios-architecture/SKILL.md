---
name: "ios-architecture"
description: "The architecture every native iOS app in this setup follows: Swift 6 with strict concurrency and SwiftUI, MVVM with @Observable view models and unidirectional data flow, one State enum per screen, clean layers as local Swift packages (Abstractions, Core, Application, Features, Integrations) whose target graph enforces the dependency rule, initializer injection with a Feature composition root, typed throws for failures, NavigationStack with typed routes, an in-memory backend for previews and UI tests, a token-based design system, String Catalogs, and the test layout (Swift Testing, snapshot tests, XCUITest). Invoke before writing, reviewing or planning any Swift/iOS code (*.swift, Package.swift, *.xcodeproj, *.xctestplan), and when deciding where a new file goes. Not for Flutter (flutter-architecture), Android (android-architecture), React Native (react-native-architecture), Next.js/Astro (nextjs-architecture) or Fastify (fastify-architecture)."
---

# iOS architecture

Reference shape: the same layers as the `flutter-architecture` skill, expressed as Swift packages, so a feature looks the same across the mobile stacks. When a project already has its own `docs/architecture.md`, that doc wins on specifics; this skill is the default shape and the checklist.

Swift 6 language mode with strict concurrency, SwiftUI, `async/await`, Swift Package Manager for modules, Swift Testing for unit tests, XCTest only for UI tests. Deployment target iOS 17 or later (needed for `@Observable`); Xcode's current release. New targets keep Xcode 26's default of `MainActor` as the default actor isolation ("approachable concurrency") and mark CPU-bound work `@concurrent`.

## 1. Layers and the dependency rule

```
App/                              the Xcode app target: @main App, AppDependencies (the container), the root NavigationStack, environment injection; nothing else
Packages/
  Abstractions/                   ports with no app dependencies: AuthClient, DataRemoteClient, SecureStore, FeatureConfig, Logger, Failure
  Core/                           entities and ports two or more features need (User, Post, UserSessionRepository); no DTO and no mapper, which live in the integration that produces them (§6)
  Application/                    app shell: theme tokens and components (DesignSystem), ScreenShell, FeatureFlags, I18n helpers, shared views
  Features/<Feature>/             one package (or one target in a Features package) per screen or embeddable surface (layout in §2)
  Integrations/<Vendor>/          adapters: Firebase/, Keychain/, URLSessionAPI/, InMemory/
```

Imports, enforced by the package graph (a target cannot `import` a module its `Package.swift` does not list as a dependency) and by a test that scans `import` lines (§11):

| From | May import (inside the project) |
| --- | --- |
| `Abstractions` | nothing in the project |
| `Core` | `Abstractions` |
| `Features/<F>` | `Abstractions`, `Core`, `Application`, and another feature **only** through its `<G>Feature` type |
| `Application` | `Abstractions`, `Core` |
| `Integrations/<V>` | `Abstractions`, `Core`, and the vendor SDK |
| `App` | anything |

Vendor SDKs (Firebase, analytics, payments, maps) are imported only under `Integrations/` and in `App`. Vendor types never cross a port: the adapter maps them to the port's own error (`AuthClientError.invalidCredentials`). Foundation, SwiftUI and Swift standard packages are allowed everywhere; a third-party architecture library (TCA, Factory, Swinject) is not part of this shape and is adopted only by a project that already uses it.

## 2. A feature package

```
Packages/Features/Feed/Sources/Feed/
  FeedFeature.swift                composition root (§3)
  Domain/
    FeedRepository.swift           the port this feature needs (protocol, Sendable)
    SortedFeedUseCase.swift        protocol + one implementation named by what it does
    FeedError.swift                enum FeedError: Error, one case per outcome the UI tells apart, plus .unexpected
  Data/
    FeedRemoteRepository.swift     adapter over an Abstractions port; maps errors to FeedError, logs only the unexpected
  Presentation/
    FeedViewModel.swift            @MainActor @Observable final class; enum State; one method per user intent
    FeedView.swift                 the screen: switch over state; composes Application's ScreenShell and components
    Components/                    views used only by this feature
  feature_readme.md                purpose, exposed interface, states and errors, data flow, toggle, known gaps
Packages/Features/Feed/Tests/FeedTests/
```

- File names are PascalCase after the one primary type they hold (`FeedViewModel.swift`), one type per file; an extension file is `Post+Formatting.swift`. SwiftLint's `file_name` rule enforces it.
- A feature's public surface is its `<Name>Feature` type (§3) and its route value. Other features never import its views, view models or repositories.
- The feature-shape rule is in the standards (Feature folders). Here `Domain/`, `Data/` and `Presentation/` appear when they have content (a feature with no rules of its own has no `UseCase`; one that only renders has no `Data/`), and `Components/` appears with the second view of its kind; Swift targets are the lint element types, so flat files need no mapping. A split looks like `Feed/Timeline`, `Feed/Composer`, each a target with its own `<Name>Feature` type, composed by the parent's.

## 3. The Feature type is the composition root

```swift
public struct FeedFeature {
    private let dependencies: any FeedDependencies     // the narrow protocol this feature needs, not the whole container
    public init(dependencies: any FeedDependencies) { self.dependencies = dependencies }

    @MainActor public func makeView(onPostSelected: @escaping (Post.ID) -> Void) -> some View {
        FeedView(viewModel: makeViewModel(), onPostSelected: onPostSelected)
    }
    @MainActor private func makeViewModel() -> FeedViewModel {
        FeedViewModel(useCase: SortedFeedUseCase(repository: FeedRemoteRepository(client: dependencies.dataRemoteClient)))
    }
}
```

- Initializer injection everywhere; no service locator, no DI framework. `App` builds one `AppDependencies` container of app-wide services (logger, flags, auth and data clients, session, secure store) and hands each feature the narrow protocol it declares (`FeedDependencies`), never the whole container.
- Everything feature-specific (repository, use case, view model) is built in the Feature type and nowhere else. A view owns its view model with `@State private var viewModel`, created by the feature's factory.
- Cross-feature access goes only through the other Feature type: its `makeView(...)` as a view, its route as a value. Never import another feature's `Domain/`, `Data/` or `Presentation/`. A view model never imports its own feature's composition root.

## 4. State, intents and concurrency

- **One `State` enum per screen** (`idle`, `loading`, `loaded(items)`, `failed(FeedError)`), owned by the view model and rendered with an exhaustive `switch`. A state that carries data carries it as an associated value. Non-exclusive UI facts (a draft, a toggle) are separate stored properties, not enum cases.
- **The view sends intents, the view model owns the state.** One method per user intent (`func likeTapped(_ id: Post.ID) async`); the view calls it from `.task(id:)` or an action closure. The view model never imports SwiftUI beyond `Observation`, never touches navigation and never reads the environment.
- Views are declarative and thin: no business decisions in a `body`, no network calls, no formatting logic beyond what a `FormatStyle` provides. A view with only local UI state uses `@State` and has no view model.
- **Concurrency:** view models and views are `@MainActor`; repositories and clients are `Sendable` and do their work off the main actor (`@concurrent` or an `actor` for shared mutable state). Streams are `AsyncSequence`. No `DispatchQueue`, completion handlers or `Combine` in new code; no `Task.detached`; a `Task` that outlives a view is owned by the view model and cancelled in `deinit` or on the next intent.
- **Failures are typed:** repositories and use cases use typed throws (`func posts() async throws(FeedError) -> [Post]`). Expected failures (wrong password, email taken) map to a case without logging; everything else is logged through the `Logger` port and becomes `.unexpected`. A failure the user can fix by retyping renders inline; the unexpected one renders as a toast or alert through `ScreenShell`.
- Optimistic updates set the hoped-for value in a `sending` state and roll back to the previous value on failure.

## 5. Navigation

- A `NavigationStack` per flow with a typed path: `enum Route: Hashable` per feature, a `@MainActor @Observable final class Router` owned by the flow's host in `App` (or by the feature that owns the flow). Views emit navigation through closures (`onPostSelected`) that the host maps to `router.push(.postDetail(id))`; a view never constructs another feature's view.
- Modal presentation (`sheet`, `fullScreenCover`) binds to an optional route value on the router, never to a `Bool` per sheet.
- Deep links and Universal Links are parsed in `App` into route values; every parameter is validated before use.
- Adaptive layout reads `horizontalSizeClass` once at the screen and passes the answer down; `NavigationSplitView` for list-detail on iPad. The iPhone layout is the base; iPad and landscape are enhancements.

## 6. Data, persistence and secrets

- Remote calls go through an `Abstractions` port (`DataRemoteClient`) implemented in `Integrations/URLSessionAPI` with `URLSession` and `Codable` DTOs; DTOs stay in the integration and are mapped to `Core` entities. An entity never carries a `CodingKeys` of the wire format.
- Local persistence (SwiftData on iOS 17+, or GRDB) sits behind a repository protocol; the model context never reaches a view model.
- Tokens and credentials in the Keychain through the `SecureStore` port (`Integrations/Keychain`); `UserDefaults` only for non-sensitive preferences, also behind a port. No secret in `Info.plist`, a bundled config or source. App Transport Security stays on; no exception domains without a stated reason.

## 7. Toggles

- Keys and defaults in one `FeatureFlags` enum under `Application`; the strings match the remote configuration. Read through the `FeatureConfig` port.
- Checked at the feature's entry view through a `FeatureGate` view (hides the child, or hands the value to a builder), never deep in a view model or use case. When the surrounding layout depends on the flag, the host reads it once and passes the answer down. A read that fails keeps the feature off and logs.

## 8. Every outside dependency has a fake

`Integrations/InMemory` implements every port in process, seeded with demo data, selected by a launch argument (`-IN_MEMORY_BACKEND YES`) or the `Demo` scheme. That is how previews render every state, how the UI tests run with no network, how CI builds without vendor config, and what a reviewer installs. A backend that cannot work in the current build fails fast in `AppDependencies` with a message, not inside a vendor's init.

## 9. Design system and screen shell

- `Application/DesignSystem`: semantic colours as asset-catalog colour sets with light and dark variants exposed as `Color.Tokens`, `Spacing` and `Radius` as `CGFloat` constants, typography through Dynamic Type text styles (`.body`, `.headline`), SF Symbols for icons. Features read the tokens; no raw hex, point values or font sizes in a feature.
- Primitives live in `Application` (`PrimaryButton`, `FormField`, `FormErrorMessage`, `MessageView`, `InitialAvatar`, `FeatureGate`); features compose them and never hand-roll a variant. A view style used by two features is a `ButtonStyle`/`ViewModifier` in `Application`, not a copied modifier chain.
- One `ScreenShell` owns the navigation bar configuration, the capped centred column on wide widths (forms 400pt, content 600pt), safe areas, keyboard avoidance, the toast host, and a `canLeave` flag that disables the back button and interactive pop while a submit is in flight.
- Forms stay mounted while submitting (fields disabled, progress inside the button, footer kept laid out but hidden) so a failure keeps what was typed.
- Every control has an accessibility label, 44pt minimum targets, and renders at the `.accessibility3` content size without clipping; every screen is checked in dark mode.

## 10. Copy

- All copy in `Localizable.xcstrings` (String Catalogs), read through `String(localized:)` or `LocalizedStringKey` with dotted keys (`feed.empty.title`); plurals and arguments through the catalog, never string concatenation. Every shipped language has real translations.
- A test parses the catalog and fails on a key missing any shipped locale, on a key used in source that is not in the catalog, and on a catalog key no source uses.
- Formatters that depend on locale (`Date.FormatStyle`, `RelativeDateTimeFormatter`) take the `Locale` from the environment at the view and pass it down; a view model never reads the environment.

## 11. Tests and checks

```
Packages/<Module>/Tests/           Swift Testing (@Test, #expect): view models with fakes (state sequences), use cases, repositories over the in-memory adapters, mappers, the i18n catalog test
Packages/Application/Tests/        ScreenShell and primitives: snapshot tests at iPhone and iPad, light and dark, default and .accessibility3 size
Packages/Features/<F>/Tests/       one snapshot test per State, iPhone and iPad, light and dark, every shipped locale (swift-snapshot-testing, references committed)
AppUITests/                        XCUITest end-to-end flows against the in-memory backend: Smoke (launch → sign-in → home) and one class per critical flow, each run on an iPhone and an iPad simulator, every locale
Tests/Architecture/                a test that scans import lines against the table in §1 and vendor imports outside Integrations/
App.xctestplan, Smoke.xctestplan   the full and the fast tier
```

- **Unit tests** are Swift Testing, `@MainActor` where the subject is; a view model test drives intents and asserts the sequence of states, never private state. Fakes come from the in-memory adapters or a `TestSupport` target, never a mocking framework.
- **Snapshot tests are the two-viewport rule here.** Each screen state is recorded with `swift-snapshot-testing` at `.iPhone13` and `.iPadPro11` layouts, light and dark, in every shipped locale (inject the locale through the environment), references committed; a changed screen updates its references in the same PR and the image diff is reviewed. These are the screenshots the UI rule asks for; the fallback is `xcrun simctl io booted screenshot` against the `Demo` scheme, named `<screen>-<device>-<locale>`.
- **End-to-end** is XCUITest, kept to the critical flows, launched with `-IN_MEMORY_BACKEND YES -AppleLanguages (es) -AppleLocale es_ES` per locale. Spinners never settle: wait with `XCTNSPredicateExpectation`/`waitForExistence(timeout:)` on an accessibility identifier, never `sleep`. Each flow attaches screenshots (`XCTAttachment(screenshot:)`, `.keepAlways`) named `<screen>-<device>-<locale>`; they are the screenshots linked in the PR.
- **Lint and format:** `swiftlint --strict` with `file_length` (300), `function_body_length` (40), `type_body_length`, `file_name` and `force_cast`/`force_try` as errors, a baseline for today's offenders that may only shrink; `swiftformat --lint`. Never a disable comment to get past them.
- **CI tiers, and the macOS multiplier.** GitHub's macOS runners bill at ten times the Linux rate against the shared minutes budget, so the PR tier is the smallest run that proves the build: `swiftlint`, `swiftformat --lint`, `xcodebuild build-for-testing` once, then `test-without-building -testPlan Smoke` on one iPhone simulator (unit, snapshot and the smoke UI flow). The full plan (every UI flow, both simulators, every locale) runs on a `v*` tag, the weekly run and manual runs, and opens an issue when red. Cache DerivedData and SwiftPM.

Before reporting work done: `swiftformat --lint`, `swiftlint --strict`, the unit and snapshot tests of every package touched (updating references when the change is intentional), the UI flows the change touches on an iPhone and an iPad simulator, a `Demo` build, and screenshots at iPhone and iPad, light and dark, for every state and locale the change touches.

## 12. Adding a feature

1. `Packages/Features/<Name>/` with `Package.swift` depending on `Abstractions`, `Core`, `Application`; add it to the workspace and to `App`.
2. `Domain/<Name>Error.swift`: `enum <Name>Error: Error` with one case per outcome plus `.unexpected`.
3. `Domain/<Name>Repository.swift`: the port, `Sendable`, typed throws.
4. `Data/<Name>RemoteRepository.swift`: implement it on an `Abstractions` port; map errors, log the unexpected. Seed the in-memory adapter.
5. `Presentation/<Name>ViewModel.swift`: `@MainActor @Observable`, `enum State`, one method per intent, exhaustive mapping of the error.
6. `Presentation/<Name>View.swift`: `switch` over the state inside `ScreenShell`, composing `Application`'s primitives; keys added to the String Catalog for every locale; a `#Preview` per state on the in-memory backend.
7. `<Name>Feature.swift` with `init(dependencies:)` and `makeView(...)`; declare the narrow `<Name>Dependencies` protocol. Add `feature_readme.md`.
8. Add the route to the owning flow's `Route` enum and wire it in `App`; link from another feature by passing a closure. If toggled, add the key to `FeatureFlags` and gate the entry view.
9. Tests from §11: view model states, a snapshot per state, the UI flow if it is critical, the catalog test green.

## 13. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| `ObservableObject` + `@Published` + `@StateObject` in new code | `@Observable` with `@State` ownership; `@Bindable` where a binding is needed |
| A view model importing SwiftUI and holding a `NavigationPath` | Closures out of the view; the host's `Router` owns the path |
| A singleton (`Service.shared`) read inside a feature | A port on the feature's narrow dependencies protocol, injected in the Feature type |
| `Task {}` fired in `onAppear` | `.task(id:)`, which cancels on disappear and reruns on the id |
| `Task.detached` to "get off the main thread" | `@concurrent` on the function, or an `actor` owning the state |
| `try?` swallowing a repository error | Typed throws mapped to the feature's error enum; `.unexpected` logged |
| A `Bool` per sheet (`showingDetail`, `showingEditor`) | One optional route value the sheet binds to |
| A `ProgressView` replacing the form while submitting | Fields disabled, progress in the button; the draft survives a failure |
| `Color(hex:)` or `.padding(13)` in a feature | `Color.Tokens.*`, `Spacing.*`; a new value is a `designer` decision |
| `"Sign in"` literal in a view | A catalog key; the catalog test fails on a missing locale |
| A feature importing `FirebaseAuth` | The `AuthClient` port; the adapter lives in `Integrations/Firebase` |
| A `Codable` entity with wire `CodingKeys` in `Core` | A DTO in the integration, mapped to the entity |
| `sleep(2)` in a UI test | `waitForExistence(timeout:)` on an accessibility identifier |
| Snapshot references replaced wholesale "to make CI green" | Each changed image reviewed as part of the PR; an unintended change is a bug |

## Checklist for a review brief

Copy into the brief of every review pass for iOS work:

1. Every `import` respects the table in §1 (the architecture test is green); vendor SDKs only under `Integrations/` and `App`.
2. Each feature has a `<Name>Feature` composition root with a narrow dependencies protocol and a `feature_readme.md` that matches it; no singleton or service locator.
3. One `State` enum per screen in an `@MainActor @Observable` view model that imports no SwiftUI, owns no navigation and reads no environment; views switch exhaustively; intents are methods.
4. Repositories and use cases are `Sendable` with typed throws over the feature's error enum; the unexpected is logged; work runs off the main actor; no `DispatchQueue`, completion handlers or `Task.detached`.
5. Navigation is a typed `Route` on a `Router` owned by the host; views emit closures; sheets bind to optional route values; deep-link parameters validated.
6. Toggles checked at the entry view through `FeatureGate`, read once per screen.
7. No raw hex, points or font sizes outside `Application/DesignSystem`; new UI composes `Application`'s primitives; `ScreenShell` owns safe areas, keyboard and back-blocking; 44pt targets, accessibility labels, Dynamic Type and dark mode checked.
8. String Catalog updated for every locale; the catalog test is green.
9. Forms keep input across a failed submit; back is blocked while submitting.
10. Tests follow §11: view model state sequences with fakes; a snapshot per state at iPhone and iPad, light and dark, every locale, references reviewed; a changed critical flow has its XCUITest run on both simulators with screenshots linked.
11. Files ~300 lines, functions ~40, views ~200, counting no blanks or comments; `swiftlint --strict` and `swiftformat --lint` green with no new baseline entries.
12. File names PascalCase after the primary type, one type per file; `file_name` lint on.
13. The feature-shape rule in the standards holds: `Components/` only from the second view, a split by sub-feature past ~15 files per layer folder, no module folders over `Features/`.
