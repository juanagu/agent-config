# auth

Purpose: sign-in, session token, sign-out.

Exposed interface: `useSessionStore` (the only holder of the token, backed by expo-secure-store), `routes.ts` hrefs, `SignInScreen`.

Data flow: sign-in screen posts credentials through `lib/auth-api.ts`, parses the response with Zod, hands the token to the session store. The `(app)` route-group layout redirects to sign-in when the store has no token.
