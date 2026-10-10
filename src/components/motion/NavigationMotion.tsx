import { AnimatePresence, motion } from "motion/react";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUIPreferences } from "@/lib/ui-prefs";

type Origin = { x: number; y: number };

const CENTER: Origin = { x: 50, y: 88 };

/** Native route bloom anchored to the control that opened the screen. */
export function NavigationMotion() {
  const { preferences } = useUIPreferences();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const previousPath = useRef(path);
  const origin = useRef<Origin>(CENTER);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const rememberOrigin = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest("a,button") : null;
      if (!target) return;
      const box = target.getBoundingClientRect();
      origin.current = {
        x: ((box.left + box.width / 2) / window.innerWidth) * 100,
        y: ((box.top + box.height / 2) / window.innerHeight) * 100,
      };
    };
    window.addEventListener("pointerdown", rememberOrigin, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", rememberOrigin, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (previousPath.current === path) return;
    previousPath.current = path;
    setPulse((value) => value + 1);
  }, [path]);

  if (
    preferences.reducedMotion ||
    preferences.navigationAnimation === "none" ||
    path === "/fisco-ai"
  ) {
    return null;
  }
  return (
    <AnimatePresence>
      {pulse > 0 && (
        <motion.div
          key={pulse}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[80] overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.12, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, times: [0, 0.35, 1], ease: "easeOut" }}
        >
          <motion.span
            className="absolute size-14 rounded-full border border-primary/20 bg-primary/8"
            style={{
              left: `${origin.current.x}%`,
              top: `${origin.current.y}%`,
              x: "-50%",
              y: "-50%",
            }}
            initial={{ scale: 0.2, opacity: 0.5 }}
            animate={{ scale: 4, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * RouteStage: lightweight container that preserves native document flow and smooth scrolling.
 */
export function RouteStage({ children }: { children: ReactNode }) {
  return <div className="relative min-h-screen w-full">{children}</div>;
}
