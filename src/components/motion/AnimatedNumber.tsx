import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
};

export function AnimatedNumber({
  value,
  format = (n) => n.toFixed(0),
  className,
  duration = 1.1,
}: Props) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <span className={className}>{format(display)}</span>;
}
