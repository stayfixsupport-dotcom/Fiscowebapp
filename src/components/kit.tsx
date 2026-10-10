import { motion } from "motion/react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ---------------- Segmented control ---------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "light",
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  tone?: "light" | "ink" | "glass";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "no-scrollbar flex gap-1 overflow-x-auto rounded-full p-1",
        tone === "light" && "bg-secondary/80",
        tone === "ink" && "bg-ink-foreground/10",
        tone === "glass" && "glass",
        className,
      )}
    >
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={cn(
              "press relative shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold tracking-tight transition-colors",
              active
                ? tone === "ink"
                  ? "text-ink"
                  : "text-foreground"
                : tone === "ink"
                  ? "text-ink-foreground/55"
                  : "text-muted-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${tone}-${options.join()}`}
                className={cn(
                  "absolute inset-0 rounded-full",
                  tone === "ink" ? "bg-ink-foreground" : "bg-card shadow-soft",
                )}
                transition={{ type: "spring", stiffness: 460, damping: 36 }}
              />
            )}
            <span className="relative z-10">{o}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Buttons ---------------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "accent" | "ink" | "glass" | "ghost";
  size?: "sm" | "md" | "lg";
};

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(
  ({ className, variant = "accent", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "press button-rim inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight whitespace-nowrap disabled:opacity-45",
        size === "lg" && "h-13 px-6 text-[14.5px]",
        size === "md" && "h-11 px-5 text-[13.5px]",
        size === "sm" && "h-9 px-4 text-[12.5px]",
        variant === "accent" && "bg-primary text-primary-foreground",
        variant === "ink" && "bg-ink text-ink-foreground",
        variant === "glass" && "glass text-foreground",
        variant === "ghost" && "bg-secondary/80 text-foreground",
        className,
      )}
      style={variant === "accent" ? { boxShadow: "var(--shadow-accent)" } : undefined}
      {...props}
    />
  ),
);
Btn.displayName = "Btn";

export function IconBtn({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "press glass button-rim grid size-11 shrink-0 place-items-center rounded-full text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------------- Bento ---------------- */

export function Bento({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-2.5 lg:grid-cols-4", className)}>{children}</div>;
}

export function Card({
  children,
  className,
  tone = "light",
}: {
  children: ReactNode;
  className?: string;
  tone?: "light" | "ink" | "glass" | "accent" | "bare";
}) {
  return (
    <div
      className={cn(
        "rounded-3xl",
        tone === "light" && "surface-card",
        tone === "ink" && "surface-ink grain",
        tone === "glass" && "glass",
        tone === "accent" && "bg-primary text-primary-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] font-bold tracking-[0.18em] uppercase opacity-50", className)}>
      {children}
    </span>
  );
}

export function Chip({
  children,
  className,
  tone = "light",
}: {
  children: ReactNode;
  className?: string;
  tone?: "light" | "ink" | "accent" | "positive";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-tight",
        tone === "light" && "bg-secondary/80 text-foreground/70",
        tone === "ink" && "bg-ink-foreground/12 text-ink-foreground",
        tone === "accent" && "bg-primary/12 text-primary",
        tone === "positive" && "bg-positive/12 text-positive",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Breathing live indicator — part of the app's idle motion language. */
export function Live({ className }: { className?: string }) {
  return (
    <span className={cn("relative grid size-2 place-items-center", className)}>
      <span className="breathe absolute inset-[-3px] rounded-full bg-positive/35" />
      <span className="size-2 rounded-full bg-positive" />
    </span>
  );
}

export function Meter({
  value,
  delay = 0,
  className,
  tone = "accent",
}: {
  value: number;
  delay?: number;
  className?: string;
  tone?: "accent" | "ink" | "light";
}) {
  return (
    <div
      className={cn(
        "h-1 overflow-hidden rounded-full",
        tone === "ink" ? "bg-ink-foreground/12" : "bg-foreground/8",
        className,
      )}
    >
      <motion.div
        className={cn(
          "h-full rounded-full",
          tone === "light"
            ? "bg-foreground/60"
            : tone === "ink"
              ? "bg-ink-foreground"
              : "bg-primary",
        )}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        viewport={{ once: true }}
        transition={{ delay, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

export function Avatar({
  src,
  initials,
  size = 44,
  className,
  ring,
}: {
  src?: string | undefined;
  initials: string;
  size?: number | undefined;
  className?: string | undefined;
  ring?: boolean | undefined;
}) {
  const hasImage = Boolean(src && src.trim().length > 0);

  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-[radial-gradient(circle_at_30%_30%,oklch(0.78_0.18_305/0.9),oklch(0.62_0.14_42/0.9)_35%,oklch(0.24_0.02_268)_100%)] text-[12px] font-bold text-white shadow-[0_12px_30px_-18px_oklch(0.68_0.17_40/0.9)]",
        ring && "ring-2 ring-card ring-offset-2 ring-offset-primary/25",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {!hasImage && (
        <span className="relative z-10 tracking-[-0.05em]">{initials}</span>
      )}
      {hasImage && (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover object-center"
        />
      )}
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.28),transparent_42%)]" />
    </div>
  );
}

export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12.5px] font-bold", className)}>
      <svg viewBox="0 0 24 24" className="size-3 fill-primary">
        <path d="M12 2l3 6.6 7 .8-5.2 4.8 1.4 7-6.2-3.6L5.8 21l1.4-7L2 9.4l7-.8z" />
      </svg>
      {rating.toFixed(1)}
    </span>
  );
}
