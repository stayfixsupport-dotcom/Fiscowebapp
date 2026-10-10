import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { Label } from "@/components/kit";
import { sfx } from "@/lib/sfx";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";
import { LanguagePicker } from "@/components/LanguagePicker";

type ThemeRevealState = {
  theme: "light" | "dark";
  phase: "covering" | "leaving";
};

function Picker<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: readonly { value: T; label: string; icon?: typeof Sun }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-1.5 rounded-2xl bg-secondary/65 p-1.5",
        options.length === 2 ? "grid-cols-2" : "grid-cols-3",
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            type="button"
            key={option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "press relative min-w-0 rounded-xl px-2 py-3 text-xs font-bold",
              active ? "text-foreground" : "text-muted-foreground",
              disabled && "cursor-wait",
            )}
          >
            <span
              className={cn(
                "absolute inset-0 rounded-xl transition",
                active && "bg-card shadow-soft",
              )}
            />
            <span className="relative flex items-center justify-center gap-1.5">
              {Icon && <Icon className="size-3.5" />}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ThemeReveal({
  entry,
  onComplete,
}: {
  entry: ThemeRevealState | null;
  onComplete: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const t = useT();
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    entry && (
      <div
        key={entry.theme}
        aria-hidden="true"
        className={`theme-transition-curtain pointer-events-none fixed inset-0 z-[200] overflow-hidden ${entry.phase === "leaving" ? "theme-transition-curtain--out" : ""}`}
        onAnimationEnd={(event) => {
          if (entry.phase !== "leaving" || event.currentTarget !== event.target) return;
          sfx("reveal");
          onComplete();
        }}
      >
        <span
          className="absolute inset-0"
          style={{
            backgroundColor:
              entry.theme === "dark" ? "oklch(0.16 0.003 260)" : "oklch(0.955 0.005 275)",
          }}
        />
        <div
          className="theme-transition-copy absolute inset-0 grid place-items-center"
          style={{
            color: entry.theme === "dark" ? "oklch(0.94 0.003 260)" : "oklch(0.215 0.014 268)",
          }}
        >
          <div className="px-6 text-center">
            <span className="mx-auto mb-5 grid size-12 place-items-center rounded-full border border-current/15 bg-current/[0.04]">
              {entry.theme === "dark" ? (
                <Moon className="size-5" strokeWidth={1.7} />
              ) : (
                <Sun className="size-5" strokeWidth={1.7} />
              )}
            </span>
            <span className="block text-[10px] font-bold tracking-[0.32em] uppercase opacity-55">
              Fisco · {t("appearance")}
            </span>
            <span className="mt-2 block text-[34px] leading-none font-extrabold sm:text-[42px]">
              {t(entry.theme === "dark" ? "Dark mode" : "Light mode")}
            </span>
            <span className="serif mt-2 block text-[17px] opacity-65">
              {entry.theme === "dark"
                ? t("A calmer canvas for focused work")
                : t("Clear light, ready for work")}
            </span>
          </div>
        </div>
      </div>
    ),
    document.body,
  );
}

export function AppearanceSettings({ onNotice }: { onNotice?: (message: string) => void }) {
  const { preferences, updatePreferences } = useUIPreferences();
  const t = useT();
  const [transition, setTransition] = useState<ThemeRevealState | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const transitionTheme = transition?.theme;

  useEffect(() => {
    if (!transitionTheme) return;
    const applyTimer = window.setTimeout(() => {
      updatePreferences({ theme: transitionTheme });
    }, 180);
    const bloomTimer = window.setTimeout(() => sfx("bloom"), 200);
    const finishTimer = window.setTimeout(() => {
      setTransition((current) => (current ? { ...current, phase: "leaving" } : null));
    }, 440);
    return () => {
      window.clearTimeout(applyTimer);
      window.clearTimeout(bloomTimer);
      window.clearTimeout(finishTimer);
    };
  }, [transitionTheme, updatePreferences]);

  const changeTheme = (theme: "light" | "dark") => {
    if (theme === preferences.theme || transitioning) return;
    if (preferences.reducedMotion) {
      sfx("confirm");
      updatePreferences({ theme });
      onNotice?.(t(theme === "dark" ? "Dark theme selected" : "Light theme selected"));
      return;
    }

    sfx("mode");
    onNotice?.(t(theme === "dark" ? "Dark theme selected" : "Light theme selected"));
    setTransitioning(true);
    setTransition({ theme, phase: "covering" });
  };

  return (
    <div>
      <Label>{t("Interface language")}</Label>
      <div className="mt-2 mb-4">
        <LanguagePicker
          value={preferences.language}
          interfaceOnly
          label={t("Choose interface language")}
          onChange={(language) => {
            if (typeof language !== "string") return;
            updatePreferences({ language });
            onNotice?.(t(`${language} selected`));
          }}
        />
      </div>
      <Label>{t("Theme")}</Label>
      <div className="mt-2">
        <Picker
          value={preferences.theme}
          options={[
            { value: "light", label: t("Light"), icon: Sun },
            { value: "dark", label: t("Dark mode"), icon: Moon },
          ]}
          onChange={changeTheme}
          disabled={transitioning}
        />
      </div>
      <ThemeReveal entry={transition} onComplete={() => setTransitioning(false)} />
    </div>
  );
}
