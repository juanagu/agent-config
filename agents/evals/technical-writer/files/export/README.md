# Export service

Exports a project's data as a CSV file.

## Quickstart

Authenticate with a bearer token, then request the export:

```
curl -H "Authorization: Bearer $TOKEN" \
  https://api.acme.test/v1/export?projectId=p_123 -o export.csv
```

The CSV is returned in the response body.

## Authentication

All requests need an `Authorization: Bearer <token>` header. Tokens are created in the dashboard under Settings.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/v1/export` | Returns the project's CSV in the response. Query: `projectId`. |

## Limits

`/v1/export` times out after 30 seconds, so projects over about 50k rows cannot be exported. Use `/v1/export` with a narrower `from`/`to` date range for those.

## Errors

Errors use `{ "error": "<code>" }`. `401` means the token is missing or invalid; `404` means the project does not exist.
