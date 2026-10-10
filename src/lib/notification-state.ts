const READ_KEY = "fisco.notifications.read.v1";
const DISMISSED_KEY = "fisco.notifications.dismissed.v1";

export function readNotificationIds(scope: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(`${READ_KEY}.${scope}`);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveReadNotificationIds(scope: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${READ_KEY}.${scope}`, JSON.stringify(ids));
  } catch {
    // Notifications remain usable when storage is unavailable.
  }
}

export function readDismissedNotificationIds(scope: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(`${DISMISSED_KEY}.${scope}`);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveDismissedNotificationIds(scope: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${DISMISSED_KEY}.${scope}`, JSON.stringify(ids));
  } catch {
    // Notifications remain usable when storage is unavailable.
  }
}
