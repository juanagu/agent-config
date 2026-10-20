# API routes (current)

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /api/catalog` | none | Same response for every visitor. |
| `GET /api/catalog/:id` | none | Same response for every visitor. |
| `GET /api/me` | session cookie `sid` | Per-user profile and plan. |
| `GET /api/orders` | session cookie `sid` | Per-user. |
| `POST /api/login` | none | Checks email and password, sets `sid`. No rate limiting in the app today. |

The origin is `api.example.test:3001`, reachable from the internet. The app does not check whether a request came through Cloudflare.
