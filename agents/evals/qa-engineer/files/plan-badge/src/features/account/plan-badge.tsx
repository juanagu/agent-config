import type { Dictionary } from "@/i18n/dictionary";

type Props = { t: Dictionary["account"]; plan: "free" | "pro" | undefined };

export function PlanBadge({ t, plan }: Props) {
  if (!plan) return null;
  return (
    <span data-testid="plan-badge" className="rounded-full border px-3 py-1 text-sm">
      {plan === "pro" ? t.planPro : t.planFree}
    </span>
  );
}
