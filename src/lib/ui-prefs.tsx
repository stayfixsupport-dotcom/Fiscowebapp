import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LANGUAGES } from "@/lib/languages";
import { translateUi } from "@/lib/i18n";

export type ThemeChoice = "light" | "dark";
export type MotionIntensity = "subtle" | "balanced" | "expressive";
export type NavigationAnimation = "blur" | "fade" | "none";
export type BottomNavBehavior = "adaptive" | "expanded" | "compact";
export type HeaderBehavior = "adaptive" | "glass" | "clear";

export type UIPreferences = {
  theme: ThemeChoice;
  language: string;
  motionIntensity: MotionIntensity;
  reducedMotion: boolean;
  navigationAnimation: NavigationAnimation;
  bottomNavBehavior: BottomNavBehavior;
  headerBehavior: HeaderBehavior;
  learningTips: boolean;
  learningTipSeen: boolean;
};

export const UI_PREFS_KEY = "fisco.ui-preferences.v1";

export const DEFAULT_UI_PREFS: UIPreferences = {
  theme: "light",
  language: "English",
  motionIntensity: "balanced",
  reducedMotion: false,
  navigationAnimation: "blur",
  bottomNavBehavior: "adaptive",
  headerBehavior: "adaptive",
  learningTips: true,
  learningTipSeen: false,
};

function deviceInterfaceLanguage() {
  if (typeof navigator === "undefined") return DEFAULT_UI_PREFS.language;
  const locales = [...(navigator.languages ?? []), navigator.language];
  const code = locales
    .map((locale) => locale.toLowerCase().split(/[-_]/)[0])
    .find((locale) => locale === "en" || locale === "fr" || locale === "ar");
  return code === "fr" ? "French" : code === "ar" ? "Arabic" : "English";
}

function readPreferences(): UIPreferences {
  if (typeof window === "undefined") return DEFAULT_UI_PREFS;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const defaults = { ...DEFAULT_UI_PREFS, language: deviceInterfaceLanguage() };
  try {
    const raw = window.localStorage.getItem(UI_PREFS_KEY);
    return raw
      ? { ...defaults, ...(JSON.parse(raw) as Partial<UIPreferences>), reducedMotion }
      : { ...defaults, reducedMotion };
  } catch {
    return { ...defaults, reducedMotion };
  }
}

function resolveDark(theme: ThemeChoice) {
  return theme === "dark";
}

export function applyUIPreferences(prefs: UIPreferences) {
  if (typeof document === "undefined") return;
  const language = LANGUAGES.find((item) => item.name === prefs.language);
  document.documentElement.lang = language?.code ?? "en";
  document.documentElement.dir = language?.code === "ar" ? "rtl" : "ltr";
  document.documentElement.classList.toggle("dark", resolveDark(prefs.theme));
  document.documentElement.dataset["theme"] = prefs.theme;
  document.documentElement.dataset["motion"] = prefs.motionIntensity;
  document.documentElement.dataset["calm"] = prefs.reducedMotion ? "true" : "false";
  document.documentElement.dataset["navigation"] = prefs.navigationAnimation;
  document.documentElement.dataset["header"] = prefs.headerBehavior;
}

type UIPreferencesContextValue = {
  preferences: UIPreferences;
  preferencesReady: boolean;
  updatePreferences: (patch: Partial<UIPreferences>) => void;
  resetLearningTip: () => void;
};

const UIPreferencesContext = createContext<UIPreferencesContextValue | null>(null);

export function UIPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<UIPreferences>(DEFAULT_UI_PREFS);
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    const stored = readPreferences();
    setPreferences(stored);
    applyUIPreferences(stored);
    setPreferencesReady(true);
  }, []);

  const updatePreferences = useCallback((patch: Partial<UIPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      if (next.theme !== current.theme) {
        window.requestAnimationFrame(() => applyUIPreferences(next));
      } else {
        applyUIPreferences(next);
      }
      try {
        window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next));
      } catch {
        /* unavailable storage */
      }
      window.dispatchEvent(new CustomEvent("fisco:ui-preferences", { detail: next }));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      preferences,
      preferencesReady,
      updatePreferences,
      resetLearningTip: () => updatePreferences({ learningTips: true, learningTipSeen: false }),
    }),
    [preferences, preferencesReady, updatePreferences],
  );

  return <UIPreferencesContext.Provider value={value}>{children}</UIPreferencesContext.Provider>;
}

export function useUIPreferences() {
  const context = useContext(UIPreferencesContext);
  if (!context) throw new Error("useUIPreferences must be used inside UIPreferencesProvider");
  return context;
}

export function useT() {
  const { preferences } = useUIPreferences();
  return useCallback(
    (message: string) => translateUi(message, preferences.language),
    [preferences.language],
  );
}
