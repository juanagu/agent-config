---
name: "react-native-architecture"
description: "The architecture every React Native app in this setup follows: Expo with development builds and continuous native generation on the New Architecture, TypeScript strict, Expo Router with thin route files over feature folders (components, hooks, lib port, screens), TanStack Query for server state and Zustand for client state, Zod at every boundary, tokens in one theme module with primitives in shared/ui, a Screen shell, typed i18n dictionaries, expo-secure-store for secrets, and the test layout (Jest + React Native Testing Library, MSW validated against the backend contract, Maestro for e2e on both platforms). Invoke before writing, reviewing or planning any code under an Expo/React Native project (app/, src/, app.json, eas.json, .maestro/), and when deciding where a new file goes. Not for Next.js/Astro (nextjs-architecture), Flutter (flutter-architecture), Android (android-architecture), iOS (ios-architecture) or Fastify (fastify-architecture)."
---

# React Native architecture

The shape mirrors the `nextjs-architecture` skill on purpose: a React team moving between the web app and the mobile app finds the same feature folders, the same `lib/` port, the same dictionaries and the same primitives rule. When a project already has its own `docs/architecture.md`, that doc wins on specifics; this skill is the default shape and the checklist.

Expo (the React Native team's recommended framework) with development builds (`expo-dev-client`), continuous native generation (`npx expo prebuild` on demand; `ios/` and `android/` are not committed unless the project already owns them), the New Architecture only (React Native 0.82+ has no other), Hermes, TypeScript strict, Expo Router with typed routes, React 19. A library goes in only after React Native Directory confirms New Architecture support; a native need is met with the Expo Modules API and a config plugin, never by editing generated native projects.

## 1. Layers and the dependency rule

```
app/                        routes only: each file is a few lines that renders a feature's screen; _layout.tsx per route group
  (auth)/_layout.tsx        guest-only group: redirects a signed-in session away
  (app)/_layout.tsx         signed-in group: the session guard, tabs or stack, route-dependent chrome
  +not-found.tsx
src/
  features/<feature>/
    screens/                one screen component per route, composing the feature's components inside Screen
    components/             presentational and compositional; never fetch
    hooks/                  state, effects, decisions; the feature's TanStack queries and mutations (use-feed.ts)
    lib/                    the feature's port: narrow functions over the transport, request/response schemas (Zod) and types beside them; routes.ts for every href the feature owns; params.ts for the schemas its route files validate params with
    store/                  a Zustand store only when client state outlives one screen
    feature_readme.md       purpose, exposed interface (the exports other features may import), data flow
  shared/
    ui/                     primitives (Button, Field, FormErrorMessage, Screen, MessageView, brand mark) with their own feature_readme.md
    theme/                  tokens: colors (light and dark), spacing, radii, type scale; the useTheme hook
    lib/                    transport only: base URL, auth header, timeout, response parsing, the error envelope, the query client
  i18n/                     one dictionary per locale typed by one Dictionary interface; the t() hook
  flags/                    feature flags: keys, defaults, the one read hook
```

| From | May import |
| --- | --- |
| `app/` | a feature only through its `index.ts`, which re-exports what its `feature_readme.md` lists (its screens, `lib/routes.ts`, `lib/params.ts`; for the auth feature also the session store the layout guards read), `shared/`, `i18n/`, `flags/` |
| `features/<f>/` | its own folder, `shared/`, `i18n/`, `flags/`, and another feature **only** through the exports its `feature_readme.md` lists |
| `shared/`, `i18n/`, `flags/` | `shared/`, never a feature |

Enforced by `eslint-plugin-boundaries` (or `dependency-cruiser`) once the repo opts in, with a baseline of today's offenders that may only shrink.

- File names are kebab-case (`feed-screen.tsx` exports `FeedScreen`, `use-feed.ts` exports `useFeed`), enforced by `unicorn/filename-case`. Expo Router's reserved names keep their shape (`_layout.tsx`, `index.tsx`, `[id].tsx`, `(app)/`, `+not-found.tsx`), and so does `feature_readme.md`.
- **Route files are thin.** `app/(app)/feed/[id].tsx` reads its params with `useLocalSearchParams`, validates them, and renders `PostDetailScreen`. No data fetching, no layout, no business logic in `app/`.
- **Components never fetch.** Reads and mutations are TanStack Query hooks in the feature's `hooks/`, calling narrow functions in its `lib/`; `shared/lib` holds only the transport, the error envelope and the query client. No interface/adapter pair per call: on the client the narrow module is the port.
- Validate every external input at the boundary with Zod: API responses in `lib/` (parse, don't cast), route params in the route file, form input through React Hook Form's Zod resolver, deep-link payloads before navigation.
- Business logic lives outside components (hooks, `lib/`); a component over ~200 lines, or one that both decides and renders, splits into a hook and presentational pieces.
- Feature code moves to `shared/` only once a second feature imports it.

## 2. State

- **Server state is TanStack Query.** Each feature keeps a query-key factory in `lib/query-keys.ts` and its hooks in `hooks/`; mutations invalidate by key or update the cache optimistically and roll back in `onError`. Persist the cache (`@tanstack/query-async-storage-persister`) only for data the product must show offline.
- **Client state is Zustand**, one small store per feature under `store/` when state outlives a screen; `useState`/`useReducer` when it does not. No Redux unless the project already has it; no global "app store".
- **Forms are React Hook Form + Zod**, composing `shared/ui`'s `Field` and `FormErrorMessage`. A form stays mounted while submitting (fields disabled, progress inside the button) so a failure keeps what was typed; failures the user fixes by retyping render inline, the unexpected ones as a toast through `Screen`.
- **Session** is `features/auth/store`, a small store hydrated from `expo-secure-store` at launch, read by the `(app)` and `(auth)` layouts for their redirects, and the only place the token lives in memory.
- Errors from `lib/` are typed (`FeedError` as a discriminated union) and mapped exhaustively in the hook; a component never inspects an `AxiosError` or a `Response`.

## 3. Navigation and chrome

- Expo Router with `experiments.typedRoutes`; every `href` comes from the feature's `lib/routes.ts`, never a string literal in a component.
- Route groups own route- or session-dependent chrome: `(auth)/_layout.tsx` and `(app)/_layout.tsx` hold the guards (`<Redirect>` from the session store) and the stack or tabs; the root `_layout.tsx` holds only providers (query client, theme, i18n, safe area) and the splash gate. Anything that renders on more than one route is checked against each route's existing shell for duplicated branding or redundant controls.
- Screens navigate with `router.push(routes.postDetail(id))`; a screen never imports another feature's screen component.
- Deep links and universal links are declared in `app.json` (`scheme`, associated domains, intent filters); the route file validates every parameter before use.

## 4. Design system and the Screen shell

- Tokens live once in `src/shared/theme/` (colors with light and dark values, spacing, radii, type scale), read through `useTheme()` and `StyleSheet.create` in a `useStyles` hook, or through NativeWind's `tailwind.config` tokens when the project chose NativeWind. No raw hex, pixel or font-size values in `src/features/`. Dark mode comes from `useColorScheme` inside the theme, never from a component.
- Primitives in `src/shared/ui/` (`Button`, `Field`, `FormErrorMessage`, `MessageView`, `Screen`, brand mark); feature code composes them and never writes a variant's style object inline. The same style block in two files means a missing primitive: extract it.
- One `Screen` owns the safe area (`react-native-safe-area-context`), keyboard avoidance, the capped centred column on tablets (forms 400, content 600), the toast host, and a `canLeave` flag that blocks the back gesture and the header back button while a submit is in flight (the router's prevent-remove hook, never a hand-rolled `BackHandler` in a feature).
- Lists are `FlashList` with stable `keyExtractor`, memoised items and no inline `renderItem` closures that capture changing state; animation is Reanimated; images are `expo-image`.
- Every pressable has an `accessibilityRole` and label and a 44pt minimum target; a change is checked in dark mode and with the platform's larger text setting.
- **Platform-appropriate, not platform-identical.** Material on Android and Human Interface Guidelines on iOS for navigation gestures, back behaviour, pickers and alerts; `Platform.select` only in `shared/ui`, never in a feature.

## 5. i18n

- All UI copy comes from `src/i18n/{en,es}.ts` dictionaries typed by one `Dictionary` interface, read through `useT()`; the locale starts from `expo-localization` and is persisted when the user changes it. No hard-coded strings in components. A test enforces identical key sets across dictionaries.
- Dates, numbers and relative time through `Intl` with the active locale (Hermes ships `Intl`); never a hand-rolled formatter.

## 6. Toggles

- Keys and defaults in `src/flags/` with one `useFlag(key)` hook, backed by remote config or a local override; a screen checks its flag once at the route file or the screen's root, never inside hooks or `lib/`. A read that fails keeps the feature off.

## 7. Native, secrets and releases

- Secrets never in the bundle: `EXPO_PUBLIC_*` is for values that are public by design; everything else lives server-side or in EAS secrets. Tokens in `expo-secure-store`, never `AsyncStorage`.
- Custom native code is an Expo Module (Swift/Kotlin) under `modules/` with a config plugin; third-party native changes go through config plugins in `app.config.ts`. `npx expo-doctor` and `npx expo install --check` are green before a PR.
- Builds through EAS Build with `eas.json` profiles (`development`, `preview`, `production`); over-the-air updates through EAS Update, with code signing on, **only for JS-only changes**: a change that touches a native module, a config plugin, `app.json` native settings or an SDK version is a store build, never an update. The runtime version policy is `fingerprint`.

## 8. Every outside dependency has a fake

- `tests/support/msw/` holds MSW handlers for every call in a feature's `lib/`, seeded with demo data, used by component and screen tests and by the `demo` app variant (`EXPO_PUBLIC_BACKEND=in-memory`) that Maestro and reviewers run. The handlers are validated in CI against the backend's published response contract (`contracts:sync`/`contracts:check`, as the web app does); a handler that only agrees with itself proves nothing.

## 9. Tests and checks

```
tests/
  unit/                   Jest (jest-expo preset) for lib/ logic, hooks (renderHook), stores and the i18n parity test; a test that never renders a screen is a unit test, never a Maestro flow
  components/             React Native Testing Library: screens and components by behaviour (getByRole, getByText with the dictionary), queries through MSW; route files and layouts through expo-router/testing-library's renderRouter
  support/                MSW handlers, test providers (query client, theme, i18n), demo data
.maestro/
  smoke.yaml              the fast tier: launch → sign-in → home, default locale
  <flow>.yaml             one flow per critical path (sign-in and sign-up with their failures, the feed and a like, compose, each toggle off)
  config.yaml
```

- **Component tests** assert what the user sees and does (role, text from the dictionary, disabled state), never internals; `jest.useFakeTimers()` only when a test needs them.
- **Maestro is the e2e tier**, on both platforms: every flow runs on an iOS simulator and an Android emulator against the development build with the in-memory backend, in every shipped locale (launch with `--env LOCALE=es` read by the app's dev settings, and assert on the dictionary's strings). Spinners never settle on their own: `extendedWaitUntil` on a `testID`, never a fixed `sleep`.
- **Screenshots come from the flows**: `takeScreenshot: <screen>-<platform>-<locale>` at a phone and a tablet on each platform (iPhone and iPad, a phone and a tablet AVD), light and dark. They are the screenshots the UI rule asks for; the fallback is `xcrun simctl io booted screenshot` / `adb exec-out screencap` against the demo variant.
- **Lint, types and size:** `tsc --noEmit`, ESLint with `eslint-config-expo`, `unicorn/filename-case`, `eslint-plugin-boundaries`, `max-lines` (300) and `max-lines-per-function` (40), with a baseline that may only shrink; never a disable comment to get past them.
- **CI tiers.** Fast, on every PR, on a Linux runner: lint, typecheck, Jest, `expo-doctor`, the contract check, and `npx expo export` to prove the bundle builds. Full, on a `v*` tag, the weekly run and manual runs: an EAS build per platform (or a local prebuild on the runner) and every Maestro flow, Android on a Linux runner with KVM, iOS on a macOS runner, which bills at ten times the Linux rate and is why iOS flows stay out of the PR tier; it opens an issue when red.

Before reporting work done: lint, typecheck, Jest, the Maestro flows the change touches on both platforms (on a PR, CI runs none), `expo-doctor`, `npx expo export`, and screenshots on iOS and Android at a phone and a tablet, light and dark, for every state and locale the change touches.

## 10. Adding a feature

1. `src/features/<name>/` with `screens/`, `components/`, `hooks/`, `lib/` as needed, and `feature_readme.md`.
2. `lib/<name>-api.ts`: narrow functions over `shared/lib`'s client, each parsing its response with a Zod schema; types exported beside them; `lib/query-keys.ts`; `lib/routes.ts` for every href the feature owns; `lib/params.ts` for the schemas its route files validate params with.
3. `hooks/use-<name>.ts`: TanStack Query hooks mapping `lib/` errors to the feature's typed error.
4. `screens/<name>-screen.tsx`: composes `Screen` and `shared/ui` primitives, reads copy through `useT()`; keys added to every dictionary.
5. `app/(app)/<name>/index.tsx`: validates params, renders the screen; a `_layout.tsx` if the feature is a nested stack. If toggled, add the key to `src/flags/` and gate the route file.
6. MSW handlers for every new call in `tests/support/msw/`, validated against the contract; a component test per state; a Maestro flow if the path is critical.

## 11. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| A route file fetching data or holding layout | The route file renders the feature's screen; data lives in the feature's hooks |
| `fetch`/`axios` called from a component or screen | A narrow function in the feature's `lib/`, consumed through a TanStack Query hook |
| `response.json() as Post[]` | `postSchema.array().parse(await response.json())` in `lib/` |
| A global Zustand store with every feature's state | One small store per feature, only when state outlives a screen |
| A `useEffect` that fetches and sets state | `useQuery` with a key from the feature's factory |
| `router.push('/feed/' + id)` | `router.push(routes.postDetail(id))` from the feature's `lib/routes.ts` |
| The session guard in the root `_layout.tsx` | `(auth)/_layout.tsx` and `(app)/_layout.tsx` redirect from the session store |
| `style={{ padding: 12, color: '#333' }}` in a feature | Tokens through `useTheme()`; a new value is a `designer` decision |
| `AsyncStorage.setItem('token', …)` | `expo-secure-store` behind the session store |
| `Platform.OS === 'ios' ?` inside a feature component | A primitive in `shared/ui` that owns the platform difference |
| `FlatList` with an inline `renderItem` arrow capturing state | `FlashList` with a memoised item component |
| A string literal in a component | `t('feed.empty.title')`; the parity test fails on a missing locale |
| `sleep: 3000` in a Maestro flow | `extendedWaitUntil` on a `testID` |
| An OTA update that includes a native change | A store build; updates are for JS-only changes, with a fingerprint runtime version |
| Editing `ios/` or `android/` by hand | A config plugin or an Expo Module; the native folders are generated |

## Checklist for a review brief

Copy into the brief of every review pass for React Native work:

1. `app/` holds thin route files only; the import table in §1 holds (the boundaries lint is green); a feature imports another only through its `feature_readme.md` exports; `shared/` imports no feature.
2. Components never fetch; reads and mutations are TanStack Query hooks over the feature's `lib/`; every response, param, form and deep link is parsed with Zod at the boundary.
3. Client state is per-feature Zustand or local state; the session store is the only holder of the token, backed by `expo-secure-store`.
4. Hrefs come from `lib/routes.ts`; guards and route-dependent chrome live in route-group layouts, not the root layout; every route the change renders on was checked for duplicated chrome.
5. No raw hex, pixel or font values outside `shared/theme`; new UI composes `shared/ui`; `Screen` owns safe area, keyboard and back-blocking; 44pt targets and accessibility roles present; platform differences live in `shared/ui`.
6. Both dictionaries updated; the parity test is green; dates and numbers through `Intl`.
7. Toggles checked once at the route file or screen root.
8. No secret in the bundle; native changes go through config plugins or Expo Modules; a native change ships as a store build, not an update.
9. Tests follow §9: component tests by behaviour through MSW handlers validated against the contract; a changed critical flow has its Maestro flow run on iOS and Android in every locale, with screenshots linked.
10. Files ~300 lines, functions ~40, components ~200, counting no blanks or comments; lint, typecheck, `expo-doctor` green with no new baseline entries.
11. File names kebab-case; Expo Router's reserved names and `feature_readme.md` kept.
