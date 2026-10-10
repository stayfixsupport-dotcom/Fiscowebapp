import { useUIPreferences } from "./ui-prefs";

export function useCalm(): [boolean, (next: boolean) => void] {
  useUIPreferences();
  return [true, () => undefined];
}

export function useCalmValue(): boolean {
  useUIPreferences();
  return true;
}
