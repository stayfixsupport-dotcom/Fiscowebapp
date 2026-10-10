import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { BadgeDollarSign, Check, CirclePlus, LoaderCircle } from "lucide-react";
import { Btn, Card, Label } from "@/components/kit";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/ui-prefs";

const RANGES = ["1M", "4M", "1Y"] as const;
type Range = (typeof RANGES)[number];
type FeeStatus = "invoiced" | "paid" | "void";
type FeeEntry = {
  id: string;
  client_name: string | null;
  description: string;
  amount: number | string;
  currency_code: string;
  status: FeeStatus;
  issued_at: string;
};
type FeeForm = {
  clientName: string;
  description: string;
  amount: string;
  currency: string;
  status: Exclude<FeeStatus, "void">;
  issuedAt: string;
};
type Bucket = { label: string; start: number; end: number; value: number };

function defaultCurrency(countryCode?: string) {
  if (countryCode === "PL") return "PLN";
  if (countryCode === "DZ") return "DZD";
  return "EUR";
}

function blankForm(currency: string): FeeForm {
  return {
    clientName: "",
    description: "",
    amount: "",
    currency,
    status: "invoiced",
    issuedAt: new Date().toISOString().slice(0, 10),
  };
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function makeBuckets(range: Range, now: Date): Bucket[] {
  if (range === "1M") {
    const week = 7 * 24 * 60 * 60 * 1000;
    const start = now.getTime() - week * 4;
    return Array.from({ length: 4 }, (_, index) => ({
      label: `W${index + 1}`,
      start: start + week * index,
      end: start + week * (index + 1),
      value: 0,
    }));
  }

  const months = range === "4M" ? 4 : 12;
  return Array.from({ length: months }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - months + index + 1, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return {
      label: start.toLocaleDateString(undefined, { month: "short" }),
      start: start.getTime(),
      end: end.getTime(),
      value: 0,
    };
  });
}

export function FeeAnalyticsPanel() {
  const { role, user } = useStore();
  const t = useT();
  const [months, setMonths] = useState<Array<{ label: string; value: number }>>([]);
  const [stats, setStats] = useState({ thisMonth: 0, thisYear: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (role !== "accountant" || !user?.id) {
      setLoading(false);
      return;
    }

    let alive = true;

    const load = async () => {
      setLoading(true);
      setLoadError(false);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

      try {
        const { data, error } = await supabase
          .from("accountant_clients" as never)
          .select("approved_at")
          .eq("accountant_id", user.id)
          .eq("status", "active")
          .not("approved_at", "is", null);
        if (error) throw error;

        if (!alive) return;

        const approvedRows = (data ?? []) as Array<{ approved_at?: string }>;
        const approvals = approvedRows.flatMap((row) => {
          const timestamp = row.approved_at ? Date.parse(row.approved_at) : NaN;
          return Number.isFinite(timestamp) ? [timestamp] : [];
        });
        const thisMonth = approvals.filter(
          (timestamp) => timestamp >= Date.parse(monthStart),
        ).length;
        const thisYear = approvals.filter((timestamp) => timestamp >= Date.parse(yearStart)).length;
        const total = approvals.length;

        const buckets = Array.from({ length: 6 }, (_, index) => {
          const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
          const label = date.toLocaleDateString(undefined, { month: "short" });
          const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
          const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
          const value = approvals.filter(
            (timestamp) => timestamp >= start && timestamp < end,
          ).length;
          return { label, value };
        });

        setStats({ thisMonth, thisYear, total });
        setMonths(buckets);
      } catch {
        if (alive) {
          setLoadError(true);
          setStats({ thisMonth: 0, thisYear: 0, total: 0 });
          setMonths(Array.from({ length: 6 }, (_, index) => ({ label: "", value: 0 })));
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, [role, user?.id]);

  if (role !== "accountant") return null;

  const max = Math.max(1, ...months.map((bucket) => bucket.value));
  const hasApprovals = months.some((bucket) => bucket.value > 0);

  return (
    <Card tone="glass" className="min-w-0 overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Label className="text-foreground">{t("Accountant analytics")}</Label>
          <h2 className="mt-1 text-[20px] font-extrabold">{t("Approved clients")}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t("Taxpayers you approved this month, this year, and overall.")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/70 bg-card/55 px-3 py-2.5">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {t("This month")}
          </div>
          <div className="num mt-1 text-[22px] font-bold">{loading ? "—" : stats.thisMonth}</div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/55 px-3 py-2.5">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {t("This year")}
          </div>
          <div className="num mt-1 text-[22px] font-bold">{loading ? "—" : stats.thisYear}</div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/55 px-3 py-2.5">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
            {t("Total")}
          </div>
          <div className="num mt-1 text-[22px] font-bold">{loading ? "—" : stats.total}</div>
        </div>
      </div>

      <div className="mt-5 border-t border-border/70 pt-4">
        <div className="mb-2 flex items-center justify-between text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          <span>{t("Recent")}</span>
          <span>
            {loadError ? t("Unavailable") : loading ? t("Loading") : t("Client approvals")}
          </span>
        </div>
        {loading || loadError || !hasApprovals ? (
          <div className="flex h-28 items-center justify-center rounded-2xl border border-border/70 bg-card/55 px-4 text-center text-[12px] font-medium text-muted-foreground">
            {loading
              ? t("Loading client approvals…")
              : loadError
                ? t("Client approvals couldn’t be loaded.")
                : t("No client approvals in the last six months.")}
          </div>
        ) : (
          <>
            <div className="relative flex h-28 min-w-0 items-end gap-1">
              {months.map((bucket, index) => (
                <div
                  key={`${bucket.label}-${index}`}
                  className="flex h-full min-w-0 flex-1 items-end"
                >
                  <motion.span
                    initial={false}
                    animate={{ height: `${Math.max(8, (bucket.value / max) * 100)}%` }}
                    className="w-full rounded-t-md bg-gradient-to-t from-primary/20 to-primary/80"
                    title={`${bucket.label}: ${bucket.value} ${t("profiles")}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
              {months.map((bucket, index) => (
                <span key={`${bucket.label}-label-${index}`}>{bucket.label}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
