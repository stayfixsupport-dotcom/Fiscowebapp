import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { localeCode } from "@/lib/i18n";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

export type Point = { label: string; value: number };

const EASE = [0.16, 1, 0.3, 1] as const;

/* ---------------- shared: measured box ---------------- */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(e.contentRect.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/* ---------------- area trend ---------------- */

export function AreaTrend({
  data,
  height = 168,
  activeIndex,
  onActive,
  className,
}: {
  data: Point[];
  height?: number;
  activeIndex?: number | null;
  onActive?: (i: number | null) => void;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const t = useT();
  const { ref, w } = useWidth<HTMLDivElement>();
  const padX = 10;
  const padY = 16;
  const width = Math.max(w, 1);

  const vals = data.map((d) => d.value);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = max - min || 1;
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({
    x: padX + i * step,
    y: padY + (1 - (d.value - min) / span) * (height - padY * 2),
  }));

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const line = pts
    .map((p, i) => {
      const prev = pts[i - 1];
      if (i === 0 || !prev) return `M ${p.x} ${p.y}`;
      const cx = (prev.x + p.x) / 2;
      return `C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`;
    })
    .join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = first && last ? `${line} L ${last.x} ${height} L ${first.x} ${height} Z` : "";

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {w > 0 && (
        <svg width={width} height={height} role="img" aria-label={t("Spending trend")}>
          <defs>
            <linearGradient id={`ar-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={0}
              x2={width}
              y1={padY + g * (height - padY * 2)}
              y2={padY + g * (height - padY * 2)}
              stroke="currentColor"
              strokeOpacity={0.09}
              strokeDasharray="3 6"
            />
          ))}

          <motion.path
            key={`a-${data.length}-${max}`}
            d={area}
            fill={`url(#ar-${id})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
          <motion.path
            key={`l-${data.length}-${max}`}
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.05, ease: EASE }}
          />

          {activeIndex != null && pts[activeIndex] && (
            <motion.line
              x1={pts[activeIndex]!.x}
              x2={pts[activeIndex]!.x}
              y1={padY - 8}
              y2={height}
              stroke="currentColor"
              strokeOpacity={0.35}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            />
          )}

          {pts.map((p, i) => (
            <motion.circle
              key={i}
              cx={p.x}
              cy={p.y}
              fill="currentColor"
              initial={{ r: 0 }}
              animate={{ r: activeIndex === i ? 5.5 : 3 }}
              transition={{ delay: 0.35 + i * 0.03, type: "spring", stiffness: 320, damping: 20 }}
              opacity={activeIndex == null || activeIndex === i ? 1 : 0.4}
            />
          ))}
        </svg>
      )}

      {/* hit areas */}
      <div className="absolute inset-0 flex">
        {data.map((d, i) => (
          <button
            key={`${d.label}-${i}`}
            aria-label={`${d.label}`}
            onClick={() => onActive?.(activeIndex === i ? null : i)}
            className="h-full flex-1"
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------- bars ---------------- */

export function Bars({
  data,
  height = 148,
  activeIndex,
  onActive,
  tone = "ink",
}: {
  data: Point[];
  height?: number;
  activeIndex?: number | null;
  onActive?: (i: number | null) => void;
  tone?: "ink" | "light";
}) {
  const t = useT();
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => {
        const on = activeIndex == null || activeIndex === i;
        return (
          <button
            key={`${d.label}-${i}`}
            onClick={() => onActive?.(activeIndex === i ? null : i)}
            className="group flex h-full flex-1 flex-col justify-end gap-1.5"
          >
            <motion.span
              className={cn(
                "block w-full rounded-t-[7px] rounded-b-[3px]",
                tone === "ink" ? "bg-ink-foreground" : "bg-primary",
              )}
              initial={{ height: 0, opacity: 0 }}
              animate={{
                height: `${(d.value / max) * 100}%`,
                opacity: on ? 1 : 0.3,
              }}
              transition={{ delay: 0.04 * i, duration: 0.75, ease: EASE }}
            />
            <span
              className={cn(
                "block text-[9.5px] font-bold",
                tone === "ink" ? "text-ink-foreground/45" : "text-muted-foreground",
                activeIndex === i && (tone === "ink" ? "text-ink-foreground" : "text-foreground"),
              )}
            >
              {d.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- donut ---------------- */

export function Donut({
  data,
  size = 128,
  thickness = 16,
  activeIndex,
}: {
  data: { name: string; value: number; share: number; color?: string }[];
  size?: number;
  thickness?: number;
  activeIndex?: number | null;
}) {
  const t = useT();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={t("Category split")}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={thickness}
        className="stroke-foreground/8"
      />
      {data.map((d, i) => {
        const len = (d.share / 100) * c;
        const offset = acc;
        acc += len;
        return (
          <motion.circle
            key={d.name}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={d.color ?? "currentColor"}
            strokeWidth={activeIndex === i ? thickness + 4 : thickness}
            strokeLinecap="butt"
            strokeDasharray={`${len} ${c - len}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            opacity={activeIndex == null || activeIndex === i ? 1 - i * 0.13 : 0.18}
            initial={{ strokeDashoffset: -c }}
            animate={{ strokeDashoffset: -offset }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.9, ease: EASE }}
          />
        );
      })}
    </svg>
  );
}

/* ---------------- heatmap ---------------- */

export function Heatmap({
  weeks,
  values,
}: {
  weeks: number;
  values: { date: string; value: number }[];
}) {
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale =
    localeCode(preferences.language) === "fr" ? "fr-FR" : localeCode(preferences.language);
  const max = Math.max(...values.map((day) => day.value), 1);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const monthMarkers = Array.from({ length: weeks }, (_, week) => {
    const monthStart = values.slice(week * 7, week * 7 + 7).find((day) => {
      return new Date(`${day.date}T12:00:00`).getDate() === 1;
    });
    return monthStart
      ? {
          week,
          label: new Date(`${monthStart.date}T12:00:00`).toLocaleDateString(locale, {
            month: "short",
          }),
        }
      : null;
  }).filter((marker) => marker !== null);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-max">
        <div className="relative mb-2 ml-8 h-4 text-[10px] font-semibold text-muted-foreground">
          {monthMarkers.map((marker) => (
            <span
              key={`${marker.week}-${marker.label}`}
              className="absolute"
              style={{ left: marker.week * 14 }}
            >
              {marker.label}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <div
            aria-hidden
            className="grid w-6 shrink-0 grid-rows-7 gap-[3px] text-[9px] leading-[11px] text-muted-foreground"
          >
            <span />
            <span>{t("Mon")}</span>
            <span />
            <span>{t("Wed")}</span>
            <span />
            <span>{t("Fri")}</span>
            <span />
          </div>
          <div
            role="img"
            aria-label={t("Daily document activity over the past year")}
            className="grid"
            style={{
              gridTemplateRows: "repeat(7, 11px)",
              gridTemplateColumns: `repeat(${weeks}, 11px)`,
              gridAutoFlow: "column",
              gap: 3,
            }}
          >
            {values.slice(0, weeks * 7).map((day) => {
              const isFuture = day.date > todayKey;
              const strength = Math.round(22 + (day.value / max) * 78);
              return (
                <span
                  key={day.date}
                  title={`${new Date(`${day.date}T12:00:00`).toLocaleDateString(locale)}: ${day.value} ${day.value === 1 ? t("document") : t("documents")}`}
                  className="size-[11px] rounded-[3px] border border-foreground/5"
                  style={{
                    opacity: isFuture ? 0 : day.value === 0 ? 0.28 : 1,
                    backgroundColor:
                      day.value > 0
                        ? `color-mix(in oklab, var(--primary) ${strength}%, var(--card))`
                        : "color-mix(in oklab, var(--foreground) 8%, transparent)",
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
