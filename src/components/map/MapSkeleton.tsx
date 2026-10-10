import { motion } from "motion/react";
import { useT } from "@/lib/ui-prefs";

/** Animated map placeholder: grid streets, sweeping shimmer and a pulsing pin. */
export function MapSkeleton() {
  const t = useT();
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-muted"
      aria-label={t("Loading map")}
      role="status"
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(to right, oklch(0 0 0 / 0.06) 1px, transparent 1px), linear-gradient(to bottom, oklch(0 0 0 / 0.06) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(115deg, transparent 46%, oklch(0.78 0.15 44 / 0.22) 50%, transparent 54%)",
          backgroundSize: "220px 220px",
        }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-y-0 w-1/3"
        style={{
          background: "linear-gradient(90deg, transparent, oklch(1 0 0 / 0.55), transparent)",
        }}
        animate={{ x: ["-40%", "320%"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="absolute inset-0 grid place-items-center">
        <div className="relative grid place-items-center">
          {[0, 0.5].map((d) => (
            <motion.span
              key={d}
              aria-hidden
              className="absolute size-16 rounded-full border border-primary/40"
              initial={{ scale: 0.4, opacity: 0.7 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ duration: 1.8, delay: d, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
          <motion.span
            className="size-3.5 rounded-full bg-primary shadow-lg"
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="absolute top-12 text-[10px] font-bold tracking-[0.24em] uppercase text-muted-foreground">
            {t("Loading map")}
          </span>
        </div>
      </div>
    </div>
  );
}

export default MapSkeleton;
