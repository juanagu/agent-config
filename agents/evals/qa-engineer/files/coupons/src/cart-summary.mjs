import { applyCoupon } from "./apply-coupon.mjs";

export function summarize(items, coupon) {
  const subtotal = items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
  const total = coupon ? applyCoupon(subtotal, coupon) : subtotal;
  return { subtotal, total, savings: subtotal - total };
}
