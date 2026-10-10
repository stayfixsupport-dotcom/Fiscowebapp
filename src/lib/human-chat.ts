import { supabase } from "@/integrations/supabase/client";
import type { ChatMessageAttachment, ChatMsg, ChatThread } from "@/lib/chat";
import type { Role } from "@/lib/app-store";

export type ConversationControl = {
  is_blocked: boolean;
  is_restricted: boolean;
  hidden_at: string | null;
};

type ConversationRow = {
  id: string;
  taxpayer_id: string;
  accountant_id: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  is_hybrid: boolean;
  read_at: string | null;
  edited_at: string | null;
  forwarded_from_message_id: string | null;
  attachment: ChatMessageAttachment | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  spoken_language?: string | null;
};
type AccountantRow = {
  id: string;
  name: string;
  firm: string | null;
  avatar_url: string | null;
  bio: string | null;
  specialties: string[] | null;
  languages: string[] | null;
  country_code: string | null;
};
type ControlRow = ConversationControl & { conversation_id: string };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
export async function ensureHumanConversation(accountantId: string, taxpayerId: string) {
  const findConversation = async () => {
    const { data, error } = await supabase
      .from("conversations" as never)
      .select("id")
      .eq("accountant_id", accountantId)
      .eq("taxpayer_id", taxpayerId)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as { id: string } | null)?.id;
  };

  const existingId = await findConversation();
  if (existingId) return existingId;

  const { data, error } = await supabase
    .from("conversations" as never)
    .insert({ accountant_id: accountantId, taxpayer_id: taxpayerId } as never)
    .select("id")
    .single();
  if (!error) return (data as unknown as { id: string }).id;
  if ((error as { code?: string }).code === "23505") {
    const concurrentId = await findConversation();
    if (concurrentId) return concurrentId;
  }
  throw error;
}

export async function loadHumanChat(role: Role, userId: string) {
  const { data: conversationData, error: conversationError } = await supabase
    .from("conversations" as never)
    .select("id, taxpayer_id, accountant_id, updated_at")
    .or(`taxpayer_id.eq.${userId},accountant_id.eq.${userId}`)
    .order("updated_at", { ascending: false });
  if (conversationError) throw conversationError;

  const conversations = (conversationData ?? []) as unknown as ConversationRow[];
  if (conversations.length === 0)
    return {
      threads: [] as ChatThread[],
      messages: [] as ChatMsg[],
      controls: {} as Record<string, ConversationControl>,
    };

  const conversationIds = conversations.map((conversation) => conversation.id);
  const { data: controlData, error: controlError } = await supabase
    .from("conversation_user_settings" as never)
    .select("conversation_id, is_blocked, is_restricted, hidden_at")
    .eq("user_id", userId)
    .in("conversation_id", conversationIds);
  if (controlError) throw controlError;

  const controlRows = (controlData ?? []) as unknown as ControlRow[];
  const controls = Object.fromEntries(
    controlRows.map(({ conversation_id, ...control }) => [conversation_id, control]),
  );
  const visibleConversations = conversations.filter(
    (conversation) => !controls[conversation.id]?.hidden_at,
  );
  if (visibleConversations.length === 0) {
    return { threads: [] as ChatThread[], messages: [] as ChatMsg[], controls };
  }

  const peerIds = [
    ...new Set(
      visibleConversations.map((conversation) =>
        role === "accountant" ? conversation.taxpayer_id : conversation.accountant_id,
      ),
    ),
  ];
  const [peopleData, messageData, notificationData] = await Promise.all([
    role === "accountant"
      ? supabase
          .from("profiles" as never)
          .select("id, display_name, avatar_url, spoken_language")
          .in("id", peerIds)
      : supabase
          .from("accountants" as never)
          .select("id, name, firm, avatar_url, bio, specialties, languages, country_code")
          .in("id", peerIds),
    supabase
      .from("messages" as never)
      .select(
        "id, conversation_id, sender_id, body, is_hybrid, read_at, edited_at, forwarded_from_message_id, attachment, created_at",
      )
      .in(
        "conversation_id",
        visibleConversations.map((conversation) => conversation.id),
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("notifications" as never)
      .select("id, actor_id, kind, title, body, entity_id, read_at, created_at")
      .eq("recipient_id", userId)
      .in("kind", ["appointment", "service_case", "review_reminder"])
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  if (peopleData.error) throw peopleData.error;
  if (messageData.error) throw messageData.error;

  const people = (peopleData.data ?? []) as unknown as Array<ProfileRow | AccountantRow>;
  const personById = new Map(people.map((person) => [person.id, person]));
  const threads = visibleConversations.map((conversation) => {
    const peerId = role === "accountant" ? conversation.taxpayer_id : conversation.accountant_id;
    const person = personById.get(peerId);
    const name =
      role === "accountant"
        ? (person as ProfileRow | undefined)?.display_name || "Taxpayer"
        : (person as AccountantRow | undefined)?.firm ||
          (person as AccountantRow | undefined)?.name ||
          "Accountant";
    return {
      id: conversation.id,
      peerId,
      name,
      sub:
        role === "accountant"
          ? (person as ProfileRow | undefined)?.spoken_language
            ? `Taxpayer · speaks ${(person as ProfileRow).spoken_language}`
            : "Approved taxpayer"
          : "Your accountant",
      initials: initials(name) || (role === "accountant" ? "TP" : "AC"),
      ...(role === "taxpayer" && (person as AccountantRow | undefined)?.name
        ? { personName: (person as AccountantRow).name }
        : {}),
      ...(role === "taxpayer" && (person as AccountantRow | undefined)?.firm
        ? { firmName: (person as AccountantRow).firm ?? undefined }
        : {}),
      ...(role === "taxpayer" && person
        ? {
            details: [
              (person as AccountantRow).firm,
              (person as AccountantRow).bio,
              (person as AccountantRow).specialties?.length
                ? `Specialties: ${(person as AccountantRow).specialties?.join(", ")}`
                : null,
              (person as AccountantRow).languages?.length
                ? `Languages: ${(person as AccountantRow).languages?.join(", ")}`
                : null,
              (person as AccountantRow).country_code
                ? `Country: ${(person as AccountantRow).country_code}`
                : null,
            ]
              .filter((detail): detail is string => !!detail?.trim())
              .join("\n"),
          }
        : {}),
      ...(person?.avatar_url ? { photo: person.avatar_url } : {}),
      online: false,
    } satisfies ChatThread;
  });

  const messages = ((messageData.data ?? []) as unknown as MessageRow[]).map((message) => ({
    id: message.id,
    threadId: message.conversation_id,
    from: message.sender_id === userId ? ("me" as const) : ("them" as const),
    text: message.body,
    at: Date.parse(message.created_at) || Date.now(),
    ...(message.is_hybrid ? { quick: true } : {}),
    ...(message.sender_id === userId
      ? { status: message.read_at ? ("read" as const) : ("sent" as const) }
      : {}),
    readAt: message.read_at ? Date.parse(message.read_at) : null,
    editedAt: message.edited_at ? Date.parse(message.edited_at) : null,
    forwardedFromMessageId: message.forwarded_from_message_id,
    attachment: message.attachment,
  }));

  const workflowNotifications = (notificationData.data ?? []) as unknown as Array<{
    id: string;
    actor_id: string | null;
    kind: string;
    title: string;
    body: string;
    entity_id: string;
    read_at: string | null;
    created_at: string;
  }>;
  const appointmentIds = workflowNotifications
    .filter((notification) => notification.kind === "appointment")
    .map((notification) => notification.entity_id);
  const serviceCaseIds = workflowNotifications
    .filter(
      (notification) =>
        notification.kind === "service_case" || notification.kind === "review_reminder",
    )
    .map((notification) => notification.entity_id);
  const [appointmentEvents, serviceCaseEvents] = await Promise.all([
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
  const workflowThreadByEntity = new Map(
    [
      ...((appointmentEvents.data ?? []) as unknown as Array<{
        id: string;
        conversation_id: string;
      }>),
      ...((serviceCaseEvents.data ?? []) as unknown as Array<{
        id: string;
        conversation_id: string;
      }>),
    ].map((event) => [event.id, event.conversation_id]),
  );
  const visibleConversationIds = new Set(
    visibleConversations.map((conversation) => conversation.id),
  );
  const workflowMessages = workflowNotifications.flatMap((notification) => {
    const threadId = workflowThreadByEntity.get(notification.entity_id);
    if (!threadId || !visibleConversationIds.has(threadId) || notification.actor_id === userId) {
      return [];
    }
    return [
      {
        id: `workflow:${notification.id}`,
        threadId,
        from: "them" as const,
        text: `${notification.title}\n${notification.body}`,
        at: Date.parse(notification.created_at) || Date.now(),
        readAt: notification.read_at ? Date.parse(notification.read_at) : null,
        workflowEvent: true,
        workflowNotificationId: notification.id,
      },
    ];
  });

  return {
    threads,
    messages: [...messages, ...workflowMessages].sort((first, second) => first.at - second.at),
    controls,
  };
}
