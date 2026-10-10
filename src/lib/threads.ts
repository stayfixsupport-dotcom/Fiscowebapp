import type { UIMessage } from "ai";

export type Thread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
};

const KEY = "fisco.threads.v1";

function storageKey(ownerId?: string) {
  return ownerId ? `${KEY}.${ownerId}` : KEY;
}

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function loadThreads(ownerId?: string): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Thread[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === "string")
      .map((t) => ({ ...t, messages: Array.isArray(t.messages) ? t.messages : [] }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveThreads(threads: Thread[], ownerId?: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(ownerId), JSON.stringify(threads));
  } catch {
    /* storage full or unavailable — chat still works for this session */
  }
}

export function newThread(): Thread {
  return { id: createId(), title: "New conversation", updatedAt: Date.now(), messages: [] };
}

export function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

export function deriveTitle(messages: UIMessage[], fallback: string) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return fallback;
  const text = messageText(first);
  if (!text) return fallback;
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

export function upsertThread(threads: Thread[], thread: Thread): Thread[] {
  const rest = threads.filter((t) => t.id !== thread.id);
  return [thread, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
}
