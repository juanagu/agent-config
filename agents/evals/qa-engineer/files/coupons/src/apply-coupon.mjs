export class CouponError extends Error {}

const PERCENT_DIVISOR = 100;

export function applyCoupon(subtotalCents, coupon, now = new Date()) {
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) {
    throw new CouponError("coupon expired");
  }
  const discount =
    coupon.type === "percent"
      ? Math.round((subtotalCents * coupon.value) / PERCENT_DIVISOR)
      : coupon.value;
  return Math.max(0, subtotalCents - discount);
}
