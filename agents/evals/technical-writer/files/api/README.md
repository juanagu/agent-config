# Acme API

HTTP API for the Acme dashboard.

## Run

```
npm ci
npm run dev
```

The server listens on `http://localhost:3001`.

## Endpoints

- `GET /health` returns `{ "ok": true }`.
- `GET /projects` returns the caller's projects.
