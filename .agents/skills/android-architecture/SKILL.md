---
name: "android-architecture"
description: "The architecture every native Android app in this setup follows: Kotlin and Jetpack Compose on Google's layered guide (UI, domain, data) with MVVM and unidirectional data flow, one UiState per screen exposed as StateFlow, Gradle modules with convention plugins (core:*, feature:*), Hilt, Navigation 3, coroutines and Flow, a demo flavor with in-memory data sources, a Material 3 design system module, strings.xml i18n, and the test layout. Invoke before writing, reviewing or planning any Kotlin/Android code (app/, core/, feature/, build-logic/, *.gradle.kts), and when deciding where a new file goes. Not for Flutter (flutter-architecture), iOS (ios-architecture), React Native (react-native-architecture), Next.js/Astro (nextjs-architecture) or Fastify (fastify-architecture)."
---

# Android architecture

Reference implementation: Google's `android/nowinandroid` (its `docs/ArchitectureLearningJourney.md` and `docs/ModularizationLearningJourney.md`). This skill is that shape, cut down to what a product app needs, plus the checklist. When a project already has its own `docs/architecture.md`, that doc wins on specifics.

Kotlin, Jetpack Compose with Material 3, coroutines and Flow, Hilt, Navigation 3, Room, DataStore, Retrofit or Ktor with kotlinx.serialization, Gradle Kotlin DSL with a version catalog. `minSdk` as high as the product allows (26+ unless there is a stated reason).

## 1. Layers and the dependency rule

Three layers, as in Google's guide to app architecture, with the dependency rule pointing inward:

```
UI layer       Compose screens + a ViewModel state holder per screen   (feature:*)
Domain layer   use cases: reusable business rules, pure Kotlin         (core:domain, optional until two screens share a rule)
Data layer     repositories over data sources; the single source of truth (core:data → core:network, core:database, core:datastore)
```

Gradle modules, with shared build configuration in `build-logic/` (an included build of convention plugins, never `buildSrc`) and every version in `gradle/libs.versions.toml`:

```
app/                      composition root: Application, MainActivity, the NavDisplay, Hilt graph, flavors
build-logic/convention/   AndroidApplicationConventionPlugin, AndroidLibraryComposeConventionPlugin, AndroidFeatureConventionPlugin, …
core/
  model/                  pure Kotlin entities (User, Post); no Android, no annotations from network or database
  common/                 Result wrapper, dispatcher qualifiers, Logger port, small pure helpers
  domain/                 use cases (GetSortedFeedUseCase) over repository interfaces; pure Kotlin
  data/                   repository interfaces and implementations, DataStore-backed preferences, the FeatureFlags port, Hilt bindings
  network/                Retrofit/Ktor API + DTOs; a demo (in-memory) implementation selected by flavor
  database/               Room database, DAOs, entities; mappers to core:model live in core:data
  datastore/              Proto or Preferences DataStore for settings
  designsystem/           theme (color schemes, typography, shapes, spacing), icons, component primitives
  ui/                     composite UI two or more features share (a post card, an empty-state view); depends on designsystem and model
  testing/                fakes of every repository and data source, test rules, seeded demo data
feature/<name>/           one module per screen or embeddable surface (layout in §2)
```

Imports, enforced by the module graph (a module cannot import what its `build.gradle.kts` does not declare) and by a Konsist test for packages inside a module (§10):

| From | May depend on |
| --- | --- |
| `core:model`, `core:common` | nothing in the project (`core:common` may use `core:model`) |
| `core:domain` | `core:model`, `core:common`, `core:data` (interfaces only) |
| `core:network`, `core:database`, `core:datastore` | `core:model`, `core:common`; never each other |
| `core:data` | `core:model`, `core:common`, `core:network`, `core:database`, `core:datastore` |
| `core:designsystem` | nothing in the project |
| `core:ui` | `core:designsystem`, `core:model` |
| `feature:<f>` | `core:ui`, `core:designsystem`, `core:data` (interfaces), `core:domain`, `core:model`, `core:common`; **never another feature** |
| `app` | anything |

Vendor SDKs (Firebase, analytics, payments, maps) are wrapped in a `core:` module that exposes a port; a feature never imports a vendor package. Vendor types never cross the port: the adapter maps them to the project's own models and error types.

A small app may start as one module with the same packages (`core.model`, `core.data`, `feature.feed`): the Konsist test enforces the same table on packages, and moving a package to a module later changes no import.

## 2. A feature module

```
feature/feed/src/main/kotlin/<pkg>/feature/feed/
  navigation/FeedNavigation.kt   @Serializable data object FeedKey : NavKey, and an EntryProviderBuilder<NavKey>.feedEntry(onPostClick) extension
  FeedScreen.kt                  FeedRoute(viewModel = hiltViewModel(), onPostClick) collects state; FeedScreen(state, onEvent) is stateless
  FeedViewModel.kt               @HiltViewModel, exposes StateFlow<FeedUiState> and one function per user event
  FeedUiState.kt                 sealed interface FeedUiState { Loading; Success(posts); Error(FeedError) }
  components/                    composables used only by this feature
  feature_readme.md              purpose, exposed interface (the NavKey and the entry extension), states and errors, data flow, toggle, known gaps
feature/feed/src/test/          ViewModel tests with fakes from core:testing
feature/feed/src/screenshotTest/ (or src/test/ with Roborazzi)  one screenshot test per state
```

- File names are PascalCase after the one top-level declaration they hold (`FeedViewModel.kt` holds `FeedViewModel`; `FeedScreen.kt` holds the screen's composables), as the Kotlin coding conventions require. A file of extensions is named for what it extends (`StringExtensions.kt`).
- A feature's public surface is its `NavKey`(s) and its entry-provider extension. Other features never import its screen or ViewModel; `app` wires the keys into the back stack.
- The feature-shape rule is in the standards (Feature folders). Here a feature that only renders has no `UiState` beyond its parameters and no ViewModel; `components/` appears with the second composable of its kind, while `navigation/` holds its one file from the start, since the key and the entry extension are the public surface. Past about 15 components the surface splits into feature modules by screen or embeddable surface; `feature/` stays one level, never a module that only groups modules.

## 3. Unidirectional data flow

- **State flows down, events flow up.** A screen has one `UiState` (a sealed interface, or a data class when the states are not exclusive) exposed as `StateFlow<UiState>` from the ViewModel, built with `stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)`. Compose collects it with `collectAsStateWithLifecycle()`.
- **The ViewModel is the state holder, not a controller.** It takes use cases and repositories by constructor injection, exposes one function per user event (`onLikeClick(id)`), launches work in `viewModelScope` only from `uiState`'s `stateIn` or from an event function (never from `init`, so an instance that nobody collects does nothing), and never references `Context`, `Activity`, a `NavController` or any Compose type. One-off effects (navigate, show a snackbar) are events in the state consumed by the screen, which calls `onEventConsumed()`; no `SharedFlow` channel of effects.
- **The `Route` composable is the only stateful one.** `FeedRoute` obtains the ViewModel (`hiltViewModel()`), collects `enabled` first when the feature is toggled (§9), then inside the gate collects `uiState` and passes `state` plus lambdas into `FeedScreen`, which is stateless and previewable. Below it, composables receive data and callbacks; `remember` keeps only UI-local state (scroll, expanded).
- Composables run no side effects during composition; effects go through `LaunchedEffect(key)` with a real key, `DisposableEffect` for listeners, and `rememberCoroutineScope` for user-triggered work. `Modifier` is the first optional parameter and is applied once at the root of a composable.
- Models crossing into Compose are stable: data classes of immutable values, `kotlinx.collections.immutable` for lists, no mutable collections in state.
- Results from the data layer come as `Result<T>` (`Loading`, `Success`, `Error`) via a `Flow<T>.asResult()` extension; expected domain outcomes are a sealed `FeedError` the ViewModel maps exhaustively into state. No exception reaches a ViewModel uncaught; the unexpected ones are logged through the `Logger` port and become the feature's generic error state.

## 4. Data layer

- **Repositories are the single source of truth** and the only thing a ViewModel or use case talks to. A repository interface lives in `core:data` with its implementation; it exposes `Flow<T>` for data the UI observes and `suspend fun` for one-shot work, and takes injected dispatchers (`@Dispatcher(IO)` qualifier), never `Dispatchers.IO` inline. No `GlobalScope`, no `runBlocking` outside tests.
- **Offline-first when the data is read more than written:** the repository reads from Room and syncs from the network; the UI never waits on the network to show cached data.
- DTOs stay in `core:network`, entities in `core:database`; mappers to `core:model` live in `core:data`. A model never carries `@SerialName` or `@Entity`.
- Settings and small flags in DataStore. Credentials and tokens in a Keystore-backed store behind a `SecureStore` port, never in DataStore or `SharedPreferences`.
- Pagination through Paging 3 with a `RemoteMediator` when the list is cached; the ViewModel exposes `Flow<PagingData<T>>` and the screen uses `collectAsLazyPagingItems()`.

## 5. Dependency injection and the composition root

- Hilt, with `@HiltViewModel` + `@Inject constructor` for ViewModels and `@Binds` modules in `core:data` binding each repository interface to its implementation. Koin only when the project already uses it.
- Everything feature-specific is built by Hilt from the feature's constructors; nothing feature-specific is registered app-wide. App-wide services (logger, dispatchers, flags, analytics, the network client) are singletons provided by their `core:` module.
- `app` is the composition root: `Application` (`@HiltAndroidApp`), one `MainActivity` (`@AndroidEntryPoint`) hosting the `NavDisplay`, the back stack, the theme and the splash gate that awaits the flags (§9). Nothing else lives there.
- Flavors select the backend: `demo` binds in-memory data sources seeded with demo data (§6); `prod` binds the real ones. Build types (`debug`, `release`) stay orthogonal.

## 6. Every outside dependency has a fake

- `core:testing` holds a fake of every repository and data source, plus the seeded demo data, test dispatcher rule and Turbine helpers. ViewModel tests use these fakes, never mocks of a repository.
- The `demo` flavor wires the same in-memory data sources into the running app: that is how screens are screenshotted, how CI builds and runs instrumented tests without backend config, and what a reviewer installs. A backend that cannot work in the current build fails fast at startup with a message, not inside a vendor's init.

## 7. Navigation

- **Navigation 3** for new apps: the app owns the back stack as a `SnapshotStateList<NavKey>` (saved with `rememberNavBackStack`), renders it with `NavDisplay`, and each feature contributes an `entryProvider` extension for its keys. Keys are `@Serializable` and carry only ids, never models. `navigation-compose` 2.x (type-safe routes with `@Serializable` destinations) stays where a project already uses it; never mix the two.
- Screens navigate through lambdas handed down from `app` (`onPostClick: (PostId) -> Unit`); a feature never holds the back stack or a `NavController`. Cross-feature navigation is `app` mapping one feature's lambda to another feature's key.
- Deep links are declared in the manifest and resolved in `app` into keys; every parameter they carry is validated before use.
- Adaptive layout comes from `currentWindowAdaptiveInfo().windowSizeClass` read once in the screen and passed down; a list-detail screen uses `ListDetailPaneScaffold`. The phone layout is the base; wider classes are enhancements.

## 8. Design system and screen shell

- `core:designsystem` owns the `MaterialTheme`: light and dark `ColorScheme` (dynamic color only when the product wants it), a `Typography` on the platform font, `Shapes`, and a `Spacing` object of dp tokens exposed through a `CompositionLocal`. Features read `MaterialTheme.colorScheme`, `MaterialTheme.typography` and the spacing tokens; no raw hex, dp or sp in a feature or in `core:ui`.
- Primitives live in `core:designsystem` (`AppButton`, `AppTextField`, `AppTopBar`, `MessageView`, `FormErrorMessage`, `FeatureGate`); features compose them and never hand-roll a variant. Two features sharing a composite view means it moves to `core:ui`.
- One `ScreenScaffold` owns the top bar, the capped centred content column on wide windows, insets (`WindowInsets.safeDrawing`), snackbar host, FAB slot and a `canLeave` flag that disables back (`BackHandler`) while a submit is in flight.
- Forms stay mounted while submitting (fields read-only, progress inside the button, footer kept laid out) so a failure keeps what was typed. Failures the user fixes by retyping are inline; the unexpected ones are snackbars.
- Every interactive composable has a `contentDescription` or a text label, and a minimum 48dp touch target; a change is checked in dark mode and at a large font scale.

## 9. Copy, toggles and checks

- All copy in `res/values[-<locale>]/strings.xml`, read through `stringResource`; plurals through `pluralStringResource`. Android Lint's `HardcodedText` and `MissingTranslation` are errors in `lint.xml`, so a missing locale fails the build. Formatting that depends on locale (dates, relative time) goes through a formatter that takes the `Locale`, never a hard-coded pattern.
- Toggle keys and defaults in one `FeatureFlags` object; a `FeatureFlagsRepository` port in `core:data` with two operations: `fun flag(key: FlagKey): StateFlow<Boolean>`, seeded from the defaults, and `suspend fun load()`, the remote config or DataStore read with a short timeout. `MainActivity` keeps the splash screen on (`setKeepOnScreenCondition`) until a `StartupViewModel` has awaited `load()`, so every later read is synchronous; never `runBlocking`. The ViewModel exposes `enabled: StateFlow<Boolean> = flags.flag(key)` as its own property, never a case of the sealed `UiState`. The Route collects `enabled` first and hands the boolean to `FeatureGate`, a pure composable in `core:designsystem` that depends on nothing (so the module table in §1 holds), and collects `uiState` only inside the gate: with `WhileSubscribed` the data flow starts on first collection and §3 forbids `init` work, so a feature that is off never loads. A render-only feature with no ViewModel is gated by `app`: its entry provider reads `flags.flag(key)` and passes `enabled` into the Route. Never read a flag in a use case. A `load()` that fails keeps the defaults (off in production, per the Feature flags rule) and logs through the `Logger` port.
- Lint and format: `ktlint` (or `spotless` running it), `detekt` with the Compose rules (`io.nlopez.compose.rules`), Android Lint with `warningsAsErrors`. Size rules come from detekt's `LongMethod` (40), `LargeClass` and `TooManyFunctions`, with today's offenders in a baseline that may only shrink.

## 10. Tests

```
core/testing/                     fakes, TestDispatcherRule, seeded demo data
<module>/src/test/                unit: ViewModels (Turbine on the StateFlow, fakes injected), use cases, repositories over fake data sources, mappers
core/database/src/androidTest/    Room DAOs against an in-memory database (or Robolectric in src/test)
feature/<f>/src/screenshotTest/   Compose Preview Screenshot Testing (or Roborazzi): every UiState, light and dark, phone and tablet, at font scale 1 and 1.5
feature/<f>/src/androidTest/      Compose UI tests of a screen's behaviour with fakes (createAndroidComposeRule<HiltTestActivity>)
app/src/androidTest/              end-to-end flows against the demo flavor on a Gradle Managed Device
app/src/test/architecture/        Konsist: the package table in §1, ViewModel naming and public Flow-only state, no feature→feature import, no vendor import outside core
```

- **Unit tests** run with `kotlinx-coroutines-test` and a `MainDispatcherRule`; a ViewModel test asserts the sequence of states with Turbine, never internals. A test that needs no Android class runs on the JVM; Robolectric only where a resource or a DAO is involved.
- **Screenshot tests are the two-viewport rule here.** Each screen state has a preview test at a phone (`Pixel 8`) and a tablet (`Pixel Tablet`) device spec, light and dark, in every shipped locale, reference images committed; a changed screen updates its references in the same PR and the diff is reviewed. These are the screenshots the UI rule asks for; the fallback is a run on an emulator with the `demo` flavor captured by `adb exec-out screencap`, named `<screen>-<device>-<locale>`.
- **End-to-end** is a small set of instrumented flows (`smoke` test suite: launch → sign-in → home; one class per critical flow) on a Gradle Managed Device (`pixel8Api35`) against the demo flavor, in every shipped locale (set the per-app language with `AppCompatDelegate.setApplicationLocales` at the start of the test, and assert on strings read from that locale's resources). Spinners never settle on their own: use `waitUntil { onAllNodesWithTag(...).fetchSemanticsNodes().isNotEmpty() }`, never `Thread.sleep`.
- **CI tiers.** Fast, on every PR: `./gradlew spotlessCheck detekt lint testDemoDebugUnitTest validateDemoDebugScreenshotTest assembleDemoDebug` (Linux runner, Gradle cache). Full, on a `v*` tag, the weekly run and manual runs: the managed-device instrumented suite (`./gradlew pixel8Api35DemoDebugAndroidTest`), on a Linux runner with KVM (`ubuntu-latest` supports it with `enableKvm`); it opens an issue when red. Emulator minutes stay out of the PR tier.

Before reporting work done: `./gradlew spotlessCheck detekt lint`, the unit tests of every module touched, the screenshot verification task (updating references when the change is intentional), `assembleDemoDebug`, the instrumented flows the change touches, and screenshots at phone and tablet, light and dark, for every state and locale the change touches.

## 11. Adding a feature

1. `feature/<name>/` from the `AndroidFeatureConventionPlugin`; add it to `settings.gradle.kts` and as a dependency of `app`.
2. `<Name>UiState.kt`: a sealed interface with one subtype per state the UI tells apart; a sealed `<Name>Error` if the feature has expected failures.
3. The repository interface in `core:data` if the data is new (returning `Flow`/`suspend`), its implementation, a fake in `core:testing`, and the `demo` binding.
4. `<Name>ViewModel.kt`: `@HiltViewModel`, state through `stateIn`, one function per event, exhaustive `when` over errors.
5. `<Name>Screen.kt`: `<Name>Route` (stateful) and `<Name>Screen` (stateless) inside `ScreenScaffold`, composing `core:designsystem`; copy in every `strings.xml`; a `@Preview` per state.
6. `navigation/<Name>Navigation.kt`: the `NavKey` and the entry-provider extension; wire it in `app`. If toggled, add the key to `FeatureFlags`, expose `enabled` on the ViewModel and gate the Route as §9 says.
7. Tests from §10: ViewModel, screenshot per state, the flow if it is critical. Add `feature_readme.md`.

## 12. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| A ViewModel holding a `Context`, `NavController` or Compose state | State out as `StateFlow`, events in as functions; navigation is a lambda the screen receives from `app` |
| `collectAsState()` on a `StateFlow` | `collectAsStateWithLifecycle()`, so collection stops in the background |
| A `Channel`/`SharedFlow` of one-shot effects | An event field in the `UiState`, consumed by the screen through `onEventConsumed()` |
| `Dispatchers.IO` written inline in a repository | An injected `CoroutineDispatcher` qualified with `@Dispatcher(IO)` |
| `LaunchedEffect(Unit)` reacting to state | A real key, or `snapshotFlow` of the value it reacts to |
| A screen composable that calls `hiltViewModel()` below the route | The `Route` takes the ViewModel; everything under it is stateless and previewable |
| `List<Post>` in a `UiState` data class | `ImmutableList<Post>` (`kotlinx.collections.immutable`), so Compose can skip |
| A feature module depending on another feature | Each exposes a `NavKey`; `app` wires the lambda to the key |
| DTO annotated with `@Entity` and shown in the UI | Three types: DTO (network), entity (database), model (`core:model`); mappers in `core:data` |
| `SharedPreferences` for a token | A Keystore-backed `SecureStore` port; DataStore for ordinary settings |
| A string literal in a composable | `stringResource(R.string.key)`; `HardcodedText` is an error |
| `Thread.sleep` in a UI test | `waitUntil` on a semantics node; a `testTag` on the thing waited for |
| A flag read in the ViewModel and again in the screen | The ViewModel's `enabled` flow, collected once by the Route and handed to `FeatureGate` |
| Screenshot references updated without review | The image diff is part of the PR review; an unintended change is a bug |

## Checklist for a review brief

Copy into the brief of every review pass for Android work:

1. Module dependencies and packages respect the table in §1; the Konsist test is green; no feature imports another feature; no vendor package outside its `core:` wrapper.
2. One `UiState` per screen as `StateFlow` with `stateIn(WhileSubscribed)`; the Route is the only stateful composable; the screen is stateless and previewable; state models are immutable.
3. The ViewModel references no Android framework, Compose or navigation type; one function per event; errors mapped exhaustively; one-shot effects consumed through the state.
4. Repositories are the single source of truth, expose `Flow`/`suspend`, take injected dispatchers; DTO, entity and model are separate types.
5. Navigation keys are `@Serializable` ids, exposed through the feature's entry extension; screens get lambdas, never the back stack.
6. No raw hex, dp or sp outside `core:designsystem`; new UI composes its primitives; `ScreenScaffold` owns insets and back-blocking; 48dp targets and content descriptions present.
7. Every `strings.xml` updated; `HardcodedText` and `MissingTranslation` are errors and the lint is green.
8. Toggles read once, as the ViewModel's `enabled` flow collected by the Route before `uiState`, and applied through `FeatureGate`.
9. Tests follow §10: ViewModel states through Turbine with fakes; screenshot tests per state at phone and tablet, light and dark, every locale, references reviewed; a changed critical flow has its instrumented test run on the managed device, with screenshots linked.
10. Files ~300 lines, functions ~40 (detekt `LongMethod`), composables ~200, counting no blanks or comments; `ktlint`, `detekt` and Android Lint green with no new baseline entries.
11. File names PascalCase after the one top-level declaration; test files `<Name>Test.kt`.
12. The feature-shape rule in the standards holds: `components/` only from the second composable, a split into feature modules past ~15 components, `feature/` one level deep.
