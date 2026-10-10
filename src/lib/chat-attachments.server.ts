import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { uploadToGoogleDrive } from "@/lib/drive";
import type { Database } from "@/integrations/supabase/types";
import type { ChatAttachment, ChatDocumentBundle, ChatMessageAttachment } from "@/lib/chat";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const SendAttachmentInput = z
  .object({
    conversationId: z.string().uuid(),
    caption: z.string().trim().max(1000).optional(),
    documentId: z.string().uuid().optional(),
    documentIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    file: z
      .object({
        fileName: z.string().trim().min(1).max(180),
        mimeType: z.string().trim().min(1).max(120),
        dataUrl: z.string().min(1).max(MAX_REQUEST_BYTES),
      })
      .optional(),
  })
  .refine(
    (value) =>
      Number(!!value.documentId) + Number(!!value.documentIds?.length) + Number(!!value.file) === 1,
  );

type AuthenticatedRequest = {
  client: ReturnType<typeof createClient<Database>>;
  userId: string;
};

type ConversationRow = { id: string; taxpayer_id: string; accountant_id: string };
type DocumentRow = {
  id: string;
  owner_id: string;
  accountant_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  drive_file_id: string | null;
  preview_url: string | null;
  owner_role?: string;
  status?: string;
};

type StoredMessage = { id: string; sender_id: string; attachment: unknown };

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function authenticate(request: Request): Promise<AuthenticatedRequest | Response> {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return errorResponse("Sign in to send a chat attachment.", 401);

  const url = process.env["SUPABASE_URL"] || env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return errorResponse("Chat attachments are not configured.", 503);

  const client = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") {
    return errorResponse("Your session expired. Sign in again.", 401);
  }
  return { client, userId };
}

function driveScriptUrl() {
  return (
    process.env["DRIVE_SCRIPT_URL"] ||
    process.env["VITE_DRIVE_UPLOAD_URL"] ||
    env["VITE_DRIVE_UPLOAD_URL"] ||
    null
  );
}

async function trashDriveFile(fileId: string, signal?: AbortSignal) {
  const scriptUrl = driveScriptUrl();
  const deleteSecret = process.env["DRIVE_DELETE_SECRET"];
  if (!scriptUrl || !deleteSecret) {
    return { success: false, error: "Drive deletion is not configured on the server." };
  }
  try {
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "delete", fileId, deleteToken: deleteSecret }),
      signal,
    });
    const result = (await response.json()) as { success?: boolean; error?: string };
    return response.ok && result.success
      ? { success: true as const }
      : {
          success: false as const,
          error: result.error || "Google Drive could not trash this file.",
        };
  } catch {
    return { success: false, error: "Fisco could not contact the Drive deletion script." };
  }
}

function fileBytes(dataUrl: string, mimeType: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (
    !match?.[1] ||
    !match[2] ||
    (match[1].toLowerCase() !== mimeType.toLowerCase() &&
      match[1].toLowerCase() !== "application/octet-stream")
  )
    return null;
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > MAX_FILE_BYTES) return null;
  return data;
}

function resolveMimeType(fileName: string, suppliedMimeType: string) {
  const mimeType = suppliedMimeType.toLowerCase();
  if (ALLOWED_MIME_TYPES.has(mimeType)) return mimeType;
  const extension = fileName.toLowerCase().split(".").pop();
  const byExtension: Record<string, string> = {
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    txt: "text/plain",
    webp: "image/webp",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return extension ? byExtension[extension] || mimeType : mimeType;
}

function driveAttachment(attachment: ChatAttachment, originalDocumentId?: string): ChatAttachment {
  return { ...attachment, ...(originalDocumentId ? { documentId: originalDocumentId } : {}) };
}

function documentAttachment(document: DocumentRow): ChatAttachment {
  const driveViewUrl = `https://drive.google.com/file/d/${encodeURIComponent(document.drive_file_id!)}/view`;
  return driveAttachment(
    {
      driveFileId: document.drive_file_id!,
      fileName: document.name,
      mimeType: document.mime_type,
      size: Number(document.size_bytes) || 0,
      driveViewUrl,
      previewUrl: document.mime_type.startsWith("image/")
        ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(document.drive_file_id!)}&sz=w1200`
        : document.preview_url || driveViewUrl,
    },
    document.id,
  );
}

export async function sendChatAttachment(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const requestBytes = Number(request.headers.get("content-length") || 0);
  if (requestBytes > MAX_REQUEST_BYTES) {
    return errorResponse("Attachments must be 8 MB or smaller.", 413);
  }

  let input: z.infer<typeof SendAttachmentInput>;
  try {
    input = SendAttachmentInput.parse(await request.json());
  } catch {
    return errorResponse("Choose a valid file or stored document.", 400);
  }

  const { data: conversationData, error: conversationError } = await auth.client
    .from("conversations" as never)
    .select("id, taxpayer_id, accountant_id")
    .eq("id", input.conversationId)
    .maybeSingle();
  const conversation = conversationData as unknown as ConversationRow | null;
  if (conversationError || !conversation) {
    return errorResponse("This conversation is no longer available.", 404);
  }

  let attachment: ChatMessageAttachment;
  let uploadedFileId: string | null = null;
  let body = input.caption?.trim() || "";
  let documentsToAssign: DocumentRow[] = [];

  if (input.documentIds) {
    if (auth.userId !== conversation.taxpayer_id) {
      return errorResponse("Only the taxpayer can share stored documents from this picker.", 403);
    }
    const documentIds = [...new Set(input.documentIds)];
    const { data, error } = await auth.client
      .from("documents" as never)
      .select(
        "id, owner_id, owner_role, accountant_id, status, name, mime_type, size_bytes, drive_file_id, preview_url",
      )
      .in("id", documentIds);
    const documents = (data ?? []) as unknown as DocumentRow[];
    if (
      error ||
      documents.length !== documentIds.length ||
      documents.some(
        (document) =>
          document.owner_id !== auth.userId ||
          document.owner_role !== "taxpayer" ||
          !document.drive_file_id,
      )
    ) {
      return errorResponse("One or more selected documents are not available to share.", 403);
    }
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    documentsToAssign = documentIds.map((id) => documentsById.get(id)!);
    const bundle: ChatDocumentBundle = {
      kind: "document_bundle",
      fileName: `${documentsToAssign.length} documents`,
      documents: documentsToAssign.map(documentAttachment),
    };
    attachment = bundle;
    body ||= bundle.fileName;
  } else if (input.documentId) {
    const { data, error } = await auth.client
      .from("documents" as never)
      .select(
        "id, owner_id, accountant_id, name, mime_type, size_bytes, drive_file_id, preview_url",
      )
      .eq("id", input.documentId)
      .maybeSingle();
    const document = data as unknown as DocumentRow | null;
    const canShareDocument =
      !!document &&
      !!document.drive_file_id &&
      (document.owner_id === auth.userId ||
        (document.accountant_id === auth.userId && document.owner_id === conversation.taxpayer_id));
    if (error || !canShareDocument || !document?.drive_file_id) {
      return errorResponse("That stored document is not available in this conversation.", 403);
    }
    attachment = documentAttachment(document);
    body ||= document.name;
  } else if (input.file) {
    const mimeType = resolveMimeType(input.file.fileName, input.file.mimeType);
    const bytes = fileBytes(input.file.dataUrl, mimeType);
    if (!ALLOWED_MIME_TYPES.has(mimeType) || !bytes) {
      return errorResponse("Choose a supported image or document up to 8 MB.", 400);
    }

    const uploaded = await uploadToGoogleDrive(
      input.file.fileName,
      input.file.dataUrl,
      mimeType,
      "FISCO_Message_Attachments",
    );
    if (!uploaded.success || !uploaded.fileId) {
      return errorResponse(uploaded.error || "Google Drive could not store this attachment.", 502);
    }

    uploadedFileId = uploaded.fileId;
    const driveViewUrl =
      uploaded.driveViewUrl ||
      `https://drive.google.com/file/d/${encodeURIComponent(uploaded.fileId)}/view`;
    attachment = {
      driveFileId: uploaded.fileId,
      fileName: uploaded.fileName || input.file.fileName,
      mimeType,
      size: uploaded.size ?? bytes.byteLength,
      driveViewUrl,
      previewUrl: mimeType.startsWith("image/")
        ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(uploaded.fileId)}&sz=w1200`
        : uploaded.previewUrl || driveViewUrl,
    };
    body ||= input.file.fileName;
  } else {
    return errorResponse("Choose a file to attach.", 400);
  }

  if (documentsToAssign.length > 0) {
    const { error } = await auth.client
      .from("documents" as never)
      .update({ accountant_id: conversation.accountant_id, status: "sent" } as never)
      .in(
        "id",
        documentsToAssign.map((document) => document.id),
      )
      .eq("owner_id", auth.userId);
    if (error) return errorResponse("The selected documents could not be shared.", 409);
  }

  const { data: inserted, error: insertError } = await auth.client
    .from("messages" as never)
    .insert({
      conversation_id: conversation.id,
      sender_id: auth.userId,
      body,
      attachment,
    } as never)
    .select("id, created_at")
    .single();

  if (insertError) {
    if (uploadedFileId) await trashDriveFile(uploadedFileId, request.signal);
    if (documentsToAssign.length > 0) {
      await Promise.all(
        documentsToAssign.map((document) =>
          auth.client
            .from("documents" as never)
            .update({
              accountant_id: document.accountant_id,
              status: document.status,
            } as never)
            .eq("id", document.id)
            .eq("owner_id", auth.userId),
        ),
      );
    }
    return errorResponse(
      "This attachment could not be sent. The relationship may be blocked or inactive.",
      409,
    );
  }

  await auth.client
    .from("conversations" as never)
    .update({ updated_at: new Date().toISOString() } as never)
    .eq("id", conversation.id);

  return Response.json({ success: true, message: inserted, attachment });
}

export async function deleteChatMessage(request: Request, messageId: string) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.client
    .from("messages" as never)
    .select("id, sender_id, attachment")
    .eq("id", messageId)
    .eq("sender_id", auth.userId)
    .maybeSingle();
  const message = data as unknown as StoredMessage | null;
  if (error || !message) return errorResponse("Message not found or it cannot be deleted.", 404);

  const attachment =
    message.attachment && typeof message.attachment === "object"
      ? (message.attachment as ChatAttachment)
      : null;
  if (attachment?.driveFileId && !attachment.documentId) {
    const { data: otherReference, error: referenceError } = await auth.client
      .from("messages" as never)
      .select("id")
      .eq("attachment->>driveFileId", attachment.driveFileId)
      .neq("id", messageId)
      .limit(1)
      .maybeSingle();
    if (referenceError) {
      return errorResponse("Fisco could not verify whether this file is still in use.", 503);
    }
    if (!otherReference) {
      const trashed = await trashDriveFile(attachment.driveFileId, request.signal);
      if (!trashed.success)
        return errorResponse(trashed.error || "Drive file deletion failed.", 502);
    }
  }

  const { error: deleteError } = await auth.client
    .from("messages" as never)
    .delete()
    .eq("id", messageId)
    .eq("sender_id", auth.userId);
  if (deleteError) return errorResponse("This message could not be deleted.", 500);
  return Response.json({ success: true });
}
