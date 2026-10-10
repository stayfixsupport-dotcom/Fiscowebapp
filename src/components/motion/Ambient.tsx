/**
 * Ambient light field — the app's idle motion layer.
 * Two soft, static lights behind the content.
 */
export function Ambient({ tone = "light" }: { tone?: "light" | "ink" }) {
  return (
    <div
      aria-hidden
      className="ambient-glow pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ contain: "strict" }}
    >
      <div
        className="absolute -top-[18%] -left-[14%] size-[40vmax] rounded-full"
        style={{
          background:
            tone === "ink"
              ? "radial-gradient(circle, oklch(0.645 0.168 40 / 0.2), transparent 68%)"
              : "radial-gradient(circle, oklch(0.86 0.07 52 / 0.5), transparent 68%)",
        }}
      />
      <div
        className="absolute -right-[16%] top-[28%] size-[38vmax] rounded-full"
        style={{
          background:
            tone === "ink"
              ? "radial-gradient(circle, oklch(0.62 0.13 292 / 0.18), transparent 68%)"
              : "radial-gradient(circle, oklch(0.84 0.06 292 / 0.45), transparent 68%)",
        }}
      />
    </div>
  );
}
