import { useSyncExternalStore } from "react";
import type { UIMessage } from "ai";

import {
  deriveTitle,
  loadThreads,
  messageText,
  newThread,
  saveThreads,
  upsertThread,
  type Thread,
} from "./threads";
import { supabase } from "@/integrations/supabase/client";

let threads: Thread[] | null = null;
let activeOwnerId: string | null = null;
const listeners = new Set<() => void>();
const EMPTY: Thread[] = [];
const syncQueues = new Map<string, Promise<boolean>>();

function ensure(ownerId?: string): Thread[] {
  const ownerKey = ownerId ?? null;
  if (threads === null || activeOwnerId !== ownerKey) {
    activeOwnerId = ownerKey;
    threads = loadThreads(ownerId);
  }
  return threads;
}

function commit(next: Thread[], ownerId?: string) {
  activeOwnerId = ownerId ?? null;
  threads = next;
  saveThreads(next, ownerId);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThreads(ownerId?: string): Thread[] {
  return useSyncExternalStore(
    subscribe,
    () => ensure(ownerId),
    () => EMPTY,
  );
}

export function getThread(id: string, ownerId?: string): Thread | undefined {
  return ensure(ownerId).find((t) => t.id === id);
}

/** Returns an existing most-recent thread id, or creates a fresh thread. */
export function ensureThread(ownerId?: string): string {
  const list = ensure(ownerId);
  const first = list[0];
  if (first) return first.id;
  const thread = newThread();
  commit([thread], ownerId);
  return thread.id;
}

export function createThread(ownerId?: string): string {
  const thread = newThread();
  commit(upsertThread(ensure(ownerId), thread), ownerId);
  return thread.id;
}

export async function deleteThread(id: string, ownerId?: string): Promise<boolean> {
  if (ownerId) {
    const pendingSync = syncQueues.get(`${ownerId}:${id}`);
    if (pendingSync) await pendingSync.catch(() => false);
    const { error } = await supabase
      .from("ai_threads" as never)
      .delete()
      .eq("id", id)
      .eq("user_id", ownerId);
    if (error) return false;
  }
  commit(
    ensure(ownerId).filter((t) => t.id !== id),
    ownerId,
  );
  return true;
}

export async function renameThread(id: string, title: string, ownerId?: string): Promise<boolean> {
  const existing = getThread(id, ownerId);
  if (!existing) return false;
  const updatedAt = Date.now();
  if (ownerId) {
    const { error } = await supabase
      .from("ai_threads" as never)
      .update({ title, updated_at: new Date(updatedAt).toISOString() } as never)
      .eq("id", id)
      .eq("user_id", ownerId);
    if (error) return false;
  }
  commit(upsertThread(ensure(ownerId), { ...existing, title, updatedAt }), ownerId);
  return true;
}

export function saveMessages(id: string, messages: UIMessage[], ownerId?: string) {
  if (messages.length === 0) return;
  const existing = getThread(id, ownerId) ?? {
    id,
    title: "New conversation",
    updatedAt: 0,
    messages: [],
  };
  const title =
    existing.title === "New conversation" || existing.title === "Nouvelle conversation"
      ? deriveTitle(messages, existing.title)
      : existing.title;
  commit(
    upsertThread(ensure(ownerId), { ...existing, title, messages, updatedAt: Date.now() }),
    ownerId,
  );
}

type AiThreadRow = { id: string; title: string; updated_at: string };
type AiMessageRow = {
  id: string;
  thread_id: string;
  role: string;
  parts: unknown;
  created_at: string;
};

export async function loadUserThreads(ownerId: string): Promise<Thread[]> {
  const { data: threadData, error: threadError } = await supabase
    .from("ai_threads" as never)
    .select("id,title,updated_at")
    .eq("user_id", ownerId)
    .order("updated_at", { ascending: false });
  if (threadError) throw threadError;

  const remoteThreads = (threadData ?? []) as unknown as AiThreadRow[];
  if (remoteThreads.length === 0) return [];
  const threadIds = remoteThreads.map((thread) => thread.id);
  const { data: messageData, error: messageError } = await supabase
    .from("ai_messages" as never)
    .select("id,thread_id,role,parts,created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true });
  if (messageError) throw messageError;

  const grouped = new Map<string, UIMessage[]>();
  for (const row of (messageData ?? []) as unknown as AiMessageRow[]) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const parts = Array.isArray(row.parts) ? (row.parts as UIMessage["parts"]) : [];
    const messages = grouped.get(row.thread_id) ?? [];
    messages.push({ id: row.id, role: row.role, parts });
    grouped.set(row.thread_id, messages);
  }

  return remoteThreads
    .map((thread) => ({
      id: thread.id,
      title: thread.title || "New conversation",
      updatedAt: new Date(thread.updated_at).getTime(),
      messages: grouped.get(thread.id) ?? [],
    }))
    .filter((thread) => thread.messages.length > 0);
}

export function mergeThreads(remoteThreads: Thread[], ownerId: string): Thread[] {
  const merged = new Map(remoteThreads.map((thread) => [thread.id, thread]));
  for (const localThread of ensure(ownerId)) {
    if (localThread.messages.length === 0) continue;
    const remoteThread = merged.get(localThread.id);
    const localHasMoreCompleteTranscript =
      remoteThread !== undefined &&
      localThread.messages.length >= remoteThread.messages.length &&
      remoteThread.messages.every((remoteMessage, index) => {
        const localMessage = localThread.messages[index];
        if (!localMessage || localMessage.role !== remoteMessage.role) return false;
        const remoteText = messageText(remoteMessage);
        const localText = messageText(localMessage);
        return !remoteText || localText === remoteText || localText.startsWith(remoteText);
      }) &&
      (localThread.messages.length > remoteThread.messages.length ||
        remoteThread.messages.some((message, index) => {
          const localMessage = localThread.messages[index]!;
          return messageText(localMessage).length > messageText(message).length;
        }));
    if (
      !remoteThread ||
      localThread.updatedAt >= remoteThread.updatedAt ||
      localHasMoreCompleteTranscript
    ) {
      merged.set(localThread.id, localThread);
    }
  }
  const next = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  commit(next, ownerId);
  return next;
}

async function writeThreadToSupabase(ownerId: string, thread: Thread): Promise<boolean> {
  const messages = thread.messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    if (message.role === "assistant" && !messageText(message)) return [];
    return [{ role: message.role, parts: message.parts }];
  });
  if (messages.length === 0) return true;

  const { error: threadError } = await supabase.from("ai_threads" as never).upsert(
    {
      id: thread.id,
      user_id: ownerId,
      title: thread.title,
      updated_at: new Date(thread.updatedAt).toISOString(),
    } as never,
    { onConflict: "id" },
  );
  if (threadError) return false;

  const { error } = await supabase.rpc(
    "replace_ai_thread_messages" as never,
    { p_thread_id: thread.id, p_messages: messages } as never,
  );
  return !error;
}

export async function syncThreadToSupabase(ownerId: string, thread: Thread): Promise<boolean> {
  const queueKey = `${ownerId}:${thread.id}`;
  const previous = syncQueues.get(queueKey) ?? Promise.resolve(true);
  const current = previous.catch(() => false).then(() => writeThreadToSupabase(ownerId, thread));
  syncQueues.set(queueKey, current);
  try {
    return await current;
  } finally {
    if (syncQueues.get(queueKey) === current) syncQueues.delete(queueKey);
  }
}
