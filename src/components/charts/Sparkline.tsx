import { motion } from "motion/react";
import { useId } from "react";

export type Point = { label: string; value: number };

function build(data: Point[], w: number, h: number, pad = 6) {
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({
    x: pad + i * step,
    y: pad + (1 - (d.value - min) / span) * (h - pad * 2),
  }));
  const first = pts[0] ?? { x: pad, y: h / 2 };
  const last = pts[pts.length - 1] ?? first;
  const line = pts
    .map((p, i) => {
      const prev = pts[i - 1];
      if (i === 0 || !prev) return `M ${p.x} ${p.y}`;
      const cx = (prev.x + p.x) / 2;
      return `C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`;
    })
    .join(" ");
  const area = `${line} L ${last.x} ${h} L ${first.x} ${h} Z`;
  return { pts, line, area };
}

/** Smooth area sparkline. Animates its stroke on mount. */
export function Sparkline({
  data,
  className,
  height = 96,
  width = 320,
  showDots = false,
  activeIndex,
}: {
  data: Point[];
  className?: string | undefined;
  height?: number | undefined;
  width?: number | undefined;
  showDots?: boolean | undefined;
  activeIndex?: number | undefined;
}) {
  const id = useId().replace(/:/g, "");
  const { pts, line, area } = build(data, width, height);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className ?? "size-full"}
      role="img"
      aria-label="Spending trend"
    >
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#fill-${id})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      />
      {(showDots ? pts : []).map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={activeIndex === i ? 4.5 : 2.5}
          fill="currentColor"
          opacity={activeIndex === undefined || activeIndex === i ? 1 : 0.35}
        />
      ))}
    </svg>
  );
}

export default Sparkline;
