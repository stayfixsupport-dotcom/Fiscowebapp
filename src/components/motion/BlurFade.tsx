import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { useCalmValue } from "@/lib/motion-prefs";

type Props = {
  children: ReactNode;
  delay?: number;
  y?: number;
  blur?: number;
  className?: string;
  once?: boolean;
  inView?: boolean;
};

/** Lightweight rise reveal used across screen entrances. */
export function BlurFade({
  children,
  delay = 0,
  y = 18,
  blur = 12,
  className,
  once = true,
  inView = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { once, margin: "-8% 0px -8% 0px" });
  const prefersReducedMotion = useReducedMotion();
  const calmMotion = useCalmValue();
  const reduce = prefersReducedMotion || calmMotion;
  const active = inView ? visible : true;

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.42, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
