export function AuroraBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <div
        className="absolute inset-0 opacity-70"
        style={{ background: "var(--gradient-aurora)" }}
      />
      <div className="absolute inset-0 bg-background/45" />
    </div>
  );
}
