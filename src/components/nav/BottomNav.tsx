import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  House,
  FileText,
  MapPin,
  ChartNoAxesColumn,
  ScanLine,
  Inbox,
  Users,
  LineChart,
  CheckCheck,
} from "lucide-react";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

const TAXPAYER = {
  left: [
    { to: "/", label: "Home", icon: House },
    { to: "/documents", label: "Docs", icon: FileText },
  ],
  center: { to: "/scan", label: "Scan", icon: ScanLine },
  right: [
    { to: "/map", label: "Nearby", icon: MapPin },
    { to: "/activity", label: "Insights", icon: ChartNoAxesColumn },
  ],
} as const;

const ACCOUNTANT = {
  left: [
    { to: "/", label: "Home", icon: House },
    { to: "/clients", label: "Clients", icon: Users },
  ],
  center: { to: "/inbox", label: "Inbox", icon: Inbox },
  right: [
    { to: "/practice", label: "Practice", icon: LineChart },
    { to: "/documents", label: "Filed", icon: CheckCheck },
  ],
} as const;

export function BottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { role } = useStore();
  const { preferences } = useUIPreferences();
  const t = useT();
  const [compact, setCompact] = useState(false);
  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));

  useEffect(() => {
    if (path.startsWith("/chat") || path.startsWith("/fisco-ai")) return;
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const nextY = window.scrollY;
        if (preferences.bottomNavBehavior === "compact") setCompact(true);
        else if (preferences.bottomNavBehavior === "expanded") setCompact(false);
        else if (nextY < 28) setCompact(false);
        else if (nextY > lastY + 5) setCompact(true);
        else if (nextY < lastY - 5) setCompact(false);
        lastY = nextY;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [path, preferences.bottomNavBehavior]);

  if (path.startsWith("/chat") || path.startsWith("/fisco-ai") || !role) return null;
  const set = role === "accountant" ? ACCOUNTANT : TAXPAYER;
  const Center = set.center.icon;

  return (
    <div className="fisco-native-bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-5">
      <nav
        className="fisco-bottom-nav-surface nav-rim pointer-events-auto flex items-center gap-0.5 rounded-full transition-[padding] duration-150 ease-out"
        style={{ padding: compact ? 4 : 6 }}
      >
        {set.left.map((it) => (
          <NavItem
            key={it.to}
            {...it}
            label={t(it.label)}
            active={isActive(it.to)}
            compact={compact}
          />
        ))}

        <Link
          to={set.center.to}
          aria-label={t(set.center.label)}
          onClick={() => sfx("pop")}
          className="press button-rim relative mx-1 grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
          style={{ boxShadow: "var(--shadow-accent)" }}
        >
          <Center className="size-[19px]" strokeWidth={2.1} />
        </Link>

        {set.right.map((it) => (
          <NavItem
            key={it.to}
            {...it}
            label={t(it.label)}
            active={isActive(it.to)}
            compact={compact}
          />
        ))}
      </nav>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
  compact,
}: {
  to: string;
  label: string;
  icon: typeof House;
  active: boolean;
  compact: boolean;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      onClick={() => sfx("tap")}
      onPointerEnter={() => {
        sfx("hover");
        // warm the heavy map chunk before the user lands on it
        if (to === "/map") void import("@/components/map/MapCanvas");
      }}
      className="relative grid h-11 place-items-center rounded-full"
      style={{ width: compact ? 46 : 54 }}
    >
      {active && (
        <motion.span
          layoutId="nav-pill"
          className="fisco-bottom-nav-active-pill absolute inset-0 rounded-full bg-ink-foreground/14"
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
        />
      )}
      <span
        className={`relative z-10 grid place-items-center text-ink-foreground transition-opacity duration-100 ${active ? "opacity-100" : "opacity-45"}`}
      >
        <Icon className="size-[17px]" strokeWidth={active ? 2.4 : 1.9} />
        {!compact && (
          <span className="mt-[3px] text-[8px] leading-none font-bold tracking-[0.08em] uppercase">
            {label}
          </span>
        )}
      </span>
    </Link>
  );
}
