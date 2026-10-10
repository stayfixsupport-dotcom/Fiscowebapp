import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Coins, FileText } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { BlurFade } from "@/components/motion/BlurFade";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { Card, Label, Chip } from "@/components/kit";
import { AreaTrend, Bars, Donut, Heatmap } from "@/components/charts/Charts";
import type { Doc } from "@/lib/data";
import type { DocCategory } from "@/lib/data";
import { sfx } from "@/lib/sfx";
import { useStore } from "@/lib/app-store";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { FeeAnalyticsPanel } from "@/components/accountant/FeeAnalyticsPanel";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode } from "@/lib/i18n";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Analytics — Fisco" },
      {
        name: "description",
        content: "Review spending activity and financial trends from your saved documents.",
      },
      { property: "og:title", content: "Analytics — Fisco" },
    ],
  }),
  component: Activity,
});

function Activity() {
  const { role } = useStore();
  return role === "accountant" ? <AccountantAnalytics /> : <TaxpayerAnalytics />;
}

const RANGES = ["1W", "1M", "4M", "1Y", "ALL"] as const;
const EASE = [0.16, 1, 0.3, 1] as const;
const HEATMAP_WEEKS = 53;
const CATEGORY_COLORS: Record<DocCategory, string> = {
  Invoice: "#E56742",
  Receipt: "#17A984",
  Payroll: "#3F7BD8",
  "Tax form": "#9B62C4",
  Contract: "#D8A126",
  Utilities: "#0EA5A4",
  Transport: "#E66D9A",
  Supplies: "#708C43",
  Services: "#5965C9",
  Other: "#87919E",
};

type Bucket = { label: string; start: number; end: number; value: number };

function formatMoney(value: number, currency: string, locale: string) {
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

function buildMoneySeries(
  range: (typeof RANGES)[number],
  docs: Doc[],
  currency: string,
  locale: string,
) {
  const now = new Date();
  let buckets: Bucket[] = [];

  if (range === "1W") {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    buckets = Array.from({ length: 7 }, (_, index) => {
      const start = new Date(today);
      start.setDate(today.getDate() - 6 + index);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      return {
        label: start.toLocaleDateString(locale, { weekday: "short" }),
        start: start.getTime(),
        end: end.getTime(),
        value: 0,
      };
    });
  } else if (range === "1M") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const start = new Date(end);
    start.setDate(end.getDate() - 28);
    buckets = Array.from({ length: 4 }, (_, index) => {
      const bucketStart = new Date(start);
      bucketStart.setDate(start.getDate() + index * 7);
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketStart.getDate() + 7);
      return {
        label: `W${index + 1}`,
        start: bucketStart.getTime(),
        end: bucketEnd.getTime(),
        value: 0,
      };
    });
  } else if (range === "4M" || range === "1Y") {
    const months = range === "4M" ? 4 : 12;
    buckets = Array.from({ length: months }, (_, index) => {
      const start = new Date(now.getFullYear(), now.getMonth() - months + index + 1, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return {
        label: start.toLocaleDateString(locale, { month: "short" }),
        start: start.getTime(),
        end: end.getTime(),
        value: 0,
      };
    });
  } else {
    const years = docs
      .filter((doc) => doc.currency === currency && doc.createdAt)
      .map((doc) => new Date(doc.createdAt!).getFullYear())
      .filter(Number.isFinite);
    const firstYear = Math.min(
      years.length > 0 ? Math.min(...years) : now.getFullYear(),
      now.getFullYear() - 4,
    );
    buckets = Array.from({ length: now.getFullYear() - firstYear + 1 }, (_, index) => {
      const year = firstYear + index;
      return {
        label: String(year),
        start: new Date(year, 0, 1).getTime(),
        end: new Date(year + 1, 0, 1).getTime(),
        value: 0,
      };
    });
  }

  docs.forEach((doc) => {
    if (doc.currency !== currency || !doc.createdAt) return;
    const timestamp = Date.parse(doc.createdAt);
    if (!Number.isFinite(timestamp)) return;
    const bucket = buckets.find((item) => timestamp >= item.start && timestamp < item.end);
    if (bucket) bucket.value += doc.amount;
  });
  return buckets;
}

function AccountantAnalytics() {
  const { docs, documentsStatus, accountantClientCount } = useStore();
  const t = useT();
  const queue = docs.filter((doc) => doc.status === "pending" || doc.status === "sent").length;

  return (
    <main>
      <PageHeader title={t("Practice analytics")} back />
      <div className="mx-auto grid w-full max-w-[1180px] gap-2.5 px-4 pt-4 pb-32">
        <FeeAnalyticsPanel />
        <AnalyticsPanel
          title="Documents received"
          docs={docs}
          status={documentsStatus}
          stats={[
            { k: "Shared documents", v: docs.length },
            { k: "Pending review", v: queue },
            { k: "Active clients", v: accountantClientCount },
          ]}
          showMoney
        />
      </div>
    </main>
  );
}

function TaxpayerAnalytics() {
  const { docs, documentsStatus } = useStore();
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale =
    localeCode(preferences.language) === "fr" ? "fr-FR" : localeCode(preferences.language);
  const [range, setRange] = useState<(typeof RANGES)[number]>("1Y");
  const [currency, setCurrency] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [cadence, setCadence] = useState<number | null>(null);
  const [cat, setCat] = useState<number | null>(null);
  const [categoryMetric, setCategoryMetric] = useState<"documents" | "amount">("documents");
  const currencies = useMemo(
    () => [...new Set(docs.flatMap((doc) => (doc.currency ? [doc.currency] : [])))].sort(),
    [docs],
  );
  const activeCurrency = currencies.includes(currency) ? currency : (currencies[0] ?? "");
  const selectedDocs = useMemo(
    () => (activeCurrency ? docs.filter((doc) => doc.currency === activeCurrency) : []),
    [docs, activeCurrency],
  );
  const series = useMemo(
    () => (activeCurrency ? buildMoneySeries(range, docs, activeCurrency, locale) : []),
    [range, docs, activeCurrency, locale],
  );
  const total = series.reduce((sum, point) => sum + point.value, 0);
  const point = active === null ? undefined : series[active];
  const categoryData = useMemo(() => {
    const totals = new Map<DocCategory, { amount: number; count: number }>();
    docs.forEach((doc) => {
      const current = totals.get(doc.category) ?? { amount: 0, count: 0 };
      current.count += 1;
      if (doc.currency === activeCurrency && doc.amount > 0) current.amount += doc.amount;
      totals.set(doc.category, current);
    });
    const rows = [...totals.entries()]
      .map(([name, values]) => ({
        name,
        ...values,
        value: categoryMetric === "documents" ? values.count : values.amount,
        color: CATEGORY_COLORS[name] ?? CATEGORY_COLORS.Other,
      }))
      .filter((row) => categoryMetric === "documents" || row.amount > 0)
      .sort((first, second) => second.value - first.value);
    const categoryTotal = rows.reduce((sum, row) => sum + row.value, 0);
    let usedShare = 0;
    return rows.map((row, index) => {
      const share =
        index === rows.length - 1 ? 100 - usedShare : Math.round((row.value / categoryTotal) * 100);
      usedShare += share;
      return { ...row, share };
    });
  }, [activeCurrency, categoryMetric, docs]);
  const catRow = cat === null ? undefined : categoryData[cat];
  const cadenceData = useMemo(() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const counts = Array(7).fill(0) as number[];
    docs.forEach((doc) => {
      if (!doc.createdAt) return;
      const weekday = new Date(doc.createdAt).getDay();
      counts[(weekday + 6) % 7] = (counts[(weekday + 6) % 7] ?? 0) + 1;
    });
    return labels.map((label, index) => ({ label, value: counts[index] ?? 0 }));
  }, [docs]);
  const heatmapValues = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - 364);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const dayCounts = new Map<string, number>();
    docs.forEach((doc) => {
      if (!doc.createdAt) return;
      const date = new Date(doc.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    });
    return Array.from({ length: HEATMAP_WEEKS * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { date: key, value: date > today ? 0 : (dayCounts.get(key) ?? 0) };
    });
  }, [docs]);
  const activeDays = heatmapValues.filter((day) => day.value > 0).length;
  const docsTotal = selectedDocs.length;
  const totalAmount = selectedDocs.reduce((sum, doc) => sum + doc.amount, 0);
  const sentDocs = selectedDocs.filter((doc) => doc.status === "sent").length;
  const avgPerDoc = docsTotal > 0 ? totalAmount / docsTotal : 0;
  const movements = docs.slice(0, 20);
  const realKpis = [
    {
      label: t("Total captured"),
      value: totalAmount,
      hint: activeCurrency ? activeCurrency : t("No currency totals"),
      kind: "money" as const,
    },
    {
      label: t("Documents"),
      value: docsTotal,
      hint: t("In selected currency"),
      kind: "count" as const,
    },
    { label: t("Sent"), value: sentDocs, hint: t("Documents handed off"), kind: "count" as const },
  ];

  return (
    <div>
      <PageHeader title={t("Analytics")} back />
      <div className="mx-auto w-full max-w-[1180px] px-3.5 pb-32">
        {/* ---------- hero trend ---------- */}
        <BlurFade>
          <Card tone="glass" className="overflow-hidden p-5">
            <div className="flex items-start justify-between">
              <div>
                <Label>{point ? point.label : range}</Label>
                <div className="num mt-1.5 text-[36px] leading-none tracking-tight">
                  {documentsStatus === "loading" ? (
                    "..."
                  ) : documentsStatus === "error" || !activeCurrency ? (
                    "—"
                  ) : (
                    <AnimatedNumber
                      value={point ? point.value : total}
                      format={(value) => formatMoney(value, activeCurrency, locale)}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currencies.length > 0 && (
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                    {t("Currency")}
                    <select
                      value={activeCurrency}
                      onChange={(event) => {
                        setCurrency(event.target.value);
                        setActive(null);
                      }}
                      className="h-9 rounded-full border border-border bg-card/70 px-3 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {currencies.map((code) => (
                        <option key={code} value={code} className="bg-card text-foreground">
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Chip tone="positive" className="mt-1">
                  {documentsStatus === "ready"
                    ? `${docsTotal} ${t("docs")}`
                    : documentsStatus === "loading"
                      ? t("Syncing")
                      : t("Unavailable")}
                </Chip>
              </div>
            </div>

            <div className="-mx-1 mt-4 text-primary">
              <AreaTrend
                data={series}
                height={176}
                activeIndex={active}
                onActive={(i) => {
                  sfx("tap");
                  setActive(i);
                }}
              />
            </div>

            <div className="mt-1 flex justify-between px-1 text-[10px] font-bold text-muted-foreground">
              {series.map((p, i) => (
                <span key={`${p.label}-${i}`} className={i === active ? "text-foreground" : ""}>
                  {p.label}
                </span>
              ))}
            </div>

            {/* range pill */}
            <div className="mt-4 flex rounded-full bg-secondary/70 p-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    sfx("tap");
                    setRange(r);
                    setActive(null);
                  }}
                  className="relative flex-1 py-2 text-[11.5px] font-extrabold tracking-wide"
                >
                  {range === r && (
                    <motion.span
                      layoutId="range-pill"
                      className="absolute inset-0 rounded-full bg-primary"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span
                    className={
                      range === r
                        ? "relative text-primary-foreground"
                        : "relative text-muted-foreground"
                    }
                  >
                    {t(r)}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </BlurFade>

        {/* ---------- KPI row ---------- */}
        <div className="mt-2.5 grid grid-cols-3 gap-2.5">
          {realKpis.map((k, i) => (
            <BlurFade key={k.label} delay={0.05 + i * 0.05} className="h-full">
              <Card tone="glass" className="h-full p-3">
                <Label className="text-[9px]">{k.label}</Label>
                <div className="num mt-1.5 text-[15px] leading-none">
                  {documentsStatus !== "ready" ? (
                    "—"
                  ) : k.kind === "money" ? (
                    activeCurrency ? (
                      <AnimatedNumber
                        value={k.value}
                        format={(value) => formatMoney(value, activeCurrency, locale)}
                      />
                    ) : (
                      "—"
                    )
                  ) : (
                    <AnimatedNumber value={k.value} format={(value) => `${Math.round(value)}`} />
                  )}
                </div>
                <div className="mt-1.5 text-[10px] font-semibold text-muted-foreground">
                  {k.hint}
                </div>
              </Card>
            </BlurFade>
          ))}
        </div>

        {/* ---------- bento: cadence + split ---------- */}
        <div className="mt-2.5 grid gap-2.5 lg:grid-cols-2">
          <BlurFade delay={0.12}>
            <Card tone="glass" className="h-full p-4">
              <div className="flex items-baseline justify-between">
                <Label>{t("Capture cadence")}</Label>
                <span className="num text-[12px] font-bold text-muted-foreground">
                  {cadence === null
                    ? `${cadenceData.reduce((sum, item) => sum + item.value, 0)} ${t("docs")}`
                    : `${cadenceData[cadence]?.value ?? 0} ${t("docs")}`}
                </span>
              </div>
              <div className="mt-3">
                <Bars
                  data={cadenceData}
                  tone="light"
                  activeIndex={cadence}
                  onActive={(i) => {
                    sfx("tap");
                    setCadence(i);
                  }}
                />
              </div>
            </Card>
          </BlurFade>

          <BlurFade delay={0.16}>
            <Card tone="glass" className="h-full p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{t("Category split")}</Label>
                <div
                  className="flex rounded-full bg-secondary/70 p-0.5"
                  role="group"
                  aria-label={t("Category distribution metric")}
                >
                  {(["documents", "amount"] as const).map((metric) => (
                    <button
                      key={metric}
                      type="button"
                      aria-pressed={categoryMetric === metric}
                      disabled={metric === "amount" && !activeCurrency}
                      onClick={() => {
                        sfx("tick");
                        setCategoryMetric(metric);
                        setCat(null);
                      }}
                      className={`relative inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[10px] font-bold disabled:opacity-40 ${categoryMetric === metric ? "text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      {categoryMetric === metric && (
                        <motion.span
                          layoutId="category-metric"
                          className="absolute inset-0 rounded-full bg-primary"
                        />
                      )}
                      <span className="relative z-10 inline-flex items-center gap-1">
                        {metric === "documents" ? (
                          <FileText className="size-3" />
                        ) : (
                          <Coins className="size-3" />
                        )}
                        {metric === "documents" ? t("Documents") : t("Value")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              {categoryData.length === 0 ? (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  {categoryMetric === "documents"
                    ? t("No categorized documents yet.")
                    : t("No categorized amounts in this currency yet.")}
                </p>
              ) : (
                <div className="mt-3 flex items-center gap-4">
                  <div className="relative shrink-0 text-primary">
                    <Donut data={categoryData} activeIndex={cat} />
                    <div className="absolute inset-0 grid place-content-center text-center">
                      <span className="num text-[15px] leading-none">
                        {catRow ? `${catRow.share}%` : "100%"}
                      </span>
                      <span className="mt-1 block max-w-[70px] truncate text-[9.5px] font-bold text-muted-foreground">
                        {catRow ? t(catRow.name) : t("of total")}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    {categoryData.map((item, index) => (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => {
                          sfx("tap");
                          setCat(cat === index ? null : index);
                        }}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full bg-primary"
                          style={{ opacity: 1 - index * 0.13 }}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-[12px] font-bold ${cat !== null && cat !== index ? "opacity-40" : ""}`}
                        >
                          {t(item.name)}
                        </span>
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                          aria-hidden="true"
                        />
                        <span className="num text-[11.5px] text-muted-foreground">
                          {categoryMetric === "documents"
                            ? `${item.count} ${t("docs")}`
                            : formatMoney(item.amount, activeCurrency, locale)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </BlurFade>
        </div>

        {/* ---------- consistency heatmap ---------- */}
        <BlurFade delay={0.2} className="mt-2.5 block">
          <Card tone="glass" className="p-4">
            <div className="flex items-baseline justify-between">
              <Label>{t("Capture consistency · 53 weeks")}</Label>
              <span className="text-[11px] font-semibold text-muted-foreground">
                {documentsStatus === "ready"
                  ? `${activeDays} ${t("active days")}`
                  : documentsStatus === "loading"
                    ? t("Syncing documents")
                    : t("Activity unavailable")}
              </span>
            </div>
            <div className="mt-3 text-primary">
              {documentsStatus === "ready" ? (
                <Heatmap values={heatmapValues} weeks={HEATMAP_WEEKS} />
              ) : documentsStatus === "loading" ? (
                <div
                  aria-label={t("Loading document activity")}
                  aria-busy="true"
                  className="h-[126px] animate-pulse rounded-2xl bg-secondary/45"
                />
              ) : (
                <p role="status" className="py-12 text-center text-[13px] text-muted-foreground">
                  {t("Document activity could not be loaded. Check your connection and try again.")}
                </p>
              )}
            </div>
            {documentsStatus === "ready" && (
              <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
                <span>{t("Less")}</span>
                {[0, 1, 2, 3].map((level) => (
                  <span
                    key={level}
                    aria-hidden
                    className="size-[11px] rounded-[3px] border border-foreground/5"
                    style={{
                      backgroundColor:
                        level === 0
                          ? "color-mix(in oklab, var(--foreground) 8%, transparent)"
                          : `color-mix(in oklab, var(--primary) ${35 + level * 20}%, var(--card))`,
                    }}
                  />
                ))}
                <span>{t("More")}</span>
              </div>
            )}
          </Card>
        </BlurFade>

        {/* ---------- activity list ---------- */}
        <BlurFade delay={0.24} className="mt-5 block">
          <h2 className="px-1 text-[17px] font-extrabold tracking-tight">{t("Movements")}</h2>
          {movements.length === 0 ? (
            <Card className="mt-2 p-8 text-center">
              <FileText className="mx-auto mb-3 size-8 opacity-30" />
              <div className="text-[14px] font-bold">{t("No movements yet")}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {t("Scan your first document to see activity here.")}
              </div>
            </Card>
          ) : (
            <Card className="mt-2 divide-y divide-border/70 p-1.5">
              {movements.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -10, filter: "blur(6px)" }}
                  whileInView={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.04 * i, duration: 0.45, ease: EASE }}
                  className="flex items-center gap-3 px-2.5 py-2.5"
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary/80">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold">{a.merchant}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {t(a.category)} · {a.date} · {t(a.status)}
                    </div>
                  </div>
                  <div className="num shrink-0 text-[14px]">
                    {a.amount === 0 || !a.currency
                      ? "—"
                      : formatMoney(a.amount, a.currency, locale)}
                  </div>
                </motion.div>
              ))}
            </Card>
          )}
        </BlurFade>
      </div>
    </div>
  );
}
