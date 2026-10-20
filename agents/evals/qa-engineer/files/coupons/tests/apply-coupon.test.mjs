import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCoupon } from "../src/apply-coupon.mjs";

test("a percent coupon takes that share off", () => {
  assert.equal(applyCoupon(1000, { type: "percent", value: 25 }), 750);
});

test("a fixed coupon smaller than the subtotal subtracts its value", () => {
  assert.equal(applyCoupon(1000, { type: "fixed", value: 300 }), 700);
});
