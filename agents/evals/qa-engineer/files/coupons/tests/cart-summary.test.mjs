import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/cart-summary.mjs";

test("a cart without a coupon pays the subtotal", () => {
  const items = [{ priceCents: 500, qty: 2 }];
  assert.deepEqual(summarize(items, null), { subtotal: 1000, total: 1000, savings: 0 });
});

test("savings show the coupon's full value", () => {
  const items = [{ priceCents: 500, qty: 1 }];
  const summary = summarize(items, { type: "fixed", value: 800 });
  assert.equal(summary.savings, 800);
});
