# Development

## Run the stack

`docker compose up -d mongo redis`, then in separate terminals: core-api `npm run dev` (:3001) and
`npm run dev:worker`, bff `npm run dev` (:4000), this app `npm run dev` (:3000).

## Seeded account

`npm run seed` in core-api creates `demo@example.com` / `demo-password` on the Pro plan, with data.
Sign in at http://localhost:3000/login. The locale comes from the `app_locale` cookie (`en` or `es`).

## Testing

- `npm test` runs vitest; `npm run test:e2e` runs Playwright against a production build and the
  fake bff in `tests/support/fake-bff-server.mjs`.
- The fake is hand-written. The bff publishes its response schema in `docs/contracts/responses.json`.
