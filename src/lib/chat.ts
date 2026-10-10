/** Local, in-memory chat model for the Fisco messaging surface. */

export type ChatAttachment = {
  driveFileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  driveViewUrl: string;
  previewUrl?: string;
  documentId?: string;
};

export type ChatDocumentBundle = {
  kind: "document_bundle";
  fileName: string;
  documents: ChatAttachment[];
};

export type ChatMessageAttachment = ChatAttachment | ChatDocumentBundle;

export function isChatDocumentBundle(
  attachment: ChatMessageAttachment | null | undefined,
): attachment is ChatDocumentBundle {
  return !!attachment && "kind" in attachment && attachment.kind === "document_bundle";
}

export function isChatImageAttachment(
  attachment: ChatMessageAttachment | null | undefined,
): attachment is ChatAttachment {
  return (
    !!attachment && !isChatDocumentBundle(attachment) && attachment.mimeType.startsWith("image/")
  );
}

export type ChatMsg = {
  id: string;
  threadId: string;
  from: "me" | "them";
  text: string;
  at: number;
  /** true when the message came from a one-click hybrid template */
  quick?: boolean;
  status?: "sent" | "read";
  readAt?: number | null;
  editedAt?: number | null;
  forwardedFromMessageId?: string | null;
  attachment?: ChatMessageAttachment | null;
  workflowEvent?: boolean;
  workflowNotificationId?: string;
};

export type ChatThread = {
  id: string;
  peerId?: string;
  name: string;
  personName?: string;
  firmName?: string;
  sub: string;
  initials: string;
  photo?: string;
  details?: string;
  online: boolean;
  pinned?: boolean;
};

export const THREADS: Record<"taxpayer" | "accountant", ChatThread[]> = {
  taxpayer: [],
  accountant: [],
};

export const QUICK_MESSAGES: Record<
  "taxpayer" | "accountant",
  { id: string; label: string; text: string }[]
> = {
  taxpayer: [
    {
      id: "q1",
      label: "Sent docs",
      text: "I just sent this month's documents — could you confirm?",
    },
    { id: "q2", label: "Deadline?", text: "What's the next filing deadline I should prepare for?" },
    { id: "q3", label: "Need receipt", text: "Could you send me the receipt for the last filing?" },
    { id: "q4", label: "Thanks", text: "Thank you, appreciated!" },
    { id: "q5", label: "Call me", text: "Are you free for a quick call today?" },
  ],
  accountant: [
    {
      id: "q1",
      label: "Docs received",
      text: "Documents received — I'll review and get back to you.",
    },
    {
      id: "q2",
      label: "Missing invoice",
      text: "One invoice is missing for this period. Could you upload it?",
    },
    { id: "q3", label: "Filed ✅", text: "Your filing is submitted. Confirmation is attached." },
    { id: "q4", label: "Reminder", text: "Friendly reminder: the deadline is in 3 days." },
    { id: "q5", label: "Fees", text: "I've sent the fee note for this quarter." },
  ],
};

const t = (min: number) => Date.now() - min * 60000;

export const SEED_MESSAGES: Record<"taxpayer" | "accountant", ChatMsg[]> = {
  taxpayer: [],
  accountant: [],
};

export const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
