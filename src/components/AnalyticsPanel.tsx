import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Coins, FileText } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Heatmap } from "@/components/charts/Charts";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { BlurFade } from "@/components/motion/BlurFade";
import { Card, Label } from "@/components/kit";
import type { Doc } from "@/lib/data";
import { sfx } from "@/lib/sfx";
import { localeCode } from "@/lib/i18n";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

const RANGES = ["1M", "4M", "1Y"] as const;
const HEATMAP_WEEKS = 53;
type Range = (typeof RANGES)[number];
type Metric = "documents" | "amount";

type Bar = { label: string; start: number; end: number; value: number };

function buildBuckets(range: Range, now: Date, locale: string): Bar[] {
  if (range === "1M") {
    const step = 7 * 24 * 60 * 60 * 1000;
    const start = now.getTime() - step * 4;
    return Array.from({ length: 4 }, (_, index) => ({
      label: `W${index + 1}`,
      start: start + step * index,
      end: start + step * (index + 1),
      value: 0,
    }));
  }

  const months = range === "4M" ? 4 : 12;
  return Array.from({ length: months }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - months + index + 1, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return {
      label: start.toLocaleDateString(locale, { month: "short" }),
      start: start.getTime(),
      end: end.getTime(),
      value: 0,
    };
  });
}

function formatAmount(value: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/**
 * Editorial analytics block — column architecture instead of a stroked curve,
 * so nothing can ever clip against the card edges. Each column is a rounded
 * gradient bar with a hover/tap readout.
 */
export function AnalyticsPanel({
  title,
  docs,
  status,
  stats,
  showMoney = false,
  moneyOnly = false,
}: {
  title: string;
  docs: Doc[];
  status: "loading" | "ready" | "error";
  stats: { k: string; v: number | string }[];
  showMoney?: boolean;
  moneyOnly?: boolean;
}) {
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale =
    localeCode(preferences.language) === "fr" ? "fr-FR" : localeCode(preferences.language);
  const [range, setRange] = useState<Range>("1Y");
  const [hover, setHover] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>(moneyOnly ? "amount" : "documents");
  const activeMetric: Metric = moneyOnly ? "amount" : metric;
  const [currency, setCurrency] = useState("");
  const currencies = useMemo(
    () => [...new Set(docs.flatMap((doc) => (doc.currency ? [doc.currency] : [])))].sort(),
    [docs],
  );
  const activeCurrency = currencies.includes(currency) ? currency : (currencies[0] ?? "");
  const contributionDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - 364);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const counts = new Map<string, number>();
    for (const doc of docs) {
      if (!doc.createdAt) continue;
      const date = new Date(doc.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from({ length: HEATMAP_WEEKS * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { date: key, value: date > today ? 0 : (counts.get(key) ?? 0) };
    });
  }, [docs]);
  const activeDays = contributionDays.filter((day) => day.value > 0).length;
  const visibleDocs =
    activeMetric === "amount" ? docs.filter((doc) => doc.currency === activeCurrency) : docs;
  const bars = useMemo(() => {
    const now = new Date();
    const next = buildBuckets(range, now, locale);
    visibleDocs.forEach((doc) => {
      if (!doc.createdAt) return;
      const created = Date.parse(doc.createdAt);
      if (!Number.isFinite(created)) return;
      const bucket = next.find((item) => created >= item.start && created < item.end);
      if (bucket) bucket.value += activeMetric === "documents" ? 1 : doc.amount;
    });
    return next;
  }, [visibleDocs, activeMetric, range, locale]);
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const focus = hover === null ? null : (bars[hover] ?? null);

  return (
    <BlurFade className="min-w-0">
      <Card tone="glass" className="relative min-w-0 overflow-hidden p-4 sm:p-6">
        <div className="relative grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Label>
                {activeMetric === "documents" ? t(title) : t("Captured document amounts")}
              </Label>
              {focus && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  {focus.label}
                </span>
              )}
            </div>
            <div
              className={`num mt-2 leading-none ${activeMetric === "amount" ? "text-[27px] sm:text-[40px]" : "text-[34px] sm:text-[46px]"}`}
            >
              {status === "ready" ? (
                <AnimatedNumber
                  value={focus?.value ?? total}
                  format={(value) =>
                    activeMetric === "documents"
                      ? `${Math.round(value)}`
                      : formatAmount(value, activeCurrency, locale)
                  }
                  duration={0.45}
                />
              ) : status === "loading" ? (
                "..."
              ) : (
                "—"
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-bold">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-primary-foreground">
                {activeMetric === "documents" ? (
                  <FileText className="size-3" />
                ) : (
                  <Coins className="size-3" />
                )}
                {status === "ready"
                  ? activeMetric === "documents"
                    ? focus
                      ? `${focus.value} documents`
                      : `${total} documents`
                    : formatAmount(focus?.value ?? total, activeCurrency, locale)
                  : status === "loading"
                    ? t("Syncing")
                    : t("Unavailable")}
              </span>
              <span className="text-muted-foreground">
                {status === "ready"
                  ? activeMetric === "documents"
                    ? t("saved in this period")
                    : t("captured in this currency")
                  : status === "loading"
                    ? t("loading from your account")
                    : t("database activity could not be loaded")}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
            {showMoney && !moneyOnly && (
              <div className="flex rounded-full bg-secondary/70 p-0.5">
                <button
                  type="button"
                  aria-pressed={metric === "documents"}
                  onClick={() => {
                    sfx("tick");
                    setMetric("documents");
                    setHover(null);
                  }}
                  className={`relative rounded-full px-2.5 py-1 text-[11px] font-bold ${metric === "documents" ? "text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {metric === "documents" && (
                    <motion.span
                      layoutId="home-analytics-metric"
                      className="absolute inset-0 rounded-full bg-primary"
                    />
                  )}
                  <span className="relative z-10">{t("Files")}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={metric === "amount"}
                  disabled={currencies.length === 0}
                  onClick={() => {
                    sfx("tick");
                    setMetric("amount");
                    setHover(null);
                  }}
                  className={`relative rounded-full px-2.5 py-1 text-[11px] font-bold disabled:opacity-40 ${metric === "amount" ? "text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {metric === "amount" && (
                    <motion.span
                      layoutId="home-analytics-metric"
                      className="absolute inset-0 rounded-full bg-primary"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1">
                    <Coins className="size-3" /> {t("Value")}
                  </span>
                </button>
              </div>
            )}
            {showMoney && activeMetric === "amount" && currencies.length > 1 && (
              <select
                aria-label={t("Amount currency")}
                value={activeCurrency}
                onChange={(event) => {
                  sfx("select");
                  setCurrency(event.target.value);
                  setHover(null);
                }}
                className="h-8 min-w-0 max-w-[78px] rounded-full border border-border bg-card/70 px-2 text-[11px] font-bold text-foreground"
              >
                {currencies.map((code) => (
                  <option key={code} value={code} className="bg-card text-foreground">
                    {code}
                  </option>
                ))}
              </select>
            )}
            <div className="flex shrink-0 rounded-full bg-secondary/70 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={r === range}
                  onClick={() => {
                    sfx("tick");
                    setRange(r);
                    setHover(null);
                  }}
                  onPointerEnter={() => sfx("hover")}
                  className={`relative rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    r === range ? "text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {r === range && (
                    <motion.span
                      layoutId="analytics-range"
                      className="absolute inset-0 rounded-full bg-primary"
                      transition={{ type: "spring", stiffness: 460, damping: 36 }}
                    />
                  )}
                  <span className="relative z-10">{r}</span>
                </button>
              ))}
            </div>
            <Link
              to="/documents"
              aria-label={t("Open documents")}
              onClick={() => sfx("open")}
              className="press grid size-9 place-items-center rounded-full bg-secondary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>

        {/* column chart — pure layout, no strokes, so it can never be clipped */}
        <div className="relative mt-6 px-1" onPointerLeave={() => setHover(null)}>
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-px w-full bg-border/60" />
            ))}
          </div>

          <div className="relative flex h-[160px] items-end gap-[3px] sm:h-[210px]">
            {status === "ready" &&
              bars.map((b, i) => {
                const on = hover === i;
                return (
                  <button
                    key={`${b.label}-${i}`}
                    aria-label={`${b.label}: ${activeMetric === "documents" ? `${b.value} ${t("documents")}` : formatAmount(b.value, activeCurrency, locale)}`}
                    onPointerEnter={() => {
                      setHover(i);
                    }}
                    onClick={() => {
                      setHover(i);
                    }}
                    className="group relative flex h-full min-w-0 flex-1 items-end"
                  >
                    <motion.span
                      animate={{
                        height: `${b.value === 0 ? 0 : Math.max(6, (b.value / max) * 100)}%`,
                      }}
                      transition={{
                        duration: 0.35,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className={`w-full rounded-t-[6px] transition-colors ${
                        on ? "bg-primary" : "bg-gradient-to-t from-primary/15 to-primary/60"
                      }`}
                    />
                    {on && (
                      <motion.span
                        initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        style={{
                          bottom: `calc(${b.value === 0 ? 0 : Math.max(6, (b.value / max) * 100)}% + 8px)`,
                        }}
                        className="num pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-bold whitespace-nowrap text-foreground"
                      >
                        {activeMetric === "documents"
                          ? `${b.value} ${t("docs")}`
                          : formatAmount(b.value, activeCurrency, locale)}
                      </motion.span>
                    )}
                  </button>
                );
              })}
          </div>

          <div className="mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
            <span>{status === "ready" ? bars[0]?.label : ""}</span>
            <span className="min-w-0 text-center leading-snug [overflow-wrap:anywhere]">
              {status === "ready"
                ? total === 0
                  ? activeMetric === "documents"
                    ? t("No document activity in this period")
                    : t("No amounts in this currency for this period")
                  : activeMetric === "documents"
                    ? `${total} ${t("records")}`
                    : formatAmount(total, activeCurrency, locale)
                : status === "loading"
                  ? t("Loading database activity")
                  : t("Database activity unavailable")}
            </span>
            <span>{status === "ready" ? bars[bars.length - 1]?.label : ""}</span>
          </div>
        </div>

        <div className="mt-5 border-t border-border/70 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Label>{t("Document activity · 53 weeks")}</Label>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {status === "ready"
                  ? `${activeDays} ${t("active days in your account")}`
                  : status === "loading"
                    ? t("Syncing document activity")
                    : t("Document activity unavailable")}
              </p>
            </div>
            <FileText className="size-4 shrink-0 text-primary" />
          </div>
          {status === "ready" ? (
            <Heatmap values={contributionDays} weeks={HEATMAP_WEEKS} />
          ) : status === "loading" ? (
            <div
              aria-label={t("Loading document activity")}
              aria-busy="true"
              className="h-[126px] animate-pulse rounded-2xl bg-secondary/45"
            />
          ) : (
            <p role="status" className="py-8 text-center text-[12px] text-muted-foreground">
              {t("Document activity could not be loaded. Check your connection and try again.")}
            </p>
          )}
        </div>

        {!(moneyOnly && activeMetric === "amount") && (
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/70 pt-4">
            {stats.map((s) => (
              <motion.div key={s.k} className="min-w-0">
                <div className="num text-[22px] leading-none">
                  {status === "ready" ? s.v : status === "loading" ? "..." : "—"}
                </div>
                <div className="mt-1 truncate text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
                  {t(s.k)}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Card>
    </BlurFade>
  );
}
