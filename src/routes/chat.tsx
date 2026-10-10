import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  MoreHorizontal,
  ArrowRight,
  Ban,
  Bot,
  Check,
  CheckCheck,
  Copy,
  EyeOff,
  FileText,
  FolderOpen,
  ImagePlus,
  Loader2,
  Pencil,
  Paperclip,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { FiscoOrb } from "@/components/FiscoOrb";
import { Avatar, Chip, Live } from "@/components/kit";
import { useStore } from "@/lib/app-store";
import {
  QUICK_MESSAGES,
  clock,
  isChatDocumentBundle,
  isChatImageAttachment,
  type ChatAttachment,
  type ChatDocumentBundle,
  type ChatMsg,
  type ChatThread,
} from "@/lib/chat";
import { streamServerChat, type ChatMessage } from "@/lib/gemini";
import { supabase } from "@/integrations/supabase/client";
import { loadHumanChat, type ConversationControl } from "@/lib/human-chat";
import { sfx } from "@/lib/sfx";
import { unlockAudio } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { ConversationWorkflow } from "@/components/accountant/ConversationWorkflow";
import { useT } from "@/lib/ui-prefs";
import { useUIPreferences } from "@/lib/ui-prefs";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MessageResponse = lazy(() =>
  import("@/components/ai-elements/message").then((module) => ({
    default: module.MessageResponse,
  })),
);

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search["thread"] === "string" ? { thread: search["thread"] } : {}),
    ...(typeof search["message"] === "string" ? { message: search["message"] } : {}),
    ...(typeof search["workflow"] === "string" ? { workflow: search["workflow"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Messages — Fisco" },
      {
        name: "description",
        content:
          "Private, separate chat threads for each approved accountant-client relationship, alongside your personal Fisco AI assistant.",
      },
      { property: "og:title", content: "Messages — Fisco" },
      {
        property: "og:description",
        content: "Private messages with your approved accountant or clients, plus Fisco AI.",
      },
    ],
  }),
  component: ChatPage,
});

const EASE = [0.16, 1, 0.3, 1] as const;

// --------------- AI Thread ID ---------------
const AI_THREAD_ID = "fisco-ai";
const AI_THREAD = {
  id: AI_THREAD_ID,
  name: "Fisco AI",
  sub: "Your tax & accounting assistant",
  initials: "AI",
  photo: undefined,
  online: true,
  pinned: true,
};

type AiMsg = { role: "user" | "model"; parts: [{ text: string }]; id: string; at: number };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("File read failed."));
    reader.onerror = () => reject(new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function ChatPage() {
  const translate = useT();
  const { preferences } = useUIPreferences();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { role, user, docs } = useStore();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [controls, setControls] = useState<Record<string, ConversationControl>>({});
  const [chatLoading, setChatLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [heldThreadId, setHeldThreadId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [chatActionsOpen, setChatActionsOpen] = useState(false);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [storedDocumentsOpen, setStoredDocumentsOpen] = useState(false);
  const [selectedStoredDocumentIds, setSelectedStoredDocumentIds] = useState<string[]>([]);
  const [attachmentSending, setAttachmentSending] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [previewBundle, setPreviewBundle] = useState<ChatDocumentBundle | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [messageActionsOpen, setMessageActionsOpen] = useState(false);
  const [messageActionMode, setMessageActionMode] = useState<"actions" | "edit" | "ask">("actions");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [askAiDraft, setAskAiDraft] = useState("");
  const [miniAiMessages, setMiniAiMessages] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([]);
  const [miniAiLoading, setMiniAiLoading] = useState(false);
  const [miniAiError, setMiniAiError] = useState<string | null>(null);
  const [heldMessageId, setHeldMessageId] = useState<string | null>(null);
  const [messageActionOrigin, setMessageActionOrigin] = useState<{
    top: number;
    left: number;
    right: number;
    fromMe: boolean;
  } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdPickerTimerRef = useRef<number | null>(null);
  const threadHoldTimerRef = useRef<number | null>(null);
  const threadHoldTriggeredRef = useRef(false);
  const notificationTargetRef = useRef<{ threadId: string; messageId?: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const aiScrollRef = useRef<HTMLDivElement>(null);
  const aiShouldFollowRef = useRef(true);
  const markedReadIdsRef = useRef(new Set<string>());
  const [aiMsgs, setAiMsgs] = useState<AiMsg[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiThreadId, setAiThreadId] = useState<string | null>(null);
  const [aiHistoryReady, setAiHistoryReady] = useState(false);
  const [aiSaveError, setAiSaveError] = useState(false);
  const isAiOpen = openId === AI_THREAD_ID;

  const refreshHumanChat = useCallback(async () => {
    if (!user?.id || !role) {
      setThreads([]);
      setMessages([]);
      setControls({});
      setChatLoading(false);
      return;
    }
    setChatLoading(true);
    try {
      const data = await loadHumanChat(role, user.id);
      setThreads(data.threads);
      setMessages(data.messages);
      setControls(data.controls);
      setChatError(null);
    } catch {
      setChatError(
        translate("Your conversations could not be loaded. Check your connection and try again."),
      );
    } finally {
      setChatLoading(false);
    }
  }, [role, user?.id, translate]);

  useEffect(() => {
    setChatLoading(true);
    void refreshHumanChat();
  }, [refreshHumanChat]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`human-messages:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void refreshHumanChat();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void refreshHumanChat();
      })
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [user?.id, refreshHumanChat]);

  const lastAiMsg = aiMsgs[aiMsgs.length - 1];
  const showAiThinking = aiLoading && lastAiMsg?.role === "model" && !lastAiMsg.parts[0].text;
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const realThreads = threads
      .map((currentThread) => {
        const mine = messages.filter((message) => message.threadId === currentThread.id);
        return { ...currentThread, last: mine[mine.length - 1], count: mine.length };
      })
      .filter(
        (currentThread) =>
          !term ||
          currentThread.name.toLowerCase().includes(term) ||
          currentThread.sub.toLowerCase().includes(term),
      )
      .sort((first, second) => Number(second.pinned) - Number(first.pinned));

    const aiVisible =
      !term ||
      translate("Fisco AI").toLowerCase().includes(term) ||
      translate("Tax assistant").toLowerCase().includes(term);
    const aiEntry = {
      ...AI_THREAD,
      last: lastAiMsg
        ? {
            id: lastAiMsg.id,
            threadId: AI_THREAD_ID,
            from: "them" as const,
            text: lastAiMsg.parts[0].text,
            at: lastAiMsg.at,
          }
        : undefined,
      count: aiMsgs.length,
    };
    return aiVisible ? [aiEntry, ...realThreads] : realThreads;
  }, [threads, messages, q, aiMsgs, lastAiMsg, translate]);

  const convo = messages.filter((message) => message.threadId === openId);
  const thread = threads.find((item) => item.id === openId);
  const quicks = QUICK_MESSAGES[role === "accountant" ? "accountant" : "taxpayer"];
  const isArabic = preferences.language === "ar";
  const activeControl = openId ? controls[openId] : undefined;
  const selectedMessage = convo.find((message) => message.id === selectedMessageId) ?? null;
  const attachableDocs =
    role === "taxpayer" ? docs.filter((doc) => !!doc.driveFileId && doc.status !== "sent") : [];

  useEffect(() => {
    notificationTargetRef.current = search.thread
      ? { threadId: search.thread, ...(search.message ? { messageId: search.message } : {}) }
      : null;
  }, [search.message, search.thread]);

  useEffect(() => {
    const target = notificationTargetRef.current;
    if (!target || !threads.some((item) => item.id === target.threadId)) return;
    if (openId !== target.threadId) setOpenId(target.threadId);
    else if (!target.messageId) notificationTargetRef.current = null;
  }, [openId, threads]);

  useEffect(() => {
    const target = notificationTargetRef.current;
    if (
      !target?.messageId ||
      openId !== target.threadId ||
      !convo.some((item) => item.id === target.messageId)
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(`message-${target.messageId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    notificationTargetRef.current = null;
  }, [convo, openId]);

  useEffect(
    () => () => {
      if (threadHoldTimerRef.current !== null) window.clearTimeout(threadHoldTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!openId || openId === AI_THREAD_ID || !user?.id) return;
    const unreadMessages = convo
      .filter((message) => message.from === "them" && !message.readAt)
      .filter((message) => !markedReadIdsRef.current.has(message.id));
    if (!unreadMessages.length) return;

    const unreadIds = unreadMessages.map((message) => message.id);
    const messageIds = unreadMessages
      .filter((message) => !message.workflowEvent)
      .map((message) => message.id);
    const workflowNotificationIds = unreadMessages.flatMap((message) =>
      message.workflowNotificationId ? [message.workflowNotificationId] : [],
    );
    unreadIds.forEach((id) => markedReadIdsRef.current.add(id));
    const readAt = new Date().toISOString();
    const updates = [];
    if (messageIds.length) {
      updates.push(
        supabase
          .from("messages" as never)
          .update({ read_at: readAt } as never)
          .in("id", messageIds),
        supabase
          .from("notifications" as never)
          .update({ read_at: readAt } as never)
          .eq("recipient_id", user.id)
          .eq("entity_type", "message")
          .in("entity_id", messageIds),
      );
    }
    if (workflowNotificationIds.length) {
      updates.push(
        supabase
          .from("notifications" as never)
          .update({ read_at: readAt } as never)
          .eq("recipient_id", user.id)
          .in("id", workflowNotificationIds),
      );
    }
    void Promise.all(updates).then((results) => {
      if (results.some((result) => result.error)) {
        unreadIds.forEach((id) => markedReadIdsRef.current.delete(id));
      }
    });
  }, [convo, openId, user?.id]);

  useEffect(() => {
    let alive = true;
    setAiHistoryReady(false);
    setAiSaveError(false);

    if (!user?.id) {
      setAiThreadId(null);
      setAiMsgs([]);
      setAiHistoryReady(true);
      return;
    }

    const loadHistory = async () => {
      try {
        const { data: threadRows, error: threadError } = await supabase
          .from("ai_threads" as never)
          .select("id")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (threadError) throw threadError;
        const thread = (threadRows as unknown as { id: string }[] | null)?.[0];

        if (!thread) {
          if (alive) {
            setAiThreadId(null);
            setAiMsgs([]);
          }
          return;
        }

        const { data: messageRows, error: messageError } = await supabase
          .from("ai_messages" as never)
          .select("id, role, parts, created_at")
          .eq("thread_id", thread.id)
          .order("created_at", { ascending: true });
        if (messageError) throw messageError;

        const savedMessages = (
          (messageRows ?? []) as unknown as {
            id: string;
            role: string;
            parts: unknown;
            created_at: string;
          }[]
        ).flatMap((row): AiMsg[] => {
          if (row.role !== "user" && row.role !== "assistant") return [];
          const parts = Array.isArray(row.parts) ? row.parts : [];
          const text = parts
            .map((part) =>
              part && typeof part === "object" && "text" in part && typeof part.text === "string"
                ? part.text
                : "",
            )
            .join("");
          if (!text) return [];
          return [
            {
              id: row.id,
              role: row.role === "assistant" ? "model" : "user",
              parts: [{ text }],
              at: Date.parse(row.created_at) || Date.now(),
            },
          ];
        });

        if (alive) {
          setAiThreadId(thread.id);
          setAiMsgs(savedMessages);
        }
      } catch {
        if (alive) setAiSaveError(true);
      } finally {
        if (alive) setAiHistoryReady(true);
      }
    };

    void loadHistory();
    return () => {
      alive = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (convo.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [convo.length, openId]);

  useEffect(() => {
    const container = aiScrollRef.current;
    if (isAiOpen && container && aiShouldFollowRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [aiMsgs, isAiOpen]);

  const send = async (text: string, quick?: boolean) => {
    if (!openId || openId === AI_THREAD_ID || !text.trim() || !user?.id) return;
    sfx("confirm");
    const { error: messageError } = await supabase.from("messages" as never).insert({
      conversation_id: openId,
      sender_id: user.id,
      body: text.trim(),
      is_hybrid: !!quick,
    } as never);
    if (messageError) {
      setChatError(
        translate("This message could not be sent. The relationship may be blocked or inactive."),
      );
      return;
    }
    await supabase
      .from("conversations" as never)
      .update({ updated_at: new Date().toISOString() } as never)
      .eq("id", openId);
    setDraft("");
    void refreshHumanChat();
  };

  const sendAttachment = async (file?: File, documentIds?: string[]) => {
    if (!openId || openId === AI_THREAD_ID || !user?.id || activeControl?.is_blocked) return;
    if (!file && !documentIds?.length) return;
    if (file && file.size > 8 * 1024 * 1024) {
      setChatError(translate("Attachments must be 8 MB or smaller."));
      sfx("error");
      return;
    }

    setAttachmentSending(true);
    setAttachmentPickerOpen(false);
    setStoredDocumentsOpen(false);
    setChatError(null);
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) throw new Error(translate("Sign in again to send an attachment."));

      const response = await fetch("/api/chat-attachments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: openId,
          ...(documentIds?.length ? { documentIds } : {}),
          ...(file
            ? {
                file: {
                  fileName: file.name,
                  mimeType: file.type || "application/octet-stream",
                  dataUrl: await fileToDataUrl(file),
                },
              }
            : {}),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || translate("This attachment could not be sent."));

      sfx("success");
      if (file) toast.success(translate("Attachment sent."));
      if (documentIds?.length) {
        setSelectedStoredDocumentIds([]);
        toast.success(translate("Documents sent."));
      }
      void refreshHumanChat();
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : translate("This attachment could not be sent."),
      );
      sfx("error");
    } finally {
      setAttachmentSending(false);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!user?.id) return;
    setDeletingMessageId(messageId);
    const { data, error: sessionError } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (sessionError || !token) {
      setDeletingMessageId(null);
      setChatError(translate("Sign in again to delete this message."));
      return;
    }
    const response = await fetch(`/api/chat-messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setDeletingMessageId(null);
      setChatError(result?.error || translate("This message could not be permanently deleted."));
      sfx("error");
      return;
    }
    setMessages((previous) => previous.filter((message) => message.id !== messageId));
    setMessageActionsOpen(false);
    setDeletingMessageId(null);
    sfx("success");
  };

  const openMessageActions = (messageId: string, origin?: DOMRect) => {
    const selected = convo.find((message) => message.id === messageId);
    if (!selected) return;
    if (holdPickerTimerRef.current !== null) window.clearTimeout(holdPickerTimerRef.current);
    setHeldMessageId(null);
    setMessageActionOrigin(
      origin
        ? {
            top: origin.top,
            left: origin.left,
            right: origin.right,
            fromMe: selected.from === "me",
          }
        : null,
    );
    setSelectedMessageId(messageId);
    setMessageActionMode("actions");
    setEditDraft(selected.text);
    setAskAiDraft(translate("Help me understand this message and what I should do next."));
    setMiniAiMessages([]);
    setMiniAiError(null);
    setHeldMessageId(null);
    setMessageActionsOpen(true);
    sfx("open");
  };

  const closeMessageActions = (playSound = true) => {
    setMessageActionsOpen(false);
    setSelectedMessageId(null);
    setMessageActionMode("actions");
    setMiniAiMessages([]);
    setMiniAiError(null);
    if (playSound) sfx("close");
  };

  const openPeerProfile = () => {
    if (!thread?.peerId) return;
    sfx("open");
    if (role === "accountant") {
      void navigate({ to: "/taxpayers/$id", params: { id: thread.peerId } });
    } else {
      void navigate({ to: "/accountants/$id", params: { id: thread.peerId } });
    }
  };

  const stopMessageHold = () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const copyMessage = async () => {
    if (!selectedMessage) return;
    try {
      await navigator.clipboard.writeText(selectedMessage.text);
      toast.success(translate("Message copied."));
      closeMessageActions(false);
      sfx("success");
    } catch {
      toast.error(translate("Could not copy the message."));
      sfx("error");
    }
  };

  const editMessage = async () => {
    if (!user?.id || !selectedMessage || selectedMessage.from !== "me" || !editDraft.trim()) return;
    const editedAt = new Date().toISOString();
    const { error } = await supabase
      .from("messages" as never)
      .update({ body: editDraft.trim(), edited_at: editedAt } as never)
      .eq("id", selectedMessage.id)
      .eq("sender_id", user.id);
    if (error) {
      setChatError(translate("This message could not be edited."));
      sfx("error");
      return;
    }
    setMessages((previous) =>
      previous.map((message) =>
        message.id === selectedMessage.id
          ? { ...message, text: editDraft.trim(), editedAt: Date.parse(editedAt) }
          : message,
      ),
    );
    closeMessageActions(false);
    sfx("success");
  };

  const askMiniAi = async () => {
    if (!askAiDraft.trim() || miniAiLoading) return;
    const prompt = askAiDraft.trim();
    setAskAiDraft("");
    setMiniAiError(null);
    setMiniAiLoading(true);
    setMiniAiMessages((previous) => [
      ...previous,
      { role: "user", text: prompt },
      { role: "assistant", text: "" },
    ]);
    const conversationContext = convo
      .slice(-12)
      .map(
        (message) =>
          `${message.from === "me" ? "Me" : (thread?.name ?? "Accountant")}: ${message.text}`,
      )
      .join("\n");
    const documentContext = docs
      .filter((doc) => doc.status === "stored")
      .slice(0, 12)
      .map((doc) => {
        const lineItems = doc.aiDetails?.lineItems
          .slice(0, 8)
          .map((item) => `${item.label}: ${item.amount} ${doc.currency ?? ""}`)
          .join(", ");
        return [
          `${doc.merchant} · ${doc.category} · ${doc.date} · ${doc.amount} ${doc.currency ?? ""}`,
          doc.aiDetails?.summary,
          lineItems,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    const contextPrompt = [
      `You are Fisco AI helping the user evaluate and communicate with an accountant. Reply in the user's language.`,
      `Conversation partner: ${thread?.name ?? "Unknown"}. Available profile details: ${thread?.details ?? "No profile details are available."}`,
      `Recent conversation messages:\n${conversationContext || "No other messages are available."}`,
      `The user's stored document summaries:\n${documentContext || "No stored document summaries are available."}`,
      `Selected message to explain:\n${selectedMessage?.text ?? "No message was selected."}`,
      `User's question: ${prompt}`,
      "Compare the accountant's stated profile and specialties with the available document summaries only when relevant. Do not infer credentials, guarantee suitability, expose unnecessary personal details, or invent promises or tax advice. State clearly when information is insufficient.",
    ].join("\n\n");
    const history: ChatMessage[] = [
      ...miniAiMessages.map(({ role, text }) => ({ role, content: text })),
      { role: "user", content: contextPrompt },
    ];
    let failure: Error | null = null;
    try {
      await streamServerChat({
        messages: history,
        ...(role ? { role } : {}),
        onChunk: (_chunk, fullText) => {
          setMiniAiMessages((previous) =>
            previous.map((message, index) =>
              index === previous.length - 1 ? { ...message, text: fullText } : message,
            ),
          );
        },
        onDone: (fullText) => {
          setMiniAiMessages((previous) =>
            previous.map((message, index) =>
              index === previous.length - 1 ? { ...message, text: fullText } : message,
            ),
          );
          sfx("success");
        },
        onError: (error) => {
          failure = error;
        },
      });
      if (failure) throw failure;
    } catch (error) {
      setMiniAiError(
        error instanceof Error ? error.message : translate("Fisco AI could not respond."),
      );
      setMiniAiMessages((previous) => previous.slice(0, -1));
      sfx("error");
    } finally {
      setMiniAiLoading(false);
    }
  };

  const sendAi = async (text: string) => {
    if (!text.trim() || aiLoading || !aiHistoryReady) return;
    sfx("confirm");
    setDraft("");

    const userMsg: AiMsg = {
      role: "user",
      parts: [{ text: text.trim() }],
      id: `ai-user-${Date.now()}`,
      at: Date.now(),
    };
    const assistantId = `ai-model-${Date.now()}`;
    const assistantMsg: AiMsg = {
      role: "model",
      parts: [{ text: "" }],
      id: assistantId,
      at: Date.now(),
    };
    const nextMsgs = [...aiMsgs, userMsg];
    const history: ChatMessage[] = nextMsgs.map((m) => ({
      role: m.role === "model" ? "assistant" : "user",
      content: m.parts[0].text,
    }));
    aiShouldFollowRef.current = true;
    setAiMsgs([...nextMsgs, assistantMsg]);
    setAiLoading(true);

    let persistentThreadId = aiThreadId;
    let userMessageSaved = false;
    try {
      if (user?.id && !persistentThreadId) {
        const { data, error } = await supabase
          .from("ai_threads" as never)
          .insert({ user_id: user.id, title: "Fisco AI" } as never)
          .select("id")
          .single();
        if (error) throw error;
        persistentThreadId = (data as unknown as { id: string }).id;
        setAiThreadId(persistentThreadId);
      }
      if (persistentThreadId) {
        const { error } = await supabase.from("ai_messages" as never).insert({
          thread_id: persistentThreadId,
          role: "user",
          parts: userMsg.parts,
        } as never);
        if (error) throw error;
        userMessageSaved = true;
      }
      setAiSaveError(false);
    } catch {
      setAiSaveError(true);
    }

    try {
      const generation = { error: null as Error | null };
      let completedText = "";
      await streamServerChat({
        messages: history,
        ...(role ? { role } : {}),
        onChunk: (_chunk, fullText) => {
          setAiMsgs((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, parts: [{ text: fullText }] } : message,
            ),
          );
        },
        onDone: (fullText) => {
          completedText = fullText;
          setAiMsgs((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, parts: [{ text: fullText }] } : message,
            ),
          );
        },
        onError: (error) => {
          generation.error = error;
        },
      });
      if (generation.error) throw generation.error;
      if (userMessageSaved && persistentThreadId && completedText) {
        const { error } = await supabase.from("ai_messages" as never).insert({
          thread_id: persistentThreadId,
          role: "assistant",
          parts: [{ text: completedText }],
        } as never);
        if (error) setAiSaveError(true);
        else {
          await supabase
            .from("ai_threads" as never)
            .update({ updated_at: new Date().toISOString() } as never)
            .eq("id", persistentThreadId);
        }
      }
    } catch {
      setAiMsgs((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                parts: [
                  {
                    text: translate(
                      "I couldn't connect just now. Please check the connection and try again.",
                    ),
                  },
                ],
              }
            : message,
        ),
      );
    } finally {
      setAiLoading(false);
    }
  };

  const updateConversationControl = async (patch: Partial<ConversationControl>) => {
    if (!openId || openId === AI_THREAD_ID || !user?.id) return;
    const current = controls[openId] ?? {
      is_blocked: false,
      is_restricted: false,
      hidden_at: null,
    };
    const next = { ...current, ...patch };
    const { error } = await supabase.from("conversation_user_settings" as never).upsert(
      {
        conversation_id: openId,
        user_id: user.id,
        ...next,
      } as never,
      { onConflict: "conversation_id,user_id" },
    );
    if (error) {
      setChatError(translate("That conversation setting could not be saved."));
      sfx("error");
      return;
    }
    setControls((previous) => ({ ...previous, [openId]: next }));
    setChatActionsOpen(false);
    sfx("success");
    if (next.hidden_at) setOpenId(null);
    void refreshHumanChat();
  };

  const toggleThreadSelection = (threadId: string) => {
    const next = selectedThreadIds.includes(threadId)
      ? selectedThreadIds.filter((id) => id !== threadId)
      : [...selectedThreadIds, threadId];
    setSelectedThreadIds(next);
    if (!next.length) setSelectionMode(false);
  };

  const deleteSelectedThreads = async () => {
    if (!user?.id || !selectedThreadIds.length) return;
    const hiddenAt = new Date().toISOString();
    const results = await Promise.all(
      selectedThreadIds.map((conversationId) => {
        const current = controls[conversationId] ?? {
          is_blocked: false,
          is_restricted: false,
          hidden_at: null,
        };
        return supabase.from("conversation_user_settings" as never).upsert(
          {
            conversation_id: conversationId,
            user_id: user.id,
            ...current,
            hidden_at: hiddenAt,
          } as never,
          { onConflict: "conversation_id,user_id" },
        );
      }),
    );
    if (results.some((result) => result.error)) {
      setChatError(translate("Some conversations could not be deleted. Please try again."));
      sfx("error");
      return;
    }
    setSelectedThreadIds([]);
    setSelectionMode(false);
    setHeldThreadId(null);
    sfx("success");
    await refreshHumanChat();
  };

  const updateSelectedThreadControls = async (patch: Partial<ConversationControl>) => {
    if (!user?.id || !selectedThreadIds.length) return;
    const results = await Promise.all(
      selectedThreadIds.map((conversationId) => {
        const current = controls[conversationId] ?? {
          is_blocked: false,
          is_restricted: false,
          hidden_at: null,
        };
        return supabase.from("conversation_user_settings" as never).upsert(
          {
            conversation_id: conversationId,
            user_id: user.id,
            ...current,
            ...patch,
          } as never,
          { onConflict: "conversation_id,user_id" },
        );
      }),
    );
    if (results.some((result) => result.error)) {
      setChatError(translate("Some conversation settings could not be saved. Please try again."));
      sfx("error");
      return;
    }
    setControls((previous) => ({
      ...previous,
      ...Object.fromEntries(
        selectedThreadIds.map((conversationId) => {
          const current = previous[conversationId] ?? {
            is_blocked: false,
            is_restricted: false,
            hidden_at: null,
          };
          return [conversationId, { ...current, ...patch }];
        }),
      ),
    }));
    setSelectedThreadIds([]);
    setSelectionMode(false);
    setHeldThreadId(null);
    sfx("success");
  };

  return (
    <div className="min-h-[100dvh] w-full min-w-0 max-w-full overflow-x-clip pb-32">
      <PageHeader title={translate("Messages")} back backTo="/" />

      <div className="mx-auto min-w-0 w-full max-w-[560px] px-4 pt-3">
        {/* search */}
        <motion.div
          initial={{ opacity: 0, y: 12, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: EASE }}
          className="glass flex items-center gap-2.5 rounded-full px-4 py-2.5"
        >
          <Search className="size-4 opacity-45" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={translate("Search conversations")}
            className="w-full bg-transparent text-[13.5px] font-semibold outline-none placeholder:text-muted-foreground/70"
          />
        </motion.div>
        {chatError && (
          <p role="alert" className="mt-2 text-center text-[11.5px] font-semibold text-destructive">
            {chatError}
          </p>
        )}

        {selectionMode ? (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border/70 bg-card/70 px-3 py-2">
            <span className="min-w-0 flex-1 text-[12px] font-bold">
              {selectedThreadIds.length} {translate("selected")}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedThreadIds([]);
                setSelectionMode(false);
              }}
              className="press grid size-9 place-items-center rounded-full hover:bg-secondary"
              aria-label={translate("Cancel selection")}
            >
              <X className="size-4" />
            </button>
            <button
              type="button"
              disabled={!selectedThreadIds.length}
              title={translate("Restrict selected chats")}
              aria-label={translate("Restrict selected chats")}
              onClick={() => void updateSelectedThreadControls({ is_restricted: true })}
              className="press grid size-9 place-items-center rounded-full bg-secondary text-foreground disabled:opacity-45"
            >
              <EyeOff className="size-4" />
            </button>
            <button
              type="button"
              disabled={!selectedThreadIds.length}
              title={translate("Block selected chats")}
              aria-label={translate("Block selected chats")}
              onClick={() => void updateSelectedThreadControls({ is_blocked: true })}
              className="press grid size-9 place-items-center rounded-full bg-destructive/10 text-destructive disabled:opacity-45"
            >
              <Ban className="size-4" />
            </button>
            <button
              type="button"
              disabled={!selectedThreadIds.length}
              onClick={() => void deleteSelectedThreads()}
              className="press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-destructive px-3 text-[11px] font-bold text-destructive-foreground disabled:opacity-45"
            >
              <Trash2 className="size-3.5" /> {translate("Delete chats")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSelectionMode(true)}
            className="press mt-2 min-h-8 rounded-full px-2 text-[10px] font-bold text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
          >
            {translate("Select chats")}
          </button>
        )}

        {list.some((item) => item.id === AI_THREAD_ID) && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            onClick={() => {
              unlockAudio();
              sfx("open");
              window.dispatchEvent(new Event("fisco:enter-ai"));
              aiShouldFollowRef.current = true;
              void navigate({ to: "/fisco-ai" }).catch(() => {
                window.dispatchEvent(new Event("fisco:cancel-ai-entry"));
              });
            }}
            className="glass press mt-3 flex min-h-24 w-full min-w-0 items-center gap-3 rounded-[22px] border border-primary/20 bg-primary/[0.04] px-4 py-4 text-left"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-full">
              <FiscoOrb size={34} state="idle" priority />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[14px] font-extrabold">Fisco AI</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold tracking-wide text-primary uppercase">
                  {translate("AI assistant")}
                </span>
              </span>
              <span className="block truncate text-[12px] font-semibold text-muted-foreground">
                {lastAiMsg?.parts[0].text ?? translate(AI_THREAD.sub)}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-primary" />
          </motion.button>
        )}

        <div className="mt-4 border-b border-border/60 pb-3">
          <div className="text-[10px] font-bold tracking-[0.18em] text-muted-foreground uppercase">
            {role === "accountant"
              ? translate("Accountant workspace")
              : translate("Private conversation")}
          </div>
          <h1 className="mt-1 text-[20px] font-extrabold">
            {role === "accountant"
              ? translate("Client conversations")
              : translate("Your accountant")}
          </h1>
          <p className="mt-1 text-[12px] font-medium text-muted-foreground">
            {role === "accountant"
              ? translate("Each approved client has a separate, private thread.")
              : translate("Your messages are only shared with your approved accountant.")}
          </p>
        </div>

        {/* threads */}
        <div className="mt-4 grid gap-2">
          {list
            .filter((t) => t.id !== AI_THREAD_ID)
            .map((t, i) => (
              <motion.button
                key={t.id}
                layout
                initial={{ opacity: 0, y: 22, filter: "blur(12px)" }}
                animate={{
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                  rotate: heldThreadId === t.id ? [0, -1, 1, -0.7, 0] : 0,
                }}
                transition={
                  heldThreadId === t.id
                    ? { duration: 0.32, ease: "easeInOut" }
                    : { duration: 0.6, delay: 0.12 + i * 0.06, ease: EASE }
                }
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                onPointerEnter={() => sfx("hover")}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse" && event.button !== 0) return;
                  threadHoldTriggeredRef.current = false;
                  if (threadHoldTimerRef.current !== null) {
                    window.clearTimeout(threadHoldTimerRef.current);
                  }
                  threadHoldTimerRef.current = window.setTimeout(() => {
                    threadHoldTriggeredRef.current = true;
                    setSelectionMode(true);
                    setSelectedThreadIds((current) =>
                      current.includes(t.id) ? current : [...current, t.id],
                    );
                    setHeldThreadId(t.id);
                    sfx("tick");
                  }, 430);
                }}
                onPointerUp={() => {
                  if (threadHoldTimerRef.current !== null) {
                    window.clearTimeout(threadHoldTimerRef.current);
                    threadHoldTimerRef.current = null;
                  }
                }}
                onPointerCancel={() => {
                  if (threadHoldTimerRef.current !== null) {
                    window.clearTimeout(threadHoldTimerRef.current);
                    threadHoldTimerRef.current = null;
                  }
                }}
                onPointerMove={(event) => {
                  if (event.pointerType !== "touch" || threadHoldTimerRef.current === null) return;
                  window.clearTimeout(threadHoldTimerRef.current);
                  threadHoldTimerRef.current = null;
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectionMode(true);
                  setSelectedThreadIds((current) =>
                    current.includes(t.id) ? current : [...current, t.id],
                  );
                  setHeldThreadId(t.id);
                  sfx("tick");
                }}
                onClick={() => {
                  if (threadHoldTriggeredRef.current) {
                    threadHoldTriggeredRef.current = false;
                    return;
                  }
                  if (selectionMode) {
                    toggleThreadSelection(t.id);
                    return;
                  }
                  sfx("open");
                  setOpenId(t.id);
                }}
                className={cn(
                  "glass press flex min-h-20 w-full min-w-0 max-w-full items-center gap-3 rounded-[26px] p-3 text-left",
                  selectedThreadIds.includes(t.id) && "border border-primary/60 bg-primary/[0.06]",
                  t.id === AI_THREAD_ID &&
                    "border border-primary/20 bg-gradient-to-r from-primary/5 to-transparent",
                )}
              >
                <div className="relative">
                  {t.id === AI_THREAD_ID ? (
                    <div className="grid size-[46px] place-items-center rounded-full bg-gradient-to-br from-primary/80 to-primary text-primary-foreground">
                      <Sparkles className="size-5" />
                    </div>
                  ) : (
                    <Avatar src={t.photo} initials={t.initials} size={46} />
                  )}
                  {t.online && (
                    <span className="absolute right-0 bottom-0">
                      <Live />
                    </span>
                  )}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <motion.span
                      animate={
                        heldThreadId === t.id ? { rotate: [0, -1.2, 1.2, -0.7, 0] } : { rotate: 0 }
                      }
                      transition={{ duration: 0.32, ease: "easeInOut" }}
                      className="truncate text-[14.5px] font-extrabold"
                    >
                      {t.name}
                    </motion.span>
                    {t.pinned && <Chip tone="accent">{translate("Pinned")}</Chip>}
                    {t.id === AI_THREAD_ID && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold tracking-wide text-primary uppercase">
                        AI
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] font-semibold text-muted-foreground">
                    {t.last?.text ?? t.sub}
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] font-bold opacity-45">
                  {t.last ? clock(t.last.at) : ""}
                </span>
              </motion.button>
            ))}
        </div>
      </div>

      {/* Fisco AI conversation */}
      <AnimatePresence>
        {isAiOpen && (
          <motion.div
            className="fixed inset-0 z-[70] flex h-[100dvh] min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden bg-background/80 backdrop-blur-2xl"
            initial={{ opacity: 0, y: 40, filter: "blur(20px)", scale: 0.98 }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, y: 30, filter: "blur(18px)", scale: 0.985 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            {/* header */}
            <div className="glass relative flex items-center gap-3 rounded-none px-4 py-3">
              <button
                onClick={() => {
                  sfx("close");
                  setOpenId(null);
                  setChatActionsOpen(false);
                }}
                aria-label={translate("Back")}
                className="press grid size-9 place-items-center rounded-full bg-foreground/6"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-extrabold">Fisco AI</div>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Live />
                  <span>{translate("Powered by Gemini · Tax & Accounting Assistant")}</span>
                </div>
              </div>
            </div>

            {/* messages */}
            <div
              ref={aiScrollRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                aiShouldFollowRef.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 96;
              }}
              className="no-scrollbar min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-4"
            >
              <div className="mx-auto grid max-w-[560px] gap-3">
                {aiMsgs
                  .filter((m) => m.parts[0].text)
                  .map((m, i) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 16, scale: 0.96, filter: "blur(8px)" }}
                      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                      transition={{ duration: 0.45, delay: Math.min(i * 0.03, 0.3), ease: EASE }}
                      className={cn(
                        "flex",
                        m.role === "user" ? "justify-end" : "justify-start gap-2",
                      )}
                    >
                      {m.role === "model" && (
                        <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-primary text-primary-foreground">
                          <Bot className="size-3.5" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[78%] rounded-[22px] px-3.5 py-2.5 text-[13.5px] font-semibold leading-relaxed",
                          m.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "glass text-foreground",
                        )}
                        style={
                          m.role === "user" ? { boxShadow: "var(--shadow-accent)" } : undefined
                        }
                      >
                        {m.role === "model" ? (
                          <Suspense
                            fallback={
                              <span className="whitespace-pre-wrap">{m.parts[0].text}</span>
                            }
                          >
                            <MessageResponse
                              animated
                              isAnimating={aiLoading && m.id === lastAiMsg?.id}
                              className="text-base leading-relaxed [&_h1]:my-2 [&_h1]:text-lg [&_h1]:font-extrabold [&_h2]:my-2 [&_h2]:text-base [&_h2]:font-extrabold [&_h3]:font-bold [&_strong]:font-extrabold"
                            >
                              {m.parts[0].text}
                            </MessageResponse>
                          </Suspense>
                        ) : (
                          m.parts[0].text
                        )}
                        {aiLoading && m.id === lastAiMsg?.id && (
                          <span
                            aria-label={translate("Fisco AI is writing")}
                            className="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-primary align-middle"
                          />
                        )}
                        <span
                          className={cn(
                            "mt-1 flex items-center justify-end gap-1 text-[10px] font-bold",
                            m.role === "user" ? "opacity-70" : "opacity-45",
                          )}
                        >
                          {clock(m.at)}
                          {m.role === "user" && <CheckCheck className="size-3" />}
                        </span>
                      </div>
                    </motion.div>
                  ))}

                {/* typing indicator */}
                {showAiThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2"
                  >
                    <div className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-primary text-primary-foreground">
                      <Bot className="size-3.5" />
                    </div>
                    <div
                      className="glass flex items-center gap-2.5 rounded-[22px] px-4 py-3"
                      aria-live="polite"
                    >
                      <span className="flex h-3 items-center gap-1" aria-hidden="true">
                        {[0, 1, 2].map((dot) => (
                          <motion.span
                            key={dot}
                            className="size-1.5 rounded-full bg-primary"
                            animate={{ y: [0, -4, 0], opacity: [0.45, 1, 0.45] }}
                            transition={{
                              duration: 0.72,
                              delay: dot * 0.13,
                              repeat: Infinity,
                              ease: "easeInOut",
                            }}
                          />
                        ))}
                      </span>
                      <span className="text-sm font-semibold text-muted-foreground">
                        {translate("Thinking")}
                      </span>
                    </div>
                  </motion.div>
                )}
                <div aria-hidden="true" />
              </div>
            </div>

            {/* AI composer */}
            <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-[560px]">
                {aiSaveError && (
                  <p
                    role="alert"
                    className="mb-2 text-center text-[11px] font-semibold text-destructive"
                  >
                    {translate("This conversation could not sync to your account.")}
                  </p>
                )}
                {/* suggested questions */}
                <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
                  {[
                    "What documents do I need for VAT?",
                    "How do I deduct home office expenses?",
                    "When is the PIT deadline?",
                    "How does ZUS work?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendAi(translate(suggestion))}
                      className="glass press shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-bold whitespace-nowrap"
                    >
                      {translate(suggestion)}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendAi(draft);
                  }}
                  className="glass flex items-center gap-2 rounded-full p-1.5 pl-4"
                >
                  <Sparkles className="size-4 shrink-0 text-primary opacity-60" />
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={translate("Ask Fisco AI anything about taxes…")}
                    className="min-w-0 flex-1 bg-transparent py-2 text-[13.5px] font-semibold outline-none placeholder:text-muted-foreground/70"
                    disabled={aiLoading || !aiHistoryReady}
                  />
                  <motion.button
                    type="submit"
                    disabled={!draft.trim() || aiLoading || !aiHistoryReady}
                    whileTap={{ scale: 0.92 }}
                    className="press grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                    style={{ boxShadow: "var(--shadow-accent)" }}
                    aria-label={translate("Send")}
                  >
                    {aiLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </motion.button>
                </form>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* regular conversation */}
      <AnimatePresence>
        {thread && !isAiOpen && (
          <motion.div
            className="fixed inset-0 z-[70] flex h-[100dvh] min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden bg-background/80 backdrop-blur-2xl"
            initial={{ opacity: 0, y: 40, filter: "blur(20px)", scale: 0.98 }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, y: 30, filter: "blur(18px)", scale: 0.985 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <div
              dir={isArabic ? "rtl" : "ltr"}
              className="glass relative flex items-center gap-2 rounded-none px-3 py-3 sm:gap-3 sm:px-4"
            >
              <button
                onClick={() => {
                  sfx("close");
                  setOpenId(null);
                }}
                aria-label={translate("Back")}
                className="press grid size-9 place-items-center rounded-full bg-foreground/6"
              >
                {isArabic ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}
              </button>
              <button
                type="button"
                onClick={openPeerProfile}
                aria-label={translate("View profile")}
                className="press grid shrink-0 place-items-center rounded-full"
              >
                <Avatar src={thread.photo} initials={thread.initials} size={38} />
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={openPeerProfile}
                  onPointerEnter={() => sfx("hover")}
                  className="press block max-w-full truncate text-left text-[14px] font-extrabold"
                >
                  <motion.span
                    animate={heldMessageId ? { rotate: [0, -1.2, 1.2, -0.7, 0] } : { rotate: 0 }}
                    transition={{ duration: 0.32, ease: "easeInOut" }}
                    className="inline-block max-w-full truncate align-bottom"
                  >
                    {thread.name}
                  </motion.span>
                </button>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  {thread.online ? <Live /> : null}
                  {thread.online ? translate("Online") : translate(thread.sub)}
                </div>
              </div>
              <button
                type="button"
                aria-label={translate("Conversation actions")}
                aria-expanded={chatActionsOpen}
                onClick={() => {
                  setChatActionsOpen((isOpen) => !isOpen);
                  sfx(chatActionsOpen ? "close" : "open");
                }}
                className="press grid size-9 shrink-0 place-items-center rounded-full bg-foreground/6"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-4">
              <div className="mx-auto grid max-w-[560px] gap-2">
                {activeControl?.is_blocked && (
                  <p className="mb-2 rounded-2xl bg-destructive/8 px-3 py-2 text-center text-[11.5px] font-semibold text-destructive">
                    {translate("You blocked this conversation. Unblock it to send messages.")}
                  </p>
                )}
                {activeControl?.is_restricted && (
                  <p className="mb-2 rounded-2xl bg-secondary/70 px-3 py-2 text-center text-[11.5px] font-semibold text-muted-foreground">
                    {translate(
                      "Incoming messages are hidden while this conversation is restricted.",
                    )}
                  </p>
                )}
                {convo.map((m, i) => (
                  <motion.div
                    key={m.id}
                    id={`message-${m.id}`}
                    initial={{ opacity: 0, y: 16, scale: 0.96, filter: "blur(8px)" }}
                    animate={
                      heldMessageId === m.id
                        ? {
                            y: [0, -3, 1, -2, 0],
                            rotate: [0, -1.2, 1.2, -0.7, 0],
                            scale: [1, 1.035, 1.025],
                          }
                        : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", rotate: 0 }
                    }
                    transition={
                      heldMessageId === m.id
                        ? { duration: 0.32, ease: "easeInOut" }
                        : { duration: 0.45, delay: Math.min(i * 0.03, 0.3), ease: EASE }
                    }
                    className={cn(
                      "group flex select-none items-end gap-1.5",
                      m.from === "me" ? "justify-end" : "justify-start",
                    )}
                    role="group"
                    tabIndex={0}
                    aria-label={`${translate("Message options")}: ${m.text.slice(0, 60)}`}
                    onCopy={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      if (m.workflowEvent) return;
                      if (event.pointerType === "mouse" && event.button !== 0) return;
                      stopMessageHold();
                      const origin = event.currentTarget.getBoundingClientRect();
                      holdTimerRef.current = window.setTimeout(() => {
                        setHeldMessageId(m.id);
                        sfx("tick");
                        holdPickerTimerRef.current = window.setTimeout(
                          () => openMessageActions(m.id, origin),
                          260,
                        );
                      }, 430);
                    }}
                    onPointerUp={stopMessageHold}
                    onPointerCancel={stopMessageHold}
                    onPointerMove={stopMessageHold}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (m.workflowEvent) return;
                      openMessageActions(m.id, event.currentTarget.getBoundingClientRect());
                    }}
                    onKeyDown={(event) => {
                      if (m.workflowEvent) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openMessageActions(m.id, event.currentTarget.getBoundingClientRect());
                    }}
                  >
                    <div
                      className={cn(
                        isChatImageAttachment(m.attachment)
                          ? "max-w-[78%] overflow-hidden rounded-2xl bg-transparent text-foreground"
                          : cn(
                              "max-w-[78%] rounded-[22px] px-3.5 py-2.5 text-[13.5px] font-semibold",
                              m.workflowEvent
                                ? "glass max-w-[92%] border border-primary/15 text-foreground"
                                : m.from === "me"
                                  ? "bg-primary text-primary-foreground"
                                  : "glass text-foreground",
                            ),
                      )}
                      style={
                        m.from === "me" && !isChatImageAttachment(m.attachment)
                          ? { boxShadow: "var(--shadow-accent)" }
                          : undefined
                      }
                    >
                      {m.forwardedFromMessageId && (
                        <div className="mb-1 text-[10px] font-bold opacity-65">
                          {translate("Forwarded")}
                        </div>
                      )}
                      {m.attachment &&
                        (isChatDocumentBundle(m.attachment) ? (
                          <button
                            type="button"
                            aria-label={`${translate("View documents")}: ${m.attachment.documents.length}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!isChatDocumentBundle(m.attachment)) return;
                              setPreviewBundle(m.attachment);
                              sfx("open");
                            }}
                            className="press mb-2 flex w-full items-center gap-3 rounded-xl border border-foreground/10 bg-background/35 px-3 py-3 text-left"
                          >
                            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                              <FolderOpen className="size-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12px] font-extrabold">
                                {translate("View documents")} {"·"} {m.attachment.documents.length}
                              </span>
                              <span className="block truncate text-[10px] font-semibold opacity-65">
                                {m.attachment.documents
                                  .slice(0, 2)
                                  .map((document) => document.fileName)
                                  .join(" · ")}
                              </span>
                            </span>
                            <ArrowRight className="size-4 shrink-0 opacity-60" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`${translate("Preview attachment")}: ${m.attachment.fileName}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!m.attachment || isChatDocumentBundle(m.attachment)) return;
                              setPreviewAttachment(m.attachment ?? null);
                              sfx("open");
                            }}
                            className={cn(
                              "press mb-2 block w-full overflow-hidden text-left",
                              isChatImageAttachment(m.attachment)
                                ? "rounded-2xl bg-transparent"
                                : "rounded-xl border border-foreground/10 bg-background/35",
                            )}
                          >
                            {m.attachment.mimeType.startsWith("image/") ? (
                              <img
                                src={m.attachment.previewUrl || m.attachment.driveViewUrl}
                                alt={m.attachment.fileName}
                                loading="lazy"
                                className="max-h-[22rem] w-full max-w-[18rem] rounded-2xl object-contain"
                              />
                            ) : (
                              <span className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
                                <FileText className="size-5 shrink-0 text-primary" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12px] font-extrabold">
                                    {m.attachment.fileName}
                                  </span>
                                  <span className="block text-[10px] font-semibold opacity-60">
                                    {Math.max(1, Math.round(m.attachment.size / 1024))}{" "}
                                    {translate("KB")}
                                  </span>
                                </span>
                              </span>
                            )}
                          </button>
                        ))}
                      <div dir="auto" className="whitespace-pre-wrap break-words">
                        {m.attachment && m.text === m.attachment.fileName ? "" : m.text}
                      </div>
                      <span
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px] font-bold",
                          m.from === "me" ? "opacity-70" : "opacity-45",
                        )}
                      >
                        {m.quick && <Zap className="size-3" />}
                        {m.editedAt && <span>{translate("Edited")}</span>}
                        {clock(m.at)}
                        {m.from === "me" &&
                          (m.status === "read" ? (
                            <CheckCheck className="size-3 text-primary-foreground drop-shadow-[0_0_6px_color-mix(in_oklab,var(--primary)_85%,white)]" />
                          ) : (
                            <Check className="size-3 text-primary-foreground/75" />
                          ))}
                      </span>
                    </div>
                  </motion.div>
                ))}
                <div ref={endRef} />
              </div>
            </div>

            {!!role && !!user?.id && (
              <ConversationWorkflow
                conversationId={thread.id}
                userId={user.id}
                role={role}
                accountantName={thread.personName ?? thread.name}
                accountantPhoto={thread.photo}
                accountantFirm={thread.firmName}
                initiallyExpanded={!!search.workflow}
                messageCount={convo.length}
              />
            )}

            {/* composer */}
            <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-[560px]">
                <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
                  {quicks.map((qm) => (
                    <motion.button
                      key={qm.id}
                      whileTap={{ scale: 0.95 }}
                      onPointerEnter={() => sfx("hover")}
                      disabled={!!activeControl?.is_blocked}
                      onClick={() => void send(translate(qm.text), true)}
                      className="glass press shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-bold whitespace-nowrap"
                    >
                      {translate(qm.label)}
                    </motion.button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(draft);
                  }}
                  className="glass flex items-center gap-2 rounded-full p-1.5 pl-4"
                >
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void sendAttachment(file);
                    }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void sendAttachment(file);
                    }}
                  />
                  <Popover
                    open={attachmentPickerOpen}
                    onOpenChange={(nextOpen) => {
                      setAttachmentPickerOpen(nextOpen);
                      if (!nextOpen) setStoredDocumentsOpen(false);
                      sfx(nextOpen ? "open" : "close");
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={translate("Attach a file or document")}
                        aria-expanded={attachmentPickerOpen}
                        disabled={!!activeControl?.is_blocked || attachmentSending}
                        className="press grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground disabled:opacity-40"
                      >
                        {attachmentSending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Paperclip className="size-4" />
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align={isArabic ? "start" : "end"}
                      side="top"
                      sideOffset={10}
                      className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border/60 bg-card/95 p-2.5 shadow-2xl backdrop-blur-2xl"
                    >
                      {storedDocumentsOpen ? (
                        <div className="grid gap-1">
                          <div className="flex items-center gap-2 border-b border-border/60 px-1 pb-2">
                            <button
                              type="button"
                              aria-label={translate("Back")}
                              onClick={() => {
                                setStoredDocumentsOpen(false);
                                sfx("close");
                              }}
                              className="press grid size-8 shrink-0 place-items-center rounded-full hover:bg-secondary/70"
                            >
                              <ArrowLeft className="size-4" />
                            </button>
                            <span className="text-[13px] font-extrabold">
                              {translate("Stored documents")}
                            </span>
                            {attachableDocs.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedStoredDocumentIds(
                                    selectedStoredDocumentIds.length === attachableDocs.length
                                      ? []
                                      : attachableDocs.map((doc) => doc.id),
                                  )
                                }
                                className="press ml-auto rounded-full px-2 py-1 text-[10px] font-bold text-primary"
                              >
                                {translate(
                                  selectedStoredDocumentIds.length === attachableDocs.length
                                    ? "Clear"
                                    : "Select all",
                                )}
                              </button>
                            )}
                          </div>
                          <div className="no-scrollbar grid max-h-[min(45dvh,22rem)] gap-1 overflow-y-auto pt-1">
                            {attachableDocs.map((doc) => {
                              const selected = selectedStoredDocumentIds.includes(doc.id);
                              return (
                                <button
                                  key={doc.id}
                                  type="button"
                                  aria-pressed={selected}
                                  disabled={attachmentSending}
                                  onClick={() => {
                                    sfx("select");
                                    setSelectedStoredDocumentIds((current) =>
                                      current.includes(doc.id)
                                        ? current.filter((id) => id !== doc.id)
                                        : [...current, doc.id],
                                    );
                                  }}
                                  className={`press flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-start hover:bg-secondary/70 disabled:opacity-45 ${selected ? "bg-primary/8" : ""}`}
                                >
                                  {doc.mimeType?.startsWith("image/") && doc.driveFileId ? (
                                    <img
                                      src={`https://drive.google.com/thumbnail?id=${encodeURIComponent(doc.driveFileId)}&sz=w180`}
                                      alt=""
                                      loading="lazy"
                                      className="size-9 shrink-0 rounded-lg object-cover"
                                    />
                                  ) : (
                                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                                      <FileText className="size-4" />
                                    </span>
                                  )}
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[12px] font-bold">
                                      {doc.merchant}
                                    </span>
                                    <span className="block truncate text-[10px] text-muted-foreground">
                                      {translate(doc.category)} · {doc.date}
                                    </span>
                                  </span>
                                  {selected ? (
                                    <Check className="size-4 shrink-0 text-primary" />
                                  ) : (
                                    <span className="size-4 shrink-0 rounded-full border border-border" />
                                  )}
                                </button>
                              );
                            })}
                            {attachableDocs.length === 0 && (
                              <p className="px-3 py-5 text-center text-[11px] text-muted-foreground">
                                {translate("No stored Drive documents are available.")}
                              </p>
                            )}
                          </div>
                          {selectedStoredDocumentIds.length > 0 && (
                            <button
                              type="button"
                              disabled={attachmentSending}
                              onClick={() => {
                                sfx("confirm");
                                void sendAttachment(undefined, selectedStoredDocumentIds);
                              }}
                              className="press mt-1 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
                            >
                              <Send className="size-3.5" />
                              {translate("Send selected documents")} {"·"}
                              {selectedStoredDocumentIds.length}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="grid gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setAttachmentPickerOpen(false);
                              sfx("select");
                              imageInputRef.current?.click();
                            }}
                            className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[12.5px] font-semibold hover:bg-secondary/70"
                          >
                            <ImagePlus className="size-4 text-primary" />
                            {translate("Choose a photo")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachmentPickerOpen(false);
                              sfx("select");
                              fileInputRef.current?.click();
                            }}
                            className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[12.5px] font-semibold hover:bg-secondary/70"
                          >
                            <FileText className="size-4 text-primary" />
                            {translate("Choose a file")}
                          </button>
                          {role === "taxpayer" && (
                            <button
                              type="button"
                              onClick={() => {
                                setStoredDocumentsOpen(true);
                                sfx("open");
                              }}
                              className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[12.5px] font-semibold hover:bg-secondary/70"
                            >
                              <FolderOpen className="size-4 text-primary" />
                              {translate("Attach a stored document")}
                            </button>
                          )}
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      activeControl?.is_blocked
                        ? translate("Conversation blocked")
                        : translate("Write a message")
                    }
                    className="min-w-0 flex-1 bg-transparent py-2 text-[13.5px] font-semibold outline-none placeholder:text-muted-foreground/70"
                    disabled={!!activeControl?.is_blocked}
                  />
                  <motion.button
                    type="submit"
                    disabled={!draft.trim() || !!activeControl?.is_blocked}
                    whileTap={{ scale: 0.92 }}
                    className="press grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                    style={{ boxShadow: "var(--shadow-accent)" }}
                    aria-label={translate("Send")}
                  >
                    <Send className="size-4" />
                  </motion.button>
                </form>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog
        open={chatActionsOpen}
        onOpenChange={(nextOpen) => {
          setChatActionsOpen(nextOpen);
          if (!nextOpen) sfx("close");
        }}
      >
        <DialogContent
          overlayClassName="z-[80]"
          className="z-[90] w-[calc(100%-2rem)] max-w-sm rounded-[24px] border border-border/60 bg-card/95 p-5 shadow-2xl backdrop-blur-2xl [&>button:last-child]:hidden"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-[16px] font-extrabold">
                {translate("Conversation actions")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12px]">{thread?.name}</DialogDescription>
            </div>
            <button
              type="button"
              aria-label={translate("Close")}
              onClick={() => setChatActionsOpen(false)}
              className="press grid size-8 shrink-0 place-items-center rounded-full bg-secondary/70"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-1.5">
            <button
              type="button"
              onClick={() => {
                setChatActionsOpen(false);
                setSelectedMessageId(convo.at(-1)?.id ?? null);
                setMessageActionMode("ask");
                setAskAiDraft(
                  translate(
                    "Based on my documents and your profile, are you a good fit for my tax needs?",
                  ),
                );
                setMiniAiMessages([]);
                setMiniAiError(null);
                setMessageActionsOpen(true);
                sfx("open");
              }}
              className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold hover:bg-primary/10"
            >
              <FiscoOrb size={22} state="idle" />
              {translate("Ask Fisco AI about this accountant")}
            </button>
            <button
              type="button"
              onClick={() => {
                sfx("select");
                void updateConversationControl({ is_restricted: !activeControl?.is_restricted });
              }}
              className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold hover:bg-secondary/70"
            >
              <EyeOff className="size-4 opacity-65" />
              {activeControl?.is_restricted
                ? translate("Show incoming messages")
                : translate("Restrict incoming messages")}
            </button>
            <button
              type="button"
              onClick={() => {
                sfx("select");
                void updateConversationControl({ is_blocked: !activeControl?.is_blocked });
              }}
              className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold hover:bg-secondary/70"
            >
              <Ban className="size-4 opacity-65" />
              {activeControl?.is_blocked
                ? translate("Unblock conversation")
                : translate("Block conversation")}
            </button>
            <button
              type="button"
              onClick={() => {
                sfx("select");
                void updateConversationControl({ hidden_at: new Date().toISOString() });
              }}
              className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold text-destructive hover:bg-destructive/8"
            >
              <Trash2 className="size-4" /> {translate("Delete chat for me")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!previewAttachment}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachment(null);
            sfx("close");
          }
        }}
      >
        <DialogContent
          className={cn(
            "flex flex-col overflow-hidden [&>button:last-child]:hidden",
            isChatImageAttachment(previewAttachment)
              ? "fixed inset-0 left-0 top-0 z-[100] h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-black p-0 shadow-none"
              : "h-[min(86dvh,52rem)] w-[calc(100%-1.5rem)] max-w-5xl gap-3 rounded-2xl border border-border/60 bg-card/95 p-4 shadow-2xl backdrop-blur-2xl",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-center justify-between gap-3",
              isChatImageAttachment(previewAttachment)
                ? "absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/75 to-transparent px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-6 text-white"
                : "",
            )}
          >
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-extrabold">
                {previewAttachment?.fileName}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                {translate("Attachment preview")}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {previewAttachment && (
                <a
                  href={previewAttachment.driveViewUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => sfx("open")}
                  className="press rounded-full bg-secondary px-3 py-2 text-xs font-bold"
                >
                  {translate("Open in Drive")}
                </a>
              )}
              <button
                type="button"
                aria-label={translate("Close")}
                onClick={() => setPreviewAttachment(null)}
                className={cn(
                  "press grid size-9 place-items-center rounded-full",
                  isChatImageAttachment(previewAttachment) ? "bg-white/15" : "bg-secondary",
                )}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-hidden",
              isChatImageAttachment(previewAttachment)
                ? "grid place-items-center overflow-auto bg-black"
                : "rounded-xl border border-border/60 bg-background/60",
            )}
          >
            {previewAttachment?.mimeType.startsWith("image/") ? (
              <img
                src={previewAttachment.previewUrl || previewAttachment.driveViewUrl}
                alt={previewAttachment.fileName}
                className="size-full object-contain"
                style={{ touchAction: "pan-x pan-y pinch-zoom" }}
              />
            ) : previewAttachment ? (
              <iframe
                src={`https://drive.google.com/file/d/${encodeURIComponent(previewAttachment.driveFileId)}/preview`}
                title={previewAttachment.fileName}
                className="size-full border-0"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!previewBundle}
        onOpenChange={(open) => {
          if (!open) setPreviewBundle(null);
        }}
      >
        <DialogContent className="max-h-[min(80dvh,42rem)] w-[calc(100%-1.5rem)] max-w-lg overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-4 shadow-2xl backdrop-blur-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-extrabold">
                {translate("Documents shared")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                {previewBundle?.documents.length ?? 0} {translate("documents")}
              </DialogDescription>
            </div>
            <button
              type="button"
              aria-label={translate("Close")}
              onClick={() => setPreviewBundle(null)}
              className="press grid size-9 shrink-0 place-items-center rounded-full bg-secondary"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="no-scrollbar grid gap-1 overflow-y-auto">
            {previewBundle?.documents.map((document) => (
              <button
                key={document.documentId ?? document.driveFileId}
                type="button"
                onClick={() => {
                  setPreviewBundle(null);
                  setPreviewAttachment(document);
                  sfx("open");
                }}
                className="press flex min-h-12 min-w-0 items-center gap-3 rounded-xl px-3 text-left hover:bg-secondary/70"
              >
                <FileText className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold">
                  {document.fileName}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={messageActionsOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setMessageActionsOpen(true);
          else if (messageActionsOpen) closeMessageActions();
        }}
      >
        <DialogContent
          overlayClassName="z-[80]"
          style={
            messageActionOrigin
              ? (() => {
                  const panelWidth = Math.min(448, window.innerWidth - 24);
                  const panelHeight = Math.min(window.innerHeight * 0.88, 680);
                  const preferredLeft = messageActionOrigin.fromMe
                    ? messageActionOrigin.right - panelWidth
                    : messageActionOrigin.left;
                  const left = Math.max(
                    12,
                    Math.min(preferredLeft, window.innerWidth - panelWidth - 12),
                  );
                  const below = messageActionOrigin.top + 10;
                  const top =
                    below + panelHeight <= window.innerHeight - 12
                      ? below
                      : Math.max(12, messageActionOrigin.top - panelHeight - 10);
                  return { left, top };
                })()
              : undefined
          }
          className="z-[90] left-auto top-auto max-h-[88dvh] w-[calc(100%-1.5rem)] max-w-md translate-x-0 translate-y-0 overflow-y-auto rounded-[24px] border border-border/60 bg-card/95 p-5 shadow-2xl backdrop-blur-2xl [&>button:last-child]:hidden"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2 text-[16px] font-extrabold">
                {messageActionMode === "ask" && (
                  <FiscoOrb size={24} state={miniAiLoading ? "thinking" : "idle"} />
                )}
                {messageActionMode === "edit"
                  ? translate("Edit message")
                  : messageActionMode === "ask"
                    ? translate("Ask Fisco AI")
                    : translate("Message options")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12px]">
                {messageActionMode === "ask"
                  ? translate(
                      "Fisco can use this message, the recent chat, and available accountant details.",
                    )
                  : thread?.name}
              </DialogDescription>
            </div>
            <button
              type="button"
              aria-label={translate("Close")}
              onClick={() => closeMessageActions()}
              className="press grid size-8 shrink-0 place-items-center rounded-full bg-secondary/70"
            >
              <X className="size-4" />
            </button>
          </div>

          {selectedMessage && (
            <blockquote
              dir="auto"
              className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border/50 bg-secondary/55 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-foreground"
            >
              {selectedMessage.text}
            </blockquote>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {messageActionMode === "actions" && selectedMessage && (
              <motion.div
                key="actions"
                initial={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -5, scale: 0.99, filter: "blur(4px)" }}
                transition={{ duration: 0.2, ease: EASE }}
                className="grid gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMessageActionMode("ask");
                    sfx("open");
                  }}
                  className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold hover:bg-primary/10"
                >
                  <FiscoOrb size={22} state={miniAiLoading ? "thinking" : "idle"} />
                  {translate("Ask Fisco AI about this")}
                </button>
                {selectedMessage.from === "me" && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditDraft(selectedMessage.text);
                      setMessageActionMode("edit");
                      sfx("select");
                    }}
                    className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold hover:bg-secondary/70"
                  >
                    <Pencil className="size-4 opacity-65" /> {translate("Edit")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void copyMessage()}
                  className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold hover:bg-secondary/70"
                >
                  <Copy className="size-4 opacity-65" /> {translate("Copy message")}
                </button>
                {selectedMessage.from === "me" && (
                  <button
                    type="button"
                    disabled={deletingMessageId === selectedMessage.id}
                    onClick={() => void deleteMessage(selectedMessage.id)}
                    className="press flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-semibold text-destructive hover:bg-destructive/8 disabled:opacity-45"
                  >
                    {deletingMessageId === selectedMessage.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    {translate("Delete message")}
                  </button>
                )}
              </motion.div>
            )}

            {messageActionMode === "edit" && (
              <motion.form
                key="edit"
                initial={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -5, scale: 0.99, filter: "blur(4px)" }}
                transition={{ duration: 0.2, ease: EASE }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void editMessage();
                }}
                className="grid gap-3"
              >
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(event) => setEditDraft(event.currentTarget.value)}
                  rows={4}
                  className="w-full resize-y rounded-xl border border-border/60 bg-background/70 px-3 py-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMessageActionMode("actions");
                      sfx("close");
                    }}
                    className="press min-h-10 rounded-xl px-3 text-[12px] font-bold hover:bg-secondary/70"
                  >
                    {translate("Cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={!editDraft.trim() || editDraft.trim() === selectedMessage?.text}
                    className="press min-h-10 rounded-xl bg-primary px-4 text-[12px] font-bold text-primary-foreground disabled:opacity-40"
                  >
                    {translate("Save")}
                  </button>
                </div>
              </motion.form>
            )}

            {messageActionMode === "ask" && (
              <motion.div
                key="ask"
                initial={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -5, scale: 0.99, filter: "blur(4px)" }}
                transition={{ duration: 0.2, ease: EASE }}
                className="grid gap-3"
              >
                <div className="no-scrollbar grid max-h-[36dvh] gap-2 overflow-y-auto">
                  {miniAiMessages.map((message, index) => (
                    <motion.div
                      key={`${message.role}-${index}`}
                      initial={{ opacity: 0, y: 8, filter: "blur(5px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      className={cn(
                        "max-w-[92%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed",
                        message.role === "user"
                          ? "ms-auto bg-primary text-primary-foreground"
                          : "glass",
                      )}
                    >
                      {message.text ? (
                        message.role === "assistant" ? (
                          <Suspense
                            fallback={<span className="whitespace-pre-wrap">{message.text}</span>}
                          >
                            <MessageResponse className="fisco-md">{message.text}</MessageResponse>
                          </Suspense>
                        ) : (
                          message.text
                        )
                      ) : null}
                    </motion.div>
                  ))}
                  {miniAiLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 text-[12px] text-muted-foreground"
                      aria-live="polite"
                    >
                      <span className="flex items-center gap-1" aria-hidden="true">
                        {[0, 1, 2].map((dot) => (
                          <motion.span
                            key={dot}
                            className="size-1.5 rounded-full bg-primary"
                            animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 0.72, delay: dot * 0.13, repeat: Infinity }}
                          />
                        ))}
                      </span>
                      {translate("Fisco is thinking")}
                    </motion.div>
                  )}
                </div>
                {miniAiError && (
                  <p role="alert" className="text-[11px] font-semibold text-destructive">
                    {miniAiError}
                  </p>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void askMiniAi();
                  }}
                  className="glass flex items-center gap-2 rounded-full p-1.5 ps-4"
                >
                  <FiscoOrb size={20} state={miniAiLoading ? "thinking" : "idle"} />
                  <input
                    autoFocus
                    value={askAiDraft}
                    onChange={(event) => setAskAiDraft(event.currentTarget.value)}
                    placeholder={translate("Ask about this message or accountant")}
                    className="min-w-0 flex-1 bg-transparent py-2 text-[12.5px] outline-none placeholder:text-muted-foreground/70"
                    disabled={miniAiLoading}
                  />
                  <button
                    type="submit"
                    disabled={!askAiDraft.trim() || miniAiLoading}
                    aria-label={translate("Send")}
                    className="press grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    {miniAiLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </div>
  );
}
