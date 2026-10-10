import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/app-store";
import { loadHumanChat } from "@/lib/human-chat";
import { loadUserThreads } from "@/lib/thread-store";
import { messageText } from "@/lib/threads";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMsg, ChatThread } from "@/lib/chat";
import type { Thread } from "@/lib/threads";
import type { NotificationEvent } from "@/lib/notification-events";
import { sfx } from "@/lib/sfx";

const playedNotificationSounds = new Set<string>();

type PersistedNotification = {
  id: string;
  actor_id: string | null;
  kind:
    | "relationship_request"
    | "relationship_approved"
    | "relationship_rejected"
    | "holiday_auto_reply"
    | "message"
    | "appointment"
    | "appointment_request"
    | "service_case"
    | "review_reminder"
    | "document";
  title: string;
  body: string;
  entity_id: string;
  read_at: string | null;
  created_at: string;
};

export function useNotificationFeed() {
  const { role, user, docs } = useStore();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [aiThreads, setAiThreads] = useState<Thread[]>([]);
  const [persisted, setPersisted] = useState<PersistedNotification[]>([]);
  const [eventThreadIds, setEventThreadIds] = useState<Record<string, string>>({});
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [actorPhotos, setActorPhotos] = useState<Record<string, string>>({});
  const [feedReady, setFeedReady] = useState(false);
  const soundBootstrapped = useRef(false);
  const soundSeenIds = useRef(new Set<string>());

  useEffect(() => {
    soundBootstrapped.current = false;
    soundSeenIds.current.clear();
    setFeedReady(false);
  }, [role, user?.id]);

  useEffect(() => {
    if (!role || !user?.id) {
      setThreads([]);
      setMessages([]);
      setAiThreads([]);
      setPersisted([]);
      setEventThreadIds({});
      setActorNames({});
      setActorPhotos({});
      setFeedReady(false);
      return;
    }

    let active = true;
    const refresh = async () => {
      const [human, ai, notificationResult] = await Promise.allSettled([
        loadHumanChat(role, user.id),
        loadUserThreads(user.id),
        supabase
          .from("notifications" as never)
          .select("id, actor_id, kind, title, body, entity_id, read_at, created_at")
          .eq("recipient_id", user.id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (!active) return;
      setThreads(human.status === "fulfilled" ? human.value.threads : []);
      setMessages(human.status === "fulfilled" ? human.value.messages : []);
      setAiThreads(ai.status === "fulfilled" ? ai.value : []);
      const notifications =
        notificationResult.status === "fulfilled" && !notificationResult.value.error
          ? ((notificationResult.value.data ?? []) as unknown as PersistedNotification[])
          : [];
      setPersisted(notifications);
      const appointmentIds = notifications
        .filter((item) => item.kind === "appointment")
        .map((item) => item.entity_id);
      const serviceCaseIds = notifications
        .filter((item) => item.kind === "service_case" || item.kind === "review_reminder")
        .map((item) => item.entity_id);
      const [appointmentRows, serviceCaseRows] = await Promise.all([
        appointmentIds.length
          ? supabase
              .from("appointments" as never)
              .select("id, conversation_id")
              .in("id", appointmentIds)
          : Promise.resolve({ data: [] }),
        serviceCaseIds.length
          ? supabase
              .from("service_cases" as never)
              .select("id, conversation_id")
              .in("id", serviceCaseIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (active) {
        const eventRows = [
          ...((appointmentRows.data ?? []) as unknown as Array<{
            id: string;
            conversation_id: string;
          }>),
          ...((serviceCaseRows.data ?? []) as unknown as Array<{
            id: string;
            conversation_id: string;
          }>),
        ];
        setEventThreadIds(
          Object.fromEntries(eventRows.map((event) => [event.id, event.conversation_id])),
        );
      }
      const actorIds = [...new Set(notifications.flatMap((item) => item.actor_id ?? []))];
      if (actorIds.length) {
        const [profilesResult, accountantsResult] = await Promise.all([
          supabase
            .from("profiles" as never)
            .select("id, display_name, avatar_url")
            .in("id", actorIds),
          supabase
            .from("accountants" as never)
            .select("id, name, firm, avatar_url")
            .in("id", actorIds),
        ]);
        if (active) {
          const profileRows = (profilesResult.data ?? []) as unknown as Array<{
            id: string;
            display_name: string | null;
            avatar_url: string | null;
          }>;
          const accountantRows = (accountantsResult.data ?? []) as unknown as Array<{
            id: string;
            name: string;
            firm: string | null;
            avatar_url: string | null;
          }>;
          setActorNames({
            ...Object.fromEntries(
              profileRows.map((profile) => [profile.id, profile.display_name ?? ""]),
            ),
            ...Object.fromEntries(
              accountantRows.map((accountant) => [
                accountant.id,
                accountant.firm || accountant.name,
              ]),
            ),
          });
          setActorPhotos({
            ...Object.fromEntries(
              profileRows.flatMap((profile) =>
                profile.avatar_url ? [[profile.id, profile.avatar_url]] : [],
              ),
            ),
            ...Object.fromEntries(
              accountantRows.flatMap((accountant) =>
                accountant.avatar_url ? [[accountant.id, accountant.avatar_url]] : [],
              ),
            ),
          });
        }
      }
      if (active) setFeedReady(true);
    };

    void refresh();
    const channelId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`notification-feed:${user.id}:${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_messages" }, refresh)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${user.id}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [role, user?.id]);

  const notifications = useMemo(() => {
    const threadById = new Map(threads.map((thread) => [thread.id, thread]));
    const persistedMessageIds = new Set(
      persisted.filter((item) => item.kind === "message").map((item) => item.entity_id),
    );
    const messageDestination = (messageId: string) => {
      const message = messages.find((item) => item.id === messageId);
      return message
        ? `/chat?thread=${encodeURIComponent(message.threadId)}&message=${encodeURIComponent(message.id)}`
        : "/chat";
    };
    const humanEvents: NotificationEvent[] = messages.flatMap((message) => {
      if (message.from !== "them") return [];
      if (persistedMessageIds.has(message.id)) return [];
      const thread = threadById.get(message.threadId);
      if (!thread) return [];
      return [
        {
          id: `message:${message.id}`,
          source: "message",
          actor: thread.name,
          ...(thread.photo ? { photo: thread.photo } : {}),
          title: "sent you a message",
          preview: message.text,
          at: message.at,
          isUnread: message.readAt === null,
          to: messageDestination(message.id),
        },
      ];
    });

    const aiEvents: NotificationEvent[] = aiThreads.flatMap((thread) => {
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (!lastMessage || lastMessage.role !== "assistant") return [];
      const preview = messageText(lastMessage);
      if (!preview) return [];
      return [
        {
          id: `ai:${lastMessage.id}`,
          source: "ai",
          actor: "Fisco AI",
          title: "replied to you",
          preview,
          at: thread.updatedAt,
          isUnread: Date.now() - thread.updatedAt < 7 * 24 * 60 * 60 * 1000,
          to: "/fisco-ai",
        },
      ];
    });

    const documentEvents: NotificationEvent[] = docs.flatMap((doc) => {
      if (doc.status !== "stored") return [];
      const at = doc.createdAt ? Date.parse(doc.createdAt) || Date.now() : Date.now();
      return [
        {
          id: `document:${doc.id}`,
          source: "document",
          actor: "Fisco",
          title: "Document ready",
          preview: doc.merchant,
          at,
          isUnread: Date.now() - at < 7 * 24 * 60 * 60 * 1000,
          to: "/documents",
        },
      ];
    });

    const persistedEvents: NotificationEvent[] = persisted.map((item) => ({
      id: `db:${item.id}`,
      source:
        item.kind === "message"
          ? "message"
          : item.kind === "appointment"
            ? "appointment"
            : item.kind === "service_case" || item.kind === "review_reminder"
              ? "service"
              : "relationship",
      actor: (item.actor_id && actorNames[item.actor_id]) || "Fisco",
      ...(item.actor_id && actorPhotos[item.actor_id] ? { photo: actorPhotos[item.actor_id] } : {}),
      title: item.title,
      preview: item.body,
      at: Date.parse(item.created_at) || Date.now(),
      isUnread: item.read_at === null,
      to:
        item.kind === "message"
          ? messageDestination(item.entity_id)
          : (item.kind === "appointment" ||
                item.kind === "service_case" ||
                item.kind === "review_reminder") &&
              eventThreadIds[item.entity_id]
            ? `/chat?thread=${encodeURIComponent(eventThreadIds[item.entity_id]!)}&workflow=${encodeURIComponent(item.entity_id)}`
            : item.kind === "relationship_request"
              ? "/clients"
              : item.kind === "appointment_request"
                ? role === "accountant"
                  ? "/inbox"
                  : item.actor_id
                    ? `/accountants/${item.actor_id}`
                    : "/map"
                : item.kind === "relationship_approved" || item.kind === "relationship_rejected"
                  ? item.actor_id
                    ? `/accountants/${item.actor_id}`
                    : "/map"
                  : item.kind === "document"
                    ? `/documents/${item.entity_id}`
                    : "/chat",
    }));

    return [...persistedEvents, ...humanEvents, ...aiEvents, ...documentEvents]
      .sort((first, second) => second.at - first.at)
      .slice(0, 50);
  }, [
    actorNames,
    actorPhotos,
    aiThreads,
    docs,
    eventThreadIds,
    messages,
    persisted,
    role,
    threads,
  ]);

  useEffect(() => {
    if (!feedReady) return;
    if (!soundBootstrapped.current) {
      notifications.forEach((item) => soundSeenIds.current.add(item.id));
      soundBootstrapped.current = true;
      return;
    }

    notifications.forEach((item) => {
      if (soundSeenIds.current.has(item.id)) return;
      soundSeenIds.current.add(item.id);
      if (playedNotificationSounds.has(item.id)) return;
      playedNotificationSounds.add(item.id);
      if (playedNotificationSounds.size > 500) {
        const oldest = playedNotificationSounds.values().next().value;
        if (oldest) playedNotificationSounds.delete(oldest);
      }
      sfx(
        item.source === "message"
          ? "message-notification"
          : item.source === "appointment"
            ? "appointment-notification"
            : item.source === "relationship"
              ? "relationship-notification"
              : item.source === "service"
                ? "service-notification"
                : item.source === "document"
                  ? "document-notification"
                  : item.source === "ai"
                    ? "ai-notification"
                    : "notification",
      );
    });
  }, [feedReady, notifications]);

  return notifications;
}
