import { motion, useMotionValue, animate, type PanInfo } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type SheetState = "collapsed" | "half" | "full";

/**
 * Drag-driven sheet with velocity aware snapping. `snaps` are heights in px.
 */
export function BottomSheet({
  snaps,
  state,
  onStateChange,
  children,
  className,
  onToggle,
  collapsed,
}: {
  snaps: Record<SheetState, number>;
  state: SheetState;
  onStateChange: (s: SheetState) => void;
  children: ReactNode;
  className?: string;
  onToggle?: () => void;
  collapsed?: boolean;
}) {
  const height = useMotionValue(snaps[state]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (dragging) return;
    const controls = animate(height, snaps[state], {
      type: "spring",
      stiffness: 320,
      damping: 34,
    });
    return () => controls.stop();
  }, [state, snaps, height, dragging]);

  const settle = (_: unknown, info: PanInfo) => {
    setDragging(false);
    const current = height.get() + -info.velocity.y * 0.12;
    const order: SheetState[] = ["collapsed", "half", "full"];
    const best = order.reduce((acc, s) =>
      Math.abs(snaps[s] - current) < Math.abs(snaps[acc] - current) ? s : acc,
    );
    onStateChange(best);
  };

  return (
    <motion.div
      style={{ height }}
      className={cn(
        "glass pointer-events-auto flex w-full flex-col overflow-hidden rounded-t-[34px] md:rounded-[34px]",
        className,
      )}
    >
      <motion.div
        onPanStart={() => setDragging(true)}
        onPan={(_, info) => {
          const next = Math.min(snaps.full, Math.max(snaps.collapsed, height.get() - info.delta.y));
          height.set(next);
        }}
        onPanEnd={settle}
        className="relative flex h-11 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1.5 w-11 rounded-full bg-foreground/15" />
        {onToggle && (
          <button
            type="button"
            aria-label={collapsed ? "Expand list" : "Collapse list"}
            onClick={onToggle}
            className="press absolute right-3 grid size-8 place-items-center rounded-full bg-secondary/80 text-foreground/70"
          >
            {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        )}
      </motion.div>
      <div
        className={cn(
          "no-scrollbar min-h-0 flex-1",
          state === "collapsed" ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}
