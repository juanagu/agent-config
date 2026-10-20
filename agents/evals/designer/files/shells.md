# Postwise: route shells

Each route renders inside one shell. Source: `src/app/`.

| Route group | Routes | Shell | What the shell renders |
| --- | --- | --- | --- |
| `(app)` | `/`, `/calendar`, `/brands`, `/brands/[id]`, `/settings/*` | `AppShell` | 390: top bar with the logo (left) and avatar menu (right), bottom tabs. 768 and up: left rail with logo and tabs, top-right avatar menu. |
| `(focus)` | `/onboarding/*` | `FocusShell` | Full screen, no nav. Logo top-left, a text button "Skip for now" top-right, progress dots at the bottom. |
| `(checkout)` | `/billing/checkout` | `CheckoutShell` | Logo top-left, a "Secure checkout" lock badge top-right, nothing else in the header. |
| `(auth)` | `/login`, `/signup` | `AuthShell` | Centered logo above a single card. No header. |
| `(public)` | `/share/[id]` | none | A public read-only preview of one post, with a small "Made with Postwise" footer. |

## Product ask

Users with several brands must be able to see which brand they are working in and switch it from anywhere they are signed in and working on a brand.

A user has 1 to about 12 brands; names can be long (up to 40 characters). A new user has exactly one brand created during onboarding.
