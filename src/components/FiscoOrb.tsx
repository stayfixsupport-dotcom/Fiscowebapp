import orb from "@/assets/fisco-orb.png";
import { cn } from "@/lib/utils";

type FiscoOrbProps = {
  className?: string;
  /** Size in px. */
  size?: number;
  state?: "idle" | "thinking" | "speaking";
  priority?: boolean;
};

/** Grounded orb — no floating. Thinking adds a rotating ring and a breathing glow. */
export function FiscoOrb({ className, size = 48, state = "idle", priority = false }: FiscoOrbProps) {
  const active = state !== "idle";
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} aria-hidden>
      <span
        className={cn(
          "absolute inset-[-14%] rounded-full bg-aurora-1/35 blur-xl",
          active && "animate-breathe",
        )}
      />
      {active && (
        <span
          className="absolute inset-[-8%] rounded-full animate-orb-spin [animation-duration:1.6s]"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0 60%, var(--aurora-2) 80%, var(--aurora-3) 92%, transparent)",
            mask: "radial-gradient(circle, transparent 62%, black 64%)",
            WebkitMask: "radial-gradient(circle, transparent 62%, black 64%)",
          }}
        />
      )}
      <img
        src={orb}
        alt=""
        width={size}
        height={size}
        loading={priority ? "eager" : "lazy"}
        className="relative size-full object-contain"
      />
    </div>
  );
}
