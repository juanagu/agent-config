# Architecture

One Fastify API (`api`) with one MongoDB. Everything is synchronous: the web app calls the API and waits for the response.

No queue, no workers. No ADR yet covers background processing.

Known problem: `GET /reports/:id` builds the report inline and takes ~40s for large accounts, which hits Cloudflare's 100s limit under load.
