import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import {
  ArrowLeft,
  Camera,
  Clock3,
  CornerDownLeft,
  FileText,
  ImagePlus,
  Loader2,
  Menu,
  Mic,
  Plus,
  Square,
  SwitchCamera,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { FiscoOrb } from "@/components/FiscoOrb";
import { sfx, unlockAudio } from "@/lib/sound";
import { getThread, saveMessages, syncThreadToSupabase } from "@/lib/thread-store";
import { messageText } from "@/lib/threads";
import { recordWav } from "@/lib/record-wav";
import { useStore } from "@/lib/app-store";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { sfx as playSfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type PendingImage = { file: File; previewUrl: string };
type PendingDocument = { file: File; mimeType: string };
type ImagePreview = { src: string; fileName: string };
type ImageQuota = { used: number; limit: number; resetAt: string | null };
type DocumentQuota = { used: number; limit: number; resetAt: string | null };

async function fetchImageQuota(): Promise<ImageQuota | null> {
  const { data, error } = await supabase.rpc("get_ai_image_quota" as never);
  if (error || !data) return null;
  const quota = data as unknown as {
    used?: unknown;
    limit?: unknown;
    reset_at?: unknown;
  };
  if (typeof quota.used !== "number" || typeof quota.limit !== "number") return null;
  return {
    used: quota.used,
    limit: quota.limit,
    resetAt: typeof quota.reset_at === "string" ? quota.reset_at : null,
  };
}

async function fetchDocumentQuota(): Promise<DocumentQuota | null> {
  const { data, error } = await supabase.rpc("get_ai_document_quota" as never);
  if (error || !data) return null;
  const quota = data as unknown as {
    used?: unknown;
    limit?: unknown;
    reset_at?: unknown;
  };
  if (typeof quota.used !== "number" || typeof quota.limit !== "number") return null;
  return {
    used: quota.used,
    limit: quota.limit,
    resetAt: typeof quota.reset_at === "string" ? quota.reset_at : null,
  };
}

function imageQuotaFromError(error: Error): ImageQuota | null {
  try {
    const payload = JSON.parse(error.message) as {
      code?: unknown;
      used?: unknown;
      limit?: unknown;
      resetAt?: unknown;
    };
    if (
      payload.code !== "IMAGE_QUOTA_EXCEEDED" ||
      typeof payload.used !== "number" ||
      typeof payload.limit !== "number"
    ) {
      return null;
    }
    return {
      used: payload.used,
      limit: payload.limit,
      resetAt: typeof payload.resetAt === "string" ? payload.resetAt : null,
    };
  } catch {
    return null;
  }
}

function documentQuotaFromError(error: Error): DocumentQuota | null {
  try {
    const payload = JSON.parse(error.message) as {
      code?: unknown;
      used?: unknown;
      limit?: unknown;
      resetAt?: unknown;
    };
    if (
      payload.code !== "DOCUMENT_QUOTA_EXCEEDED" ||
      typeof payload.used !== "number" ||
      typeof payload.limit !== "number"
    ) {
      return null;
    }
    return {
      used: payload.used,
      limit: payload.limit,
      resetAt: typeof payload.resetAt === "string" ? payload.resetAt : null,
    };
  } catch {
    return null;
  }
}

function formatQuotaRemaining(resetAt: string, now: number): string {
  const remainingMinutes = Math.max(0, Math.ceil((Date.parse(resetAt) - now) / 60_000));
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function readableChatError(
  error: Error,
  translate: (message: string) => string = (message) => message,
): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    return error.message || translate("Fisco could not answer right now.");
  }
  return error.message || translate("Fisco could not answer right now.");
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image read failed."));
    reader.onerror = () => reject(new Error("Image read failed."));
    reader.readAsDataURL(file);
  });
}

async function createImagePreviewDataUrl(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fileToDataUrl(file);
  }
  try {
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return fileToDataUrl(file);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.78);
  } finally {
    bitmap.close();
  }
}

function appendImagePreview(messages: UIMessage[], file: File, url: string): UIMessage[] {
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return messages;
  const userMessage = messages[userIndex]!;
  if (userMessage.parts.some((part) => part.type === "file")) return messages;
  const mediaType = url.match(/^data:([^;]+);/)?.[1] ?? file.type;
  const filePart: FileUIPart = {
    type: "file",
    filename: file.name,
    mediaType,
    url,
  };
  const next = [...messages];
  next[userIndex] = { ...userMessage, parts: [...userMessage.parts, filePart] };
  return next;
}

function appendDocumentAttachment(
  messages: UIMessage[],
  file: File,
  mimeType: string,
): UIMessage[] {
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return messages;
  const userMessage = messages[userIndex]!;
  if (userMessage.parts.some((part) => part.type === "file" && part.filename === file.name)) {
    return messages;
  }
  const next = [...messages];
  next[userIndex] = {
    ...userMessage,
    parts: [
      ...userMessage.parts,
      { type: "file", filename: file.name, mediaType: mimeType, url: "" },
    ],
  };
  return next;
}

function documentMimeType(file: File): string | null {
  const extension = file.name.toLowerCase().split(".").pop();
  const mimeType =
    extension === "pdf"
      ? "application/pdf"
      : extension === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : extension === "txt"
          ? "text/plain"
          : extension === "csv"
            ? "text/csv"
            : "";
  return mimeType &&
    (mimeType === file.type || !file.type || file.type === "application/octet-stream")
    ? mimeType
    : null;
}

function WordStream({ text, animate }: { text: string; animate: boolean }) {
  const words = text.match(/\S+\s*/gu) ?? [];
  const [visibleWords, setVisibleWords] = useState<number | null>(null);
  const hasAnimated = useRef(animate);

  useEffect(() => {
    if (animate) hasAnimated.current = true;
    if (!hasAnimated.current) {
      setVisibleWords(words.length);
      return;
    }
    const current = visibleWords ?? 0;
    if (current >= words.length) {
      if (!animate) hasAnimated.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      setVisibleWords(current + 1);
      sfx.tick();
    }, 48);
    return () => window.clearTimeout(timer);
  }, [animate, text, visibleWords, words.length]);

  const visibleText =
    visibleWords === null && !hasAnimated.current
      ? text
      : words.slice(0, visibleWords ?? 0).join("");
  return <MessageResponse className="fisco-md">{visibleText}</MessageResponse>;
}

function AnimatedComposerTextarea({
  value,
  onChange,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const [placeholder, setPlaceholder] = useState(() => t(COMPOSER_HINTS[0]));

  useEffect(() => {
    if (value || busy) {
      setPlaceholder(busy ? t("Fisco is working on it…") : t("Message Fisco…"));
      return;
    }

    let hintIndex = 0;
    let characterCount = 0;
    let deleting = false;
    let timer = 0;
    const typeNext = () => {
      const hintText = t(COMPOSER_HINTS[hintIndex % COMPOSER_HINTS.length] ?? "Message Fisco…");
      characterCount += deleting ? -1 : 1;
      setPlaceholder(hintText.slice(0, characterCount));
      const hintLength = hintText.length;
      let delay = deleting ? 28 : 58;
      if (!deleting && characterCount >= hintLength) {
        deleting = true;
        delay = 1450;
      } else if (deleting && characterCount <= 0) {
        deleting = false;
        hintIndex++;
        delay = 280;
      }
      timer = window.setTimeout(typeNext, delay);
    };
    timer = window.setTimeout(typeNext, 350);
    return () => window.clearTimeout(timer);
  }, [busy, t, value]);

  return (
    <PromptInputTextarea
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder}
      className="min-h-[56px] px-4 text-base font-medium"
    />
  );
}

const SUGGESTIONS = ["Find an accountant", "How does Fisco work?", "Tax FAQ"];
const COMPOSER_HINTS = [
  "Ask about a tax question",
  "What does this receipt mean?",
  "Find the next step in Fisco",
];

function getLocalizedSuggestions(t: (message: string) => string) {
  return SUGGESTIONS.map((suggestion) => t(suggestion));
}

type ChatWindowProps = {
  threadId: string;
  initialMessages: UIMessage[];
  onOpenMenu: () => void;
};

export function ChatWindow({ threadId, initialMessages, onOpenMenu }: ChatWindowProps) {
  const t = useT();
  const localizedSuggestions = getLocalizedSuggestions(t);
  const { role, user, country, taxpayerProfile, practice, docs, accountantClientCount } =
    useStore();
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [pendingDocument, setPendingDocument] = useState<PendingDocument | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [isImageUploadPending, setIsImageUploadPending] = useState(false);
  const [imageQuota, setImageQuota] = useState<ImageQuota | null>(null);
  const [imageQuotaLoading, setImageQuotaLoading] = useState(false);
  const [documentQuota, setDocumentQuota] = useState<DocumentQuota | null>(null);
  const [documentQuotaLoading, setDocumentQuotaLoading] = useState(false);
  const [quotaClock, setQuotaClock] = useState(() => Date.now());
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">("environment");
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const isMobile = useIsMobile();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const pendingImageRef = useRef<PendingImage | null>(null);
  const imageDataUrlRef = useRef<string | null>(null);
  const imagePreviewDataUrlRef = useRef<string | null>(null);
  const documentDataUrlRef = useRef<string | null>(null);
  const pendingDocumentRef = useRef<PendingDocument | null>(null);
  const documentUploadPendingRef = useRef(false);
  const imageUploadPendingRef = useRef(false);
  const submitLockRef = useRef(false);
  const syncErrorShownRef = useRef(false);

  useEffect(() => {
    if (!user?.id) {
      setImageQuota(null);
      setImageQuotaLoading(false);
      return;
    }
    let active = true;
    setImageQuotaLoading(true);
    void fetchImageQuota().then((quota) => {
      if (!active) return;
      if (quota) setImageQuota(quota);
      setImageQuotaLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setDocumentQuota(null);
      setDocumentQuotaLoading(false);
      return;
    }
    let active = true;
    setDocumentQuotaLoading(true);
    void fetchDocumentQuota().then((quota) => {
      if (!active) return;
      if (quota) setDocumentQuota(quota);
      setDocumentQuotaLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const imageQuotaReached =
    !!imageQuota &&
    imageQuota.used >= imageQuota.limit &&
    (!imageQuota.resetAt || Date.parse(imageQuota.resetAt) > quotaClock);
  const documentQuotaReached =
    !!documentQuota &&
    documentQuota.used >= documentQuota.limit &&
    (!documentQuota.resetAt || Date.parse(documentQuota.resetAt) > quotaClock);

  useEffect(() => {
    if (!imageQuotaReached && !documentQuotaReached) return;
    const timer = window.setInterval(() => setQuotaClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [documentQuotaReached, imageQuotaReached]);

  const refreshImageQuota = () => {
    void fetchImageQuota().then((quota) => {
      if (quota) setImageQuota(quota);
    });
  };

  const refreshDocumentQuota = () => {
    void fetchDocumentQuota().then((quota) => {
      if (quota) setDocumentQuota(quota);
    });
  };

  useEffect(() => {
    if (!cameraOpen || !isMobile) return;
    let active = true;
    setCameraReady(false);

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(t("Camera access is not available in this browser."));
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: cameraFacingMode }, width: { ideal: 1920 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        const video = cameraVideoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch (error) {
        if (!active) return;
        setCameraOpen(false);
        toast.error(
          error instanceof Error && error.name === "NotAllowedError"
            ? t("Allow camera access in browser settings, or upload an image instead.")
            : t("No camera is available. Upload an image instead."),
        );
        playSfx("error");
      }
    })();

    return () => {
      active = false;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [cameraFacingMode, cameraOpen, isMobile, t]);

  const aiContext = useMemo(
    () => ({
      role: role ?? undefined,
      name: user?.name,
      country: country ?? taxpayerProfile.countryCode ?? practice.countryCode,
      taxpayerProfile:
        role === "taxpayer"
          ? {
              businessType: taxpayerProfile.businessType,
              taxResidency: taxpayerProfile.taxResidency,
              annualTurnover: taxpayerProfile.annualTurnover,
              goals: taxpayerProfile.goals,
              documentTypes: taxpayerProfile.documentTypes,
            }
          : undefined,
      practiceProfile:
        role === "accountant"
          ? {
              firm: practice.firm,
              specialties: practice.specialties,
              languages: practice.languages,
            }
          : undefined,
      documents:
        role === "taxpayer"
          ? docs.map(({ merchant, category, amount, currency, date, status }) => ({
              merchant,
              category,
              amount,
              currency,
              date,
              status,
            }))
          : undefined,
      documentCount: role === "taxpayer" ? docs.length : undefined,
      accountantClientCount: role === "accountant" ? accountantClientCount : undefined,
    }),
    [accountantClientCount, country, docs, practice, role, taxpayerProfile, user?.name],
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { context: aiContext },
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : {};
        },
        prepareSendMessagesRequest: ({ body, messages, headers }) => ({
          body: {
            ...body,
            messages,
            imageDataUrl: imageDataUrlRef.current ?? undefined,
            documentDataUrl: documentDataUrlRef.current ?? undefined,
            documentMimeType: pendingDocumentRef.current?.mimeType,
            documentFileName: pendingDocumentRef.current?.file.name,
          },
          headers,
        }),
      }),
    [aiContext],
  );

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (err) => {
      const quota = imageQuotaFromError(err);
      if (quota) {
        setImageQuota(quota);
        setImageQuotaLoading(false);
        return;
      }
      const documentQuota = documentQuotaFromError(err);
      if (documentQuota) {
        setDocumentQuota(documentQuota);
        setDocumentQuotaLoading(false);
        return;
      }
      sfx.error();
      toast.error(readableChatError(err, t));
    },
    onFinish: () => {
      sfx.receive();
      if (imageUploadPendingRef.current) {
        const imageFile = pendingImageRef.current?.file;
        const previewUrl = imagePreviewDataUrlRef.current;
        if (imageFile && previewUrl) {
          setMessages((current) => appendImagePreview(current, imageFile, previewUrl));
        }
        imageUploadPendingRef.current = false;
        imageDataUrlRef.current = null;
        imagePreviewDataUrlRef.current = null;
        pendingImageRef.current = null;
        setPendingImage(null);
        setIsImageUploadPending(false);
      }
      if (documentUploadPendingRef.current) {
        const document = pendingDocumentRef.current;
        if (document) {
          setMessages((current) =>
            appendDocumentAttachment(current, document.file, document.mimeType),
          );
        }
        documentUploadPendingRef.current = false;
        documentDataUrlRef.current = null;
        pendingDocumentRef.current = null;
        setPendingDocument(null);
      }
    },
  });

  const busy = isPreparing || status === "submitted" || status === "streaming";
  const pendingImageMessageId = isImageUploadPending
    ? [...messages].reverse().find((message) => message.role === "user")?.id
    : undefined;
  const visibleMessages = messages.filter((message) => message.id !== pendingImageMessageId);

  // Persist this thread's transcript in the browser.
  useEffect(() => {
    if (messages.length === 0) return;
    saveMessages(threadId, messages, user?.id);
  }, [messages, threadId, user?.id]);

  useEffect(() => {
    if (!user?.id || messages.length === 0 || (status !== "ready" && !error)) return;
    const thread = getThread(threadId, user.id);
    if (!thread) return;
    void syncThreadToSupabase(user.id, { ...thread, messages })
      .then((saved) => {
        if (!saved && !syncErrorShownRef.current) {
          toast.error(t("This chat is saved on this device but couldn't sync to your account."));
          syncErrorShownRef.current = true;
        } else if (saved) {
          syncErrorShownRef.current = false;
        }
      })
      .catch((error: unknown) => {
        console.warn("Could not sync Fisco AI chat.", error);
        if (!syncErrorShownRef.current) {
          toast.error(t("This chat is saved on this device but couldn't sync to your account."));
          syncErrorShownRef.current = true;
        }
      });
  }, [error, messages, status, threadId, user?.id, t]);

  useEffect(() => {
    if (status === "error") imageDataUrlRef.current = null;
    if (status === "ready" || status === "error") submitLockRef.current = false;
  }, [status]);

  useEffect(
    () => () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    },
    [pendingImage?.previewUrl],
  );

  const submit = async (text: string) => {
    const value = text.trim();
    if (
      (!value && !pendingImage && !pendingDocument) ||
      (pendingImage && (imageQuotaLoading || imageQuotaReached)) ||
      (pendingDocument && (documentQuotaLoading || documentQuotaReached)) ||
      busy ||
      submitLockRef.current
    ) {
      return;
    }
    const includesImage = !!pendingImage;
    const includesDocument = !!pendingDocument;
    submitLockRef.current = true;
    const previousMessages = messages;
    unlockAudio();
    sfx.send();
    setIsPreparing(true);
    try {
      imageDataUrlRef.current = pendingImage ? await fileToDataUrl(pendingImage.file) : null;
      imagePreviewDataUrlRef.current = pendingImage
        ? await createImagePreviewDataUrl(pendingImage.file)
        : null;
      documentDataUrlRef.current = pendingDocument
        ? await fileToDataUrl(pendingDocument.file)
        : null;
      if (pendingImage) {
        imageUploadPendingRef.current = true;
        setIsImageUploadPending(true);
      }
      if (pendingDocument) documentUploadPendingRef.current = true;
      const request = sendMessage({
        text:
          value ||
          (pendingImage
            ? "Please analyze this image for tax or accounting relevance."
            : "Please analyze this document for tax or accounting relevance."),
      });
      setInput("");
      setIsPreparing(false);
      sfx.thinking();
      void request
        .then(() => {
          if (includesImage) refreshImageQuota();
        })
        .catch((sendError: unknown) => {
          submitLockRef.current = false;
          imageDataUrlRef.current = null;
          imagePreviewDataUrlRef.current = null;
          if (includesImage) refreshImageQuota();
          if (includesDocument) refreshDocumentQuota();
          if (imageUploadPendingRef.current) {
            imageUploadPendingRef.current = false;
            setIsImageUploadPending(false);
            setMessages(previousMessages);
            setInput(value);
          }
          if (documentUploadPendingRef.current) {
            documentUploadPendingRef.current = false;
            documentDataUrlRef.current = null;
            pendingDocumentRef.current = null;
            setPendingDocument(null);
            setMessages(previousMessages);
            setInput(value);
          }
          const quotaError = sendError instanceof Error ? imageQuotaFromError(sendError) : null;
          const documentError =
            sendError instanceof Error ? documentQuotaFromError(sendError) : null;
          if (quotaError) {
            setImageQuota(quotaError);
            setImageQuotaLoading(false);
          } else if (documentError) {
            setDocumentQuota(documentError);
            setDocumentQuotaLoading(false);
          } else {
            toast.error(
              sendError instanceof Error
                ? t(sendError.message)
                : t("Fisco could not answer right now."),
            );
          }
        });
    } catch (submitError) {
      submitLockRef.current = false;
      setIsPreparing(false);
      imageDataUrlRef.current = null;
      imagePreviewDataUrlRef.current = null;
      documentDataUrlRef.current = null;
      documentUploadPendingRef.current = false;
      toast.error(
        submitError instanceof Error
          ? t(submitError.message)
          : t("The attachment could not be prepared."),
      );
    }
  };

  const selectImage = (file: File | undefined) => {
    if (!file || imageQuotaLoading || imageQuotaReached) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
      toast.error(t("Choose a JPEG, PNG, or WebP image."));
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error(t("Images must be 6 MB or smaller."));
      return;
    }
    const next = { file, previewUrl: URL.createObjectURL(file) };
    pendingDocumentRef.current = null;
    setPendingDocument(null);
    pendingImageRef.current = next;
    setPendingImage(next);
  };

  const selectDocument = (file: File | undefined) => {
    if (!file || documentQuotaLoading || documentQuotaReached) return;
    const mimeType = documentMimeType(file);
    if (!mimeType) {
      toast.error(t("Choose a PDF, DOCX, TXT, or CSV document."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t("Documents must be 8 MB or smaller."));
      return;
    }
    pendingImageRef.current = null;
    setPendingImage(null);
    pendingDocumentRef.current = { file, mimeType };
    setPendingDocument({ file, mimeType });
  };

  const openCamera = () => {
    if (!isMobile) return;
    playSfx("open");
    setCameraOpen(true);
  };

  const captureCameraImage = () => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error(t("The photo couldn’t be captured. Try again."));
          playSfx("error");
          return;
        }
        const file = new File([blob], `fisco-photo-${Date.now()}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        playSfx("shutter");
        selectImage(file);
        setCameraOpen(false);
      },
      "image/jpeg",
      0.92,
    );
  };

  // ---- Voice messages ----
  const [voice, setVoice] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<Awaited<ReturnType<typeof recordWav>> | null>(null);

  useEffect(() => {
    if (voice !== "recording") return;
    setSeconds(0);
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [voice]);

  useEffect(() => () => recRef.current?.cancel(), []);

  const startVoice = async () => {
    if (busy || voice !== "idle") return;
    unlockAudio();
    try {
      recRef.current = await recordWav();
      sfx.click();
      setVoice("recording");
    } catch {
      sfx.error();
      toast.error(t("Microphone access is needed for voice messages."));
    }
  };

  const cancelVoice = () => {
    recRef.current?.cancel();
    recRef.current = null;
    setVoice("idle");
    sfx.delete();
  };

  const finishVoice = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setVoice("transcribing");
    try {
      const file = await rec.stop();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string | { message?: string };
      };
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(t(msg || "Couldn't understand that recording."));
      }
      const text = (data.text ?? "").trim();
      if (!text) throw new Error(t("I couldn't hear anything — try again."));
      setVoice("idle");
      setInput((current) => (current.trim() ? `${current.trim()}\n${text}` : text));
    } catch (e) {
      setVoice("idle");
      sfx.error();
      toast.error(t(e instanceof Error ? e.message : "Voice message failed."));
    }
  };

  const empty = messages.length === 0;
  const lastId = messages[messages.length - 1]?.id;

  return (
    <section className="glass relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl animate-ps-in">
      <header className="flex items-center gap-3 border-b border-glass-border px-4 py-3 sm:px-6">
        <button
          onClick={() => {
            playSfx("tap");
            onOpenMenu();
          }}
          aria-label={t("Open conversations")}
          className="rounded-full p-2 text-muted-foreground transition-smooth hover:bg-glass-strong hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" />
        </button>
        {!empty && (
          <div className="animate-ps-in">
            <FiscoOrb size={34} state={busy ? "thinking" : "idle"} />
          </div>
        )}
        <div className="flex-1">
          <p className="font-display text-base font-extrabold uppercase tracking-[0.14em]">Fisco</p>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${busy ? "bg-primary animate-breathe" : "bg-aurora-2"}`}
            />
            {status === "submitted"
              ? t("thinking…")
              : status === "streaming"
                ? t("typing…")
                : t("online · ready when you are")}
          </p>
        </div>
      </header>

      {empty && (
        <div className="fisco-empty-state flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto overscroll-contain px-6 pb-8 pt-8 text-center sm:pb-10 sm:pt-10">
          <div className="animate-ps-in drop-shadow-[0_0_30px_rgba(255,140,70,0.4)]">
            <FiscoOrb size={112} state="idle" priority />
          </div>
          <h2 className="relative overflow-hidden font-display text-[clamp(3.2rem,8vw,7rem)] font-extrabold leading-[0.9] tracking-[-0.06em] text-foreground animate-ps-in [animation-delay:150ms]">
            {t("Hey, I'm")} <span className="text-gradient">Fisco.</span>
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-foreground/15 blur-md animate-ps-sweep" />
          </h2>
          <div className="flex flex-wrap justify-center gap-2.5">
            {localizedSuggestions.map((s, i) => (
              <button
                key={`${s}-${i}`}
                onClick={() => submit(s)}
                onMouseEnter={() => sfx.hover()}
                style={{ animationDelay: `${320 + i * 90}ms` }}
                className="animate-ps-in rounded-full border border-glass-border bg-glass/70 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] backdrop-blur-md transition-smooth hover:-translate-y-0.5 hover:border-primary/50 hover:text-foreground hover:glow"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <Conversation className={empty ? "hidden" : "min-h-0 flex-1"}>
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
          {visibleMessages.map((message) => (
            <div key={message.id} className="group/msg relative animate-ps-in">
              <Message from={message.role}>
                <MessageContent
                  className={
                    message.role === "assistant" && message.id === lastId && status === "streaming"
                      ? "typing-caret"
                      : undefined
                  }
                >
                  {message.parts.map((part, index) => {
                    if (part.type === "reasoning") {
                      return (
                        <Reasoning
                          key={index}
                          className="w-full"
                          isStreaming={status === "streaming"}
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }
                    if (part.type === "text") {
                      return (
                        <WordStream
                          key={index}
                          text={part.text}
                          animate={
                            message.role === "assistant" &&
                            message.id === lastId &&
                            (status === "submitted" || status === "streaming")
                          }
                        />
                      );
                    }
                    if (part.type === "file" && part.mediaType.startsWith("image/")) {
                      const fileName = part.filename || t("Attached image");
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            playSfx("open");
                            setImagePreview({ src: part.url, fileName });
                          }}
                          aria-label={t("Preview attached image")}
                          className="block max-w-[min(20rem,70vw)] overflow-hidden rounded-xl border border-glass-border"
                        >
                          <img
                            src={part.url}
                            alt={fileName}
                            className="max-h-64 w-full object-contain"
                          />
                          <span className="block truncate px-2 py-1 text-xs text-muted-foreground">
                            {fileName}
                          </span>
                        </button>
                      );
                    }
                    if (part.type === "file") {
                      return (
                        <div
                          key={index}
                          className="flex w-fit max-w-[min(24rem,80vw)] items-center gap-3 rounded-xl border border-glass-border bg-glass/70 px-3 py-2"
                        >
                          <FileText className="size-5 shrink-0 text-primary" aria-hidden="true" />
                          <span className="truncate text-sm font-medium text-foreground">
                            {part.filename || t("Attached document")}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            </div>
          ))}

          {status === "submitted" && (
            <div className="flex w-fit items-center gap-3 rounded-full border border-glass-border bg-glass px-3 py-2 pr-4 backdrop-blur-xl animate-ps-in">
              <FiscoOrb size={34} state="thinking" />
              <Shimmer className="font-display text-sm font-bold uppercase tracking-[0.2em]">
                {t("Thinking")}
              </Shimmer>
              <span className="flex items-end gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="h-3 w-0.5 origin-bottom rounded-full bg-brand-gradient animate-bar"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </span>
            </div>
          )}

          {error && !imageQuotaFromError(error) && !documentQuotaFromError(error) && (
            <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
              {t(
                readableChatError(error, t) ||
                  "Something interrupted the connection. Try sending again.",
              )}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="p-3 sm:p-4">
        {imageQuotaReached && imageQuota?.resetAt && (
          <div
            role="status"
            aria-live="polite"
            className="glass-strong mx-auto mb-3 flex w-full max-w-3xl items-start gap-3 rounded-2xl border border-primary/30 px-4 py-3 text-foreground shadow-[0_12px_36px_rgba(19,32,28,0.12)] backdrop-blur-2xl animate-ps-in"
          >
            <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("Image upload limit reached")}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("You've used your two image uploads.")} {t("You can upload again in")}{" "}
                <span dir="ltr" className="font-semibold tabular-nums text-foreground">
                  {formatQuotaRemaining(imageQuota.resetAt, quotaClock)}
                </span>{" "}
                {t("at")}{" "}
                <span dir="ltr" className="font-semibold tabular-nums text-foreground">
                  {new Date(imageQuota.resetAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                .
              </p>
            </div>
          </div>
        )}
        {documentQuotaReached && documentQuota?.resetAt && (
          <div
            role="status"
            aria-live="polite"
            className="glass-strong mx-auto mb-3 flex w-full max-w-3xl items-start gap-3 rounded-2xl border border-primary/30 px-4 py-3 text-foreground shadow-[0_12px_36px_rgba(19,32,28,0.12)] backdrop-blur-2xl animate-ps-in"
          >
            <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("Document upload limit reached")}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("You've used your two document uploads.")} {t("You can upload again in")}{" "}
                <span dir="ltr" className="font-semibold tabular-nums text-foreground">
                  {formatQuotaRemaining(documentQuota.resetAt, quotaClock)}
                </span>
                .
              </p>
            </div>
          </div>
        )}
        {voice !== "idle" ? (
          <div className="glass-strong mx-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl px-3 py-2.5 animate-ps-in">
            <button
              type="button"
              onClick={cancelVoice}
              disabled={voice === "transcribing"}
              aria-label={t("Cancel recording")}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-smooth hover:bg-glass hover:text-foreground disabled:opacity-40"
            >
              <X className="size-5" />
            </button>
            <span className="relative flex size-2.5">
              <span className="absolute inset-0 rounded-full bg-primary animate-pulse-ring" />
              <span className="relative size-2.5 rounded-full bg-primary" />
            </span>
            <span className="font-display text-sm font-bold tabular-nums">
              {voice === "transcribing"
                ? t("Transcribing…")
                : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
            </span>
            <div className="flex h-8 flex-1 items-center justify-center gap-[3px] overflow-hidden">
              {Array.from({ length: 36 }).map((_, i) => (
                <span
                  key={i}
                  className="h-full w-[3px] origin-center rounded-full bg-brand-gradient animate-rec-bar"
                  style={{
                    animationDelay: `${(i * 67) % 800}ms`,
                    animationPlayState: voice === "recording" ? "running" : "paused",
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => void finishVoice()}
              disabled={voice === "transcribing"}
              aria-label={t("Transcribe voice message")}
              className="flex size-10 items-center justify-center rounded-full bg-brand-gradient text-primary-foreground transition-smooth hover:scale-105"
            >
              {voice === "transcribing" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Square className="size-4 fill-current" />
              )}
            </button>
          </div>
        ) : (
          <>
            {pendingImage && (
              <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-xl border border-glass-border bg-glass/80 p-2">
                <button
                  type="button"
                  onClick={() => {
                    playSfx("open");
                    setImagePreview({
                      src: pendingImage.previewUrl,
                      fileName: pendingImage.file.name,
                    });
                  }}
                  aria-label={t("Preview attached image")}
                  title={t("Preview attached image")}
                  className="size-14 shrink-0 overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <img
                    src={pendingImage.previewUrl}
                    alt={t("Image ready to send")}
                    className="size-full object-cover"
                  />
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {pendingImage.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={imageQuotaLoading || imageQuotaReached}
                  aria-label={t("Change attached image")}
                  title={t("Change attached image")}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-glass-strong hover:text-foreground"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pendingImageRef.current = null;
                    setPendingImage(null);
                  }}
                  aria-label={t("Remove attached image")}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-glass-strong hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
            {pendingDocument && (
              <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-xl border border-glass-border bg-glass/80 p-2">
                <FileText className="ml-2 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {pendingDocument.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => documentInputRef.current?.click()}
                  disabled={documentQuotaLoading || documentQuotaReached}
                  aria-label={t("Change attached document")}
                  title={t("Change attached document")}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-glass-strong hover:text-foreground"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pendingDocumentRef.current = null;
                    setPendingDocument(null);
                  }}
                  aria-label={t("Remove attached document")}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-glass-strong hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={imageQuotaLoading || imageQuotaReached}
              className="hidden"
              tabIndex={-1}
              onChange={(event) => {
                selectImage(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={documentInputRef}
              type="file"
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,.pdf,.docx,.txt,.csv"
              disabled={documentQuotaLoading || documentQuotaReached}
              className="hidden"
              tabIndex={-1}
              onChange={(event) => {
                selectDocument(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <PromptInput
              className="fisco-composer mx-auto w-full max-w-3xl [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:border-glass-border [&_[data-slot=input-group]]:bg-glass-strong [&_[data-slot=input-group]]:backdrop-blur-2xl [&_[data-slot=input-group]]:transition-smooth [&_[data-slot=input-group]:focus-within]:border-primary/60 [&_[data-slot=input-group]:focus-within]:glow"
              onSubmit={(_message, event) => {
                event.preventDefault();
                void submit(input);
              }}
            >
              <AnimatedComposerTextarea value={input} onChange={setInput} busy={busy} />
              <PromptInputFooter className="justify-between px-2 pb-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        ((imageQuotaLoading || imageQuotaReached) &&
                          (documentQuotaLoading || documentQuotaReached))
                      }
                      aria-label={t("Add an attachment")}
                      title={t("Add an attachment")}
                      onClick={() => playSfx("tap")}
                      className="grid size-9 place-items-center rounded-full text-muted-foreground transition-smooth hover:bg-glass hover:text-primary disabled:opacity-40"
                    >
                      <Plus className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    sideOffset={10}
                    className="w-56 rounded-2xl border-glass-border bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl"
                  >
                    <DropdownMenuItem
                      disabled={imageQuotaLoading || imageQuotaReached}
                      onSelect={() => {
                        playSfx("select");
                        imageInputRef.current?.click();
                      }}
                      className="min-h-11 rounded-xl px-3 text-sm font-semibold focus:bg-primary/10"
                    >
                      <ImagePlus className="size-4 text-primary" />
                      {t("Upload an image")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={documentQuotaLoading || documentQuotaReached}
                      onSelect={() => {
                        playSfx("select");
                        documentInputRef.current?.click();
                      }}
                      className="min-h-11 rounded-xl px-3 text-sm font-semibold focus:bg-primary/10"
                    >
                      <FileText className="size-4 text-primary" />
                      {t("Upload a document")}
                    </DropdownMenuItem>
                    {isMobile && (
                      <DropdownMenuItem
                        disabled={imageQuotaLoading || imageQuotaReached}
                        onSelect={openCamera}
                        className="min-h-11 rounded-xl px-3 text-sm font-semibold focus:bg-primary/10"
                      >
                        <Camera className="size-4 text-primary" />
                        {t("Take a photo")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  onClick={() => void startVoice()}
                  onMouseEnter={() => sfx.hover()}
                  disabled={busy}
                  aria-label={t("Record a voice message")}
                  className="mr-auto flex size-9 items-center justify-center rounded-full text-muted-foreground transition-smooth hover:bg-glass hover:text-primary disabled:opacity-40 sm:mr-0 sm:ml-auto"
                >
                  <Mic className="size-5" />
                </button>
                <PromptInputSubmit
                  status={status}
                  onStop={stop}
                  disabled={
                    !busy &&
                    (pendingImage
                      ? imageQuotaLoading || imageQuotaReached
                      : pendingDocument
                        ? documentQuotaLoading || documentQuotaReached
                        : input.trim().length === 0)
                  }
                  className="size-9 rounded-full bg-brand-gradient text-primary-foreground transition-smooth hover:scale-105"
                >
                  {busy ? (
                    <span className="relative grid size-5 place-items-center" aria-hidden="true">
                      <Loader2 className="absolute size-6 animate-spin opacity-75" />
                      {status === "streaming" ? (
                        <Square className="size-2.5 fill-current" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-current" />
                      )}
                    </span>
                  ) : (
                    <CornerDownLeft className="size-4" />
                  )}
                </PromptInputSubmit>
              </PromptInputFooter>
            </PromptInput>
            <Dialog
              open={cameraOpen && isMobile}
              onOpenChange={(open) => {
                if (!open) playSfx("close");
                setCameraOpen(open);
              }}
            >
              <DialogContent className="fixed inset-0 left-0 top-0 z-[100] flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none [&>button:last-child]:hidden">
                <DialogTitle className="sr-only">{t("Camera")}</DialogTitle>
                <DialogDescription className="sr-only">
                  {t("Take a photo to attach it to your Fisco AI message.")}
                </DialogDescription>
                <video
                  ref={cameraVideoRef}
                  playsInline
                  muted
                  autoPlay
                  className="absolute inset-0 size-full object-cover"
                />
                {!cameraReady && (
                  <div className="absolute inset-0 grid place-items-center bg-black/20">
                    <Loader2 className="size-7 animate-spin text-white/80" />
                  </div>
                )}
                <DialogClose asChild>
                  <button
                    type="button"
                    aria-label={t("Return to chat")}
                    className="absolute left-4 top-[max(env(safe-area-inset-top),1rem)] z-10 grid size-12 place-items-center rounded-full border border-white/25 bg-black/25 text-white shadow-lg backdrop-blur-xl transition hover:bg-white/20"
                  >
                    <ArrowLeft className="size-5" />
                  </button>
                </DialogClose>
                <button
                  type="button"
                  onClick={() =>
                    setCameraFacingMode((current) =>
                      current === "environment" ? "user" : "environment",
                    )
                  }
                  disabled={!cameraReady}
                  aria-label={t(
                    cameraFacingMode === "environment" ? "Use front camera" : "Use rear camera",
                  )}
                  title={t(
                    cameraFacingMode === "environment" ? "Use front camera" : "Use rear camera",
                  )}
                  className="absolute right-4 top-[max(env(safe-area-inset-top),1rem)] z-10 grid size-12 place-items-center rounded-full border border-white/25 bg-black/25 text-white shadow-lg backdrop-blur-xl transition hover:bg-white/20 disabled:opacity-50"
                >
                  <SwitchCamera className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={captureCameraImage}
                  disabled={!cameraReady}
                  aria-label={t("Take photo")}
                  className="absolute bottom-[max(env(safe-area-inset-bottom),1.5rem)] left-1/2 z-10 grid size-[4.5rem] -translate-x-1/2 place-items-center rounded-full border border-white/40 bg-white/20 text-white shadow-xl backdrop-blur-xl transition enabled:hover:scale-105 disabled:opacity-50"
                >
                  <Camera className="size-6" />
                </button>
              </DialogContent>
            </Dialog>
            <Dialog
              open={!!imagePreview}
              onOpenChange={(open) => {
                if (!open) {
                  playSfx("close");
                  setImagePreview(null);
                }
              }}
            >
              <DialogContent className="max-w-3xl border-glass-border bg-card/95 p-3 sm:p-4">
                <DialogTitle className="truncate pr-8 text-sm font-semibold">
                  {imagePreview?.fileName ?? t("Attached image")}
                </DialogTitle>
                {imagePreview && (
                  <img
                    src={imagePreview.src}
                    alt={imagePreview.fileName}
                    className="max-h-[75dvh] w-full rounded-lg object-contain"
                  />
                )}
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </section>
  );
}
