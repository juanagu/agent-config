---
name: "flutter-architecture"
description: "The architecture every Flutter app in this setup follows: layers and the dependency rule, feature folders with a composition-root Feature class, ports in abstractions/ with vendor and in-memory adapters, Either results and sealed states, toggles at the entry widget, a token-based theme and one page shell, strict i18n, and the test layout. Invoke before writing, reviewing or planning any Dart/Flutter code (lib/, test/, pubspec.yaml), and when deciding where a new file goes. Not for Next.js/Astro (nextjs-architecture), Fastify (fastify-architecture), native Android (android-architecture), native iOS (ios-architecture) or React Native (react-native-architecture)."
---

# Flutter architecture

Reference implementation: `juanagu/flutter-clean-architecture-medium` (`docs/architecture.md` there has the diagrams and a sign-in sequence). When a project already has its own `docs/architecture.md`, that doc wins on specifics; this skill is the default shape and the checklist.

## 1. Layers and the dependency rule

```
lib/
  main.dart                 binding, injector registration, vendor init, error forwarding, runApp
  src/
    abstractions/           ports with no app dependencies: AuthClient, DataRemoteClient, FeatureConfig, Injector, Logger, Failure
    core/domain/            entities and ports two or more features need (Tweet, User, UserSessionRepository); no storage or wire shape
    core/data/              their data models and mappers (TweetDocument); imported only by integrations/ and a feature's data/
    application/            app shell: MaterialApp + routes, theme/ (tokens, color schemes, text theme, component themes), I18n, FeatureFlags, PageContainer, widgets/
    features/<feature>/     one folder per screen or embeddable widget (layout in §2)
    integrations/<vendor>/  adapters: firebase/, in_memory/, local/, get_it/, timeago/
    ioc/                    IocManager: binds every port to an adapter per backend
```

Imports, checked by a test in the repo (see §9):

| From | May import (inside `package:app`) |
| --- | --- |
| `abstractions/` | `abstractions/` only |
| `core/domain/` | `abstractions/`, `core/domain/` |
| `core/data/` | `abstractions/`, `core/` |
| `features/<f>/` | `abstractions/`, `core/domain/`, `application/`, its own folder, `core/data/` from its own `data/` only, and other features **only** through `features/<g>/<g>_feature.dart` |
| `application/` | `abstractions/`, `core/domain/`, `application/`, and `features/<g>/<g>_feature.dart` (to register routes) |
| `integrations/` | `abstractions/`, `core/`, `integrations/` |
| `ioc/`, `main.dart` | anything |

Vendor packages (`firebase_*`, `cloud_firestore`, `get_it`, `timeago`, any SDK) are imported only under `integrations/` and in `main.dart`. `flutter_bloc` and `dartz` are allowed everywhere below `application/`. Vendor types never cross a port: the adapter maps them to the port's own exception and codes (`AuthClientException(AuthErrorCode.invalidCredentials)`).

## 2. A feature folder

```
features/tweet_feed/
  tweet_feed_feature.dart    composition root (§3)
  domain/
    repositories/            the ports this feature needs (abstract classes)
    use_cases/               interface + one implementation named by what it does (SortedTweetFeedUseCase, never V1)
    failures/                sealed class XFailure extends Failure; one const subclass per outcome the UI tells apart
    entities/                only when the feature has its own (TweetDraft)
  data/remote/               adapters over the abstractions ports; map exceptions to failures, log only the unexpected
  presentation/
    cubits/                  XCubit + sealed XState (one file each); an exhaustive switch maps failure → state
    pages/ widgets/          compose PageContainer and application/widgets; copy via I18n.of(context).translate
    mappers/ models/         presentation models only when the UI needs more than the entity
  feature_readme.md          purpose, exposed interface, states and failures, data flow, toggle, known gaps
```

File and folder names are snake_case (`tweet_feed_cubit.dart` holds `TweetFeedCubit`), as Effective Dart requires; the `file_names` lint in `flutter_lints` enforces it, so never disable it.

The feature-shape rule is in the standards (Feature folders). Here `domain/`, `data/` and `presentation/` appear when they have content (a feature with no rules of its own has no use case; one that only renders has no `data/`), and every subfolder the tree above shows (`failures/`, `repositories/`, `use_cases/`, `entities/`, `remote/`, `cubits/`, `pages/`, `widgets/`, `mappers/`, `models/`) appears with the second file of its kind, the tree being a feature at full size: a small feature is `<f>_feature.dart`, `domain/<f>_failure.dart`, `domain/<f>_repository.dart`, `data/<f>_remote_repository.dart`, `presentation/<f>_state.dart`, `presentation/<f>_cubit.dart`, `presentation/<f>_page.dart`; the architecture test keys on the three layer folders, so flat files need no extra mapping. A split looks like `tweet_feed/timeline/`, `tweet_feed/composer/`, each with its own Feature class, composed by the parent's.

## 3. The Feature class is the composition root

```dart
class TweetFeedFeature {
  static const String route = '/feed';                       // only for routed features
  static Map<String, WidgetBuilder> generateRoutes() => {route: (_) => TweetFeedFeature().buildPage()};
  static Future<void> navigate(BuildContext context) => Navigator.of(context).pushNamed(route);

  Widget build() => TweetFeedComponent(createCubit: _provideCubit, likeActionBuilder: TweetLikeFeature().build);

  TweetFeedCubit _provideCubit() { final injector = Injector.instance; return TweetFeedCubit(useCase: _provideUseCase(injector), ...); }
  TweetFeedUseCase _provideUseCase(Injector injector) => SortedTweetFeedUseCase(repository: _provideRepository(injector), sorter: ...);
  TweetFeedRepository _provideRepository(Injector injector) => TweetFeedRemoteRepository(dataRemoteClient: injector.resolve<DataRemoteClient>());
}
```

- App-wide services (logger, flags, auth and data clients, session, formatters) come from `Injector.instance`. Everything feature-specific (repository, use case, cubit) is built here, never registered globally.
- Widgets receive a `createCubit` factory and own the `BlocProvider`; a row widget that must survive list updates keeps its cubit in a `State` and feeds newer data through a `sync` method.
- Cross-feature access goes only through another feature's class: its `navigate` as a callback, its `build*()` as a widget. Never import another feature's `data/`, `domain/` or `presentation/`. A cubit never imports its own feature's composition root (put shared constants such as flag keys in `application/`).

## 4. Results, failures and state

- Repositories and use cases return `Future<Either<XFailure, T>>`, with `Unit` when nothing comes back. Streams deliver errors on the stream.
- Expected failures (wrong password, email taken) are mapped without logging; everything else is logged through the `Logger` port and becomes the feature's unexpected failure.
- States and failures are `sealed class` hierarchies matched with `switch`; no generated unions. A state that carries data carries it as a field (`TweetFeedFound(items)`).
- A cubit owns its subscriptions: `close()` cancels; a restart cancels synchronously before listening again; `emit` is guarded by `isClosed` in async callbacks. A cubit takes a clock, a flag source or a formatter through a port, never from the widget tree.
- Optimistic updates emit the hoped-for value in a `Sending` state and roll back to the previous one on `Left`.

## 5. Toggles

- Keys and defaults in one `FeatureFlags` module under `application/`; the strings match the remote configuration.
- Checked at the feature's entry widget through `FeatureGate` (child form hides, builder form hands the value to the layout), never deep in business logic. When the surrounding layout depends on the flag too, the host reads it once and passes the answer down.
- A read that fails keeps the feature off and logs; the remote adapter falls back to the defaults.

## 6. Every outside dependency has a fake

`integrations/in_memory/` implements every port in process, seeded with demo data, selected by a compile-time define (`--dart-define=IN_MEMORY_BACKEND=true`). That is how the UI is screenshotted, how CI builds without vendor config, and how repositories get integration tests with no network. A backend that cannot work on the current platform fails fast in `IocManager.register()` with a message, instead of crashing inside the vendor's init.

## 7. Design system and page shell

- `application/theme/`: explicit light and dark `ColorScheme`, a `TextTheme` on the platform font, spacing and radii tokens, component themes. Widgets read `Theme.of(context)` and the tokens; no raw hex or dp in features or shared widgets.
- One `PageContainer` owns the app bar row, the capped centred column (forms 400, content 600), hairline column edges on wide viewports, safe areas, FAB alignment and a `canLeave` flag that greys the leading icon and blocks back while a submit is in flight.
- Shared widgets (`EmailPasswordForm`, `FormErrorMessage`, `MessageView`, `PillButton`, `InitialAvatar`, `FeatureGate`, `showTranslatedSnackBar`) live in `application/widgets/`; features compose them and never hand-roll a variant.
- Forms stay mounted while submitting (read-only fields, progress inside the button, footer kept laid out but invisible) so a failure keeps what was typed. Failures the user fixes by retyping are inline blocks; the unexpected ones are snackbars.
- A list that sets its own `padding` adds `MediaQuery.paddingOf(context).bottom` back. A page without an app bar sits in a `SafeArea`.

## 8. Copy

- Dotted keys in `assets/i18n/<lang>.json`, read through `I18n.of(context).translate('feature.key')`, every shipped language with real translations. A missing key renders as the key so the gap is visible.
- A test enforces identical key sets across dictionaries, that every key used in `lib/` exists, and that every key is used.
- Formatters that depend on language (relative time) take the language code as a parameter from the widget that has a context; they never read the widget tree themselves.

## 9. Tests and checks

```
test/
  support/              fakes (RecordingLogger, MapFeatureConfig, fixed repositories, makeTweet) and pumpLocalized (390x844, shipped theme, real dictionaries)
  architecture/         dependency_rule_test.dart: scans lib/ imports against §1, `core/data/` allowed only from a feature's `data/`, and fails with the offending lines
  application/          i18n parity, validators, page shell at 390/768/1280, shared widgets
  core/                 entities (domain/) and the document mappers (data/)
  features/<f>/         cubits with expectLater(cubit.stream, emitsInOrder(...)), use cases, repositories against the in-memory adapters, widget tests of each state
  integrations/         the in-memory adapters
integration_test/
  smoke_test.dart       the fast tier: entry → sign-in → home at a phone window, in the default locale
  <flow>_test.dart      one file per critical flow (sign-in and sign-up, feed and like, compose, toggles off), each at both windows and every locale
  support/              pumpUntil(tester, finder), signInAsDemo(tester), setLocale(tester, 'es'), takeScreenshot(binding, name)
test_driver/
  integration_test.dart integrationDriver(onScreenshot: writes screenshots/<name>.png)
```

### End-to-end with `integration_test`

The SDK's `integration_test` package runs real widget tests inside the running app, on a device, an emulator or a browser. It is the Flutter equivalent of the Playwright tier and follows the same rules: critical flows only, at least a phone window and a desktop one, every shipped locale, a smoke set on every PR and the full set on release.

- **Backend:** always the in-memory one (`--dart-define=IN_MEMORY_BACKEND=true`), seeded with the demo account and tweets, so the flows are deterministic and CI needs no vendor config. A flow that must prove the real boundary is a manual signed-in pass on a device with the Firebase files, reported with what was seen.
- **Web, which is what CI runs:** `chromedriver --port=4444` in the background, then
  `flutter drive -d web-server --browser-name=chrome --browser-dimension=390,844 --driver=test_driver/integration_test.dart --target=integration_test/smoke_test.dart --dart-define=IN_MEMORY_BACKEND=true`.
  `--browser-dimension` is how the phone window is set; run the same target again with `1280,800` for desktop. Headless is the default on `web-server`.
- **Device or emulator:** `flutter test integration_test --dart-define=IN_MEMORY_BACKEND=true -d <device id>`; the window is the device, so run it on one phone profile and, for tablet layouts, one tablet.
- **Locale:** `tester.platformDispatcher.localeTestValue = const Locale('es')` before pumping, then assert on the Spanish dictionary's strings (load it from `assets/i18n/es.json`, never hard-code). Every shipped locale gets the same flow.
- **Waiting:** spinners never settle, so `pumpAndSettle` is not the tool; a `pumpUntil(tester, finder)` helper pumps in short steps until the finder matches or a timeout fails the test with the screen's current text.
- **Screenshots:** `await binding.takeScreenshot('home-390-es')` in the test, saved by `integrationDriver(onScreenshot:)` in `test_driver/`; name them `<screen>-<width>-<locale>` and link them in the PR. These are the screenshots the UI rule asks for; the manual browser recipe in the repo's `docs/development.md` is the fallback when drive cannot run.
- **CI tiers:** the fast job adds chromedriver (`nanasess/setup-chromedriver`) and runs `smoke_test.dart` at 390 once; the full job runs every file at both dimensions and every locale, on a `v*` tag, the weekly schedule and manual runs, and opens an issue when red. Emulator runs stay out of CI unless a change is Android-specific; they cost minutes an app this size does not need.
- **What stays a widget test:** anything that does not need the real app wired through `IocManager`: a cubit, a page's states with fakes, the i18n parity scan. An integration test that only pumps one widget with fakes belongs in `test/`.

Before reporting work done: `dart format --set-exit-if-changed lib test integration_test`, `flutter analyze --fatal-infos`, `flutter test`, the integration flows the change touches (on a PR, CI runs only the smoke set), `flutter build web --release --dart-define=IN_MEMORY_BACKEND=true`, and screenshots at 390 and desktop for every state the change touches.

## 10. Adding a feature

1. `features/<name>/` with `domain/`, `data/`, `presentation/` as needed; their subfolders appear with the second file of a kind.
2. `domain/<name>_failure.dart`: `sealed class XFailure extends Failure` + one subclass per outcome.
3. `domain/<name>_repository.dart`: the port, returning `Future<Either<XFailure, T>>`.
4. `data/<name>_remote_repository.dart`: implement it on an `abstractions/` port; map exceptions to failures, log the unexpected.
5. `presentation/<name>_state.dart` (sealed) and `<name>_cubit.dart` (exhaustive switch over the failure).
6. `presentation/<name>_page.dart`: `BlocProvider` + `BlocConsumer` inside `PageContainer`; copy through `I18n`; keys added to every dictionary.
7. `<name>_feature.dart` with `route`, `generateRoutes()`, `navigate()`, `buildPage()`; resolve app-wide services from the injector; build the rest here. Add `feature_readme.md`.
8. Register `generateRoutes()` in `Application`; link from another feature by passing `navigate` or `build*()`. If toggled, add the key to `FeatureFlags` and gate the entry widget.

## 11. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| Repository calls `FirebaseAuth.instance` directly | Depend on `AuthClient`; the Firebase adapter lives under `integrations/firebase/` |
| A port returning `dynamic` or a vendor snapshot | Typed port (`RemoteDocument {id, data}`), vendor types mapped in the adapter |
| `likes` written as a number from the client | A `likedBy` set written with an atomic set operation; the count derives from it |
| A widget created in `build()` holding `TextEditingController`s | A `StatefulWidget` that disposes them; the form stays mounted while submitting |
| Spinner replaces the form while submitting | Read-only fields and progress in the button; the draft survives a failure |
| `Scaffold.of(context)` from a listener above the Scaffold | `ScaffoldMessenger.of(context)` through `showTranslatedSnackBar` |
| Cubit imports its feature's `*_feature.dart` for a constant | Constant in `application/feature_flags.dart` |
| `StreamController` per layer, never closed | `stream.map(...)` in the use case; the cubit holds the one subscription and cancels it |
| `_ready ??= _init()` caching a failed future | Reset the cache in the `catch` so a retry can succeed |
| A flag read in two places for one screen | The host reads it once and passes the result down |
| New copy in one dictionary | Both dictionaries, or the parity test fails |
| `Visibility`-less `SizedBox(height: 44)` as a hidden footer | `Visibility(visible: false, maintainSize: true, ...)` around the real footer |
| `ListView(padding: ...)` dropping the safe area | Add `MediaQuery.paddingOf(context).bottom` to the explicit padding |

## Checklist for a review brief

Copy into the brief of every review pass for Flutter work:

1. Every `package:app` import respects the table in §1 (the architecture test is green).
2. Vendor packages only under `integrations/` and `main.dart`.
3. Each feature has a Feature class with the public surface in §3 and a `feature_readme.md` that matches it.
4. Repositories return `Either` over a sealed failure; cubits switch exhaustively; subscriptions are cancelled.
5. Toggles are checked at the entry widget through `FeatureGate`, read once per screen.
6. No raw hex or dp outside `application/theme/`; new UI composes `application/widgets/`.
7. Both dictionaries updated; i18n test green.
8. Forms keep input across a failed submit; back is blocked while submitting.
9. Tests follow §9; widget tests pump the shipped theme at 390x844; a changed flow has its `integration_test/` file run at both windows and every locale, with screenshots linked.
10. Files ~300 lines, functions ~40, components ~200, counting no blanks or comments.
11. File and folder names snake_case; the `file_names` lint is on.
12. The feature-shape rule in the standards holds: layer subfolders only from the second file of their kind, a split by sub-feature past ~15 files per layer folder, no module folders over `features/`.
