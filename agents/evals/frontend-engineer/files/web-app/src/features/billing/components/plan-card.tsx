import { Card } from "@/shared/ui/card";
import type { Dictionary } from "@/i18n/dictionary";

type PlanCardProps = {
  name: string;
  priceLabel: string;
  renewsOn: string;
  t: Dictionary["billing"];
};

export function PlanCard({ name, priceLabel, renewsOn, t }: PlanCardProps) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-0 py-3 md:px-6">
        <div>
          <p className="text-xs uppercase text-muted">{t.plan}</p>
          <p className="text-lg font-medium text-[#1f1f1f]">{name}</p>
        </div>
        <div className="text-right">
          <p className="text-lg text-ink">{priceLabel}</p>
          <p className="text-sm text-muted">
            {t.renews} {renewsOn}
          </p>
        </div>
      </div>
    </Card>
  );
}
