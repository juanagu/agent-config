# core-api pricing (status)

- `POST /internal/pricing/quote` is specified in core-api issue #57 but not implemented yet.
- Request: `{ items: [{ sku, qty }], couponCode? }`. Response: `{ subtotalCents, discountCents, shippingCents, totalCents }`.
- Owner: core-api team. ETA unknown.
