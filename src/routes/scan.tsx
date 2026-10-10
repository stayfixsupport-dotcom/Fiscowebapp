import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "motion/react";
import {
  Camera,
  Check,
  FileText,
  ImagePlus,
  RefreshCw,
  Sparkles,
  SwitchCamera,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { BlurFade } from "@/components/motion/BlurFade";
import { Btn, Card, Label, Meter } from "@/components/kit";
import type { DocCategory } from "@/lib/data";
import { readDocument, type ExtractedDoc } from "@/lib/scan.functions";
import { useStore } from "@/lib/app-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { sfx } from "@/lib/sfx";
import { uploadToGoogleDrive } from "@/lib/drive";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode } from "@/lib/i18n";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "Scan and read a document with AI" },
      {
        name: "description",
        content:
          "Capture an invoice with your camera or upload a file — AI reads the merchant, totals, tax number and line items.",
      },
      { property: "og:title", content: "Scan and read a document with AI" },
      {
        property: "og:description",
        content: "Capture or upload an invoice and get the real fields read back.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Scan,
});

type Phase = "live" | "reading" | "done" | "error";
const STEPS = ["Preparing the page", "Reading the text", "Structuring the fields"] as const;
const EASE = [0.16, 1, 0.3, 1] as const;

const CATEGORIES: DocCategory[] = [
  "Invoice",
  "Receipt",
  "Payroll",
  "Tax form",
  "Contract",
  "Utilities",
  "Transport",
  "Supplies",
  "Services",
  "Other",
];
const toDocCategory = (value: string): DocCategory => {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const exact = CATEGORIES.find((category) => category.toLowerCase() === normalized);
  if (exact) return exact;
  if (/payroll|salary|wage/.test(normalized)) return "Payroll";
  if (/receipt|proof of payment/.test(normalized)) return "Receipt";
  if (/tax form|tax return|tax statement|tax document/.test(normalized)) return "Tax form";
  if (/contract|agreement/.test(normalized)) return "Contract";
  if (/utilit|electricity|water bill|gas bill/.test(normalized)) return "Utilities";
  if (/transport|travel|fuel|taxi/.test(normalized)) return "Transport";
  if (/suppl|stationery/.test(normalized)) return "Supplies";
  if (/service|consultancy|professional fee/.test(normalized)) return "Services";
  if (/invoice|bill/.test(normalized)) return "Invoice";
  return "Other";
};

const money = (n: number, currency: string) =>
  `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function Scan() {
  const navigate = useNavigate();
  const { addDoc, user, role } = useStore();
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale = localeCode(preferences.language);
  const read = useServerFn(readDocument);
  // Live capture is a phone gesture: on desktop we only accept uploads.
  const isMobile = useIsMobile();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);

  const [phase, setPhase] = useState<Phase>("live");
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [step, setStep] = useState(0);
  const [shot, setShot] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedDoc | null>(null);
  const [sourceDataUrl, setSourceDataUrl] = useState<string | null>(null);
  const [sourceFilename, setSourceFilename] = useState("document");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- real camera stream ---- */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(
    async (facing: "environment" | "user" = "environment") => {
      setDenied(null);
      setReady(false);
      setFlashSupported(false);
      setFlashOn(false);
      stopCamera();
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera not available on this device");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 } },
          audio: false,
        });
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track as MediaStreamTrack & {
          getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
        };
        setFlashSupported(capabilities.getCapabilities?.().torch === true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e) {
        setReady(false);
        setDenied(
          e instanceof Error && e.name === "NotAllowedError"
            ? t("Camera permission denied. Allow access or pick a photo instead.")
            : t("No camera available. Pick a photo from your library instead."),
        );
      }
    },
    [stopCamera, t],
  );

  useEffect(() => {
    const timersOnMount = timers.current;
    if (isMobile) void startCamera();
    return () => {
      stopCamera();
      timersOnMount.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isMobile, startCamera, stopCamera]);

  const switchCamera = async () => {
    const nextFacing = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(nextFacing);
    await startCamera(nextFacing);
  };

  const toggleFlash = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !flashSupported) return;
    const nextFlashOn = !flashOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: nextFlashOn }] } as MediaTrackConstraints);
      setFlashOn(nextFlashOn);
    } catch {
      setFlashSupported(false);
      setFlashOn(false);
    }
  };

  /* ---- real reading: the file is sent to the AI reader ---- */
  const analyse = useCallback(
    async (payload: { dataUrl?: string; text?: string }, filename?: string) => {
      if (payload.dataUrl) setSourceDataUrl(payload.dataUrl);
      if (filename) setSourceFilename(filename);
      timers.current.forEach((t) => window.clearTimeout(t));
      setPhase("reading");
      setError(null);
      setResult(null);
      setStep(0);
      sfx("whoosh");
      timers.current.push(window.setTimeout(() => setStep(1), 700));
      timers.current.push(window.setTimeout(() => setStep(2), 2200));
      try {
        const out = await read({
          data: { ...payload, locale, ...(filename ? { filename } : {}) },
        });
        setStep(2);
        setResult(out);
        setPhase("done");
        sfx("success");
      } catch (e) {
        setPhase("error");
        setError(e instanceof Error ? t(e.message) : t("Could not read this document."));
        sfx("error");
      } finally {
        timers.current.forEach((t) => window.clearTimeout(t));
      }
    },
    [read, locale, t],
  );

  /* ---- capture the current frame off the live video ---- */
  const capture = () => {
    sfx("shutter");
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const url = canvas.toDataURL("image/jpeg", 0.9);
      setShot(url);
      setPdfName(null);
      stopCamera();
      void analyse({ dataUrl: url }, "capture.jpg");
    }
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    sfx("shutter");

    const isDocx =
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.docx?$/i.test(file.name);

    if (isDocx) {
      setShot(null);
      setPdfName(file.name);
      stopCamera();
      void (async () => {
        try {
          const buffer = await file.arrayBuffer();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const sourceReader = new FileReader();
            sourceReader.onload = () =>
              typeof sourceReader.result === "string"
                ? resolve(sourceReader.result)
                : reject(new Error("Could not prepare this file for storage."));
            sourceReader.onerror = () =>
              reject(new Error("Could not prepare this file for storage."));
            sourceReader.readAsDataURL(file);
          });
          setSourceDataUrl(dataUrl);
          setSourceFilename(file.name);
          const mammoth = await import("mammoth/mammoth.browser");
          const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
          const text = (value ?? "").trim();
          if (!text) throw new Error("This document has no readable text.");
          await analyse({ text }, file.name);
        } catch {
          setPhase("error");
          setError(t("Could not read this Word document."));
          sfx("close");
        }
      })();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : null;
      if (!url) return;
      const isPdf = file.type === "application/pdf";
      setShot(isPdf ? null : url);
      setPdfName(isPdf ? file.name : null);
      stopCamera();
      void analyse({ dataUrl: url }, file.name);
    };
    reader.readAsDataURL(file);
  };

  const retake = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    sfx("close");
    setShot(null);
    setPdfName(null);
    setResult(null);
    setSourceDataUrl(null);
    setSourceFilename("document");
    setError(null);
    setPhase("live");
    setStep(0);
    if (isMobile) void startCamera(cameraFacing);
  };

  const save = async () => {
    if (!result) return;
    if (!user?.id || !role) {
      setError(t("Sign in before saving a document to your account."));
      return;
    }
    sfx("confirm");
    setSaving(true);
    setError(null);
    let driveMetadata: { driveFileId?: string; previewUrl?: string; embedUrl?: string } = {};
    if (sourceDataUrl) {
      const mimeType = /^data:([^;]+)/.exec(sourceDataUrl)?.[1] ?? "application/octet-stream";
      const upload = await uploadToGoogleDrive(sourceFilename, sourceDataUrl, mimeType);
      if (!upload.success || !upload.fileId) {
        setSaving(false);
        setError(
          "The file could not be saved to Google Drive. Check your connection and try again.",
        );
        sfx("error");
        return;
      }
      driveMetadata = {
        driveFileId: upload.fileId,
        previewUrl:
          upload.previewUrl ??
          upload.driveViewUrl ??
          `https://drive.google.com/file/d/${upload.fileId}/view`,
        embedUrl: upload.embedUrl ?? `https://drive.google.com/file/d/${upload.fileId}/preview`,
      };
    }
    const saved = await addDoc(
      {
        id: `d${Date.now()}`,
        merchant: result.merchant,
        amount: result.amount,
        currency: result.currency,
        date: result.date,
        category: toDocCategory(result.category),
        status: "pending",
        pages: result.pages,
        tint: "from-[#EAF7EE] to-[#D8EEDF]",
        aiDetails: {
          taxId: result.taxId,
          vat: result.vat,
          invoiceNumber: result.invoiceNumber,
          lineItems: result.lineItems,
          summary: result.summary,
          confidence: result.confidence,
          raw: result.raw,
        },
        ...driveMetadata,
      },
      /^data:([^;]+)/.exec(sourceDataUrl ?? "")?.[1] ?? "application/octet-stream",
    );
    setSaving(false);
    if (!saved) {
      setError(
        "The file reached Google Drive, but its document record could not be saved. Please retry.",
      );
      sfx("error");
      return;
    }
    navigate({ to: "/documents" });
  };

  return (
    <div
      className={
        isMobile
          ? "fisco-scan-page fixed inset-0 z-[60] flex h-[100dvh] w-full flex-col overflow-hidden bg-black"
          : "mx-auto w-full max-w-[640px] px-3.5 pt-3 pb-36"
      }
    >
      <BlurFade
        className={
          isMobile
            ? "absolute inset-x-4 z-20 flex items-center justify-between px-1 text-white"
            : "flex items-center justify-between px-1"
        }
        style={
          isMobile
            ? { top: "calc(var(--fisco-native-safe-top, env(safe-area-inset-top, 0px)) + 12px)" }
            : undefined
        }
      >
        <div>
          <Label>{t(isMobile ? "Scanner" : "Document reader")}</Label>
          <h1 className="mt-0.5 text-[23px] leading-none font-extrabold">
            {t(isMobile ? "Capture" : "Analyze")}
          </h1>
        </div>
        <button
          onClick={() => {
            sfx("close");
            navigate({ to: "/" });
          }}
          aria-label={t("Close scanner")}
          className={`press grid size-10 place-items-center rounded-full ${
            isMobile ? "bg-black/35 text-white backdrop-blur-md" : "bg-secondary"
          }`}
        >
          <X className="size-4" />
        </button>
      </BlurFade>

      <BlurFade delay={0.06} className={isMobile ? "flex min-h-0 flex-1" : "mt-3"}>
        <Card
          tone="ink"
          className={`relative flex min-h-0 flex-1 flex-col overflow-hidden p-0 ${
            isMobile ? "rounded-none border-0 shadow-none" : ""
          }`}
        >
          <div
            className={
              isMobile
                ? "relative min-h-0 flex-1 w-full bg-black"
                : "relative aspect-[3/4] w-full bg-black sm:aspect-[4/3]"
            }
          >
            {/* live camera — mobile only */}
            {isMobile && (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${
                  shot ? "opacity-0" : "opacity-100"
                }`}
              />
            )}

            {/* desktop: upload only */}
            {!isMobile && !shot && !pdfName && (
              <label
                onPointerEnter={() => sfx("hover")}
                className="absolute inset-6 grid cursor-pointer place-items-center rounded-3xl border-2 border-dashed border-ink-foreground/20 p-6 text-center transition-colors hover:border-primary/60"
              >
                <div>
                  <motion.span
                    aria-hidden
                    className="mx-auto grid size-14 place-items-center rounded-2xl bg-ink-foreground/10 text-ink-foreground"
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <ImagePlus className="size-6" />
                  </motion.span>
                  <p className="mt-4 text-[16px] font-extrabold text-ink-foreground">
                    {t("Upload a document to analyze")}
                  </p>
                  <p className="mx-auto mt-1.5 max-w-[320px] text-[12.5px] font-semibold text-ink-foreground/55">
                    {t(
                      "Camera capture is mobile-only. Drop a PDF or an image here and the reader extracts the real fields from it.",
                    )}
                  </p>
                  <span className="press mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[12.5px] font-bold text-primary-foreground">
                    {t("Choose a file")}
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
              </label>
            )}
            <canvas ref={canvasRef} className="hidden" />

            {/* pdf placeholder */}
            {pdfName && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <FileText className="mx-auto size-10 text-primary" />
                  <p className="mt-3 truncate text-[14px] font-extrabold text-ink-foreground">
                    {pdfName}
                  </p>
                </div>
              </div>
            )}

            {/* frozen frame */}
            <AnimatePresence>
              {shot && (
                <motion.img
                  key="shot"
                  src={shot}
                  alt={t("Captured document")}
                  initial={{ opacity: 0, scale: 1.05, filter: "blur(12px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  transition={{ duration: 0.6, ease: EASE }}
                  className="absolute inset-0 size-full object-cover"
                />
              )}
            </AnimatePresence>

            {/* permission fallback */}
            {isMobile && denied && !shot && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <Camera className="mx-auto size-6 text-ink-foreground/60" />
                  <p className="mt-3 text-[13px] font-semibold text-ink-foreground/70">
                    {t(denied)}
                  </p>
                  <button
                    onClick={() => void startCamera()}
                    className="press mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground"
                  >
                    <RefreshCw className="size-3.5" /> {t("Try again")}
                  </button>
                </div>
              </div>
            )}

            {/* corner brackets, breathing while live */}
            {(isMobile || shot) &&
              [
                "left-5 top-5 border-l-2 border-t-2",
                "right-5 top-5 border-r-2 border-t-2",
                "left-5 bottom-5 border-b-2 border-l-2",
                "right-5 bottom-5 border-b-2 border-r-2",
              ].map((c, i) => (
                <motion.span
                  key={c}
                  animate={{ opacity: phase === "live" ? [0.45, 1, 0.45] : 1 }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.1 }}
                  className={`absolute size-9 rounded-[10px] border-primary ${c}`}
                />
              ))}

            {/* sweeping laser during analysis */}
            <AnimatePresence>
              {phase === "reading" && (
                <>
                  <motion.div
                    initial={{ top: "6%", opacity: 0 }}
                    animate={{ top: ["6%", "90%", "6%"], opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-x-5 h-16 -translate-y-1/2 rounded-full bg-gradient-to-b from-transparent via-primary/50 to-transparent blur-[2px]"
                  />
                  <motion.div
                    className="absolute inset-0"
                    animate={{ opacity: [0.15, 0.35, 0.15] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    style={{
                      background:
                        "repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 4px)",
                    }}
                  />
                </>
              )}
            </AnimatePresence>

            {/* success ring */}
            <AnimatePresence>
              {phase === "done" && (
                <motion.div
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="absolute inset-x-0 bottom-5 mx-auto grid size-16 place-items-center rounded-full bg-primary text-primary-foreground"
                >
                  <Check className="size-7" strokeWidth={3} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* live status pill */}
            {phase === "live" && (
              <div
                className={`glass-ink absolute left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-[11px] font-bold ${
                  isMobile ? "top-[calc(env(safe-area-inset-top)+4.5rem)]" : "top-4"
                }`}
                style={
                  isMobile
                    ? {
                        top: "calc(var(--fisco-native-safe-top, env(safe-area-inset-top, 0px)) + 4.5rem)",
                      }
                    : undefined
                }
              >
                {!isMobile
                  ? t("Upload a file to analyze")
                  : ready
                    ? t("Align the document")
                    : denied
                      ? t("Camera off")
                      : t("Starting camera…")}
              </div>
            )}
          </div>

          {/* ---- controls / results ---- */}
          <div
            className={
              isMobile
                ? "absolute inset-x-0 bottom-0 z-10 max-h-[70dvh] overflow-y-auto bg-gradient-to-t from-black/90 via-black/65 to-transparent px-5 pt-12 text-white"
                : "border-t border-ink-foreground/10 p-4"
            }
            style={
              isMobile
                ? {
                    paddingBottom:
                      "calc(var(--fisco-native-safe-bottom, env(safe-area-inset-bottom, 0px)) + 20px)",
                  }
                : undefined
            }
          >
            <AnimatePresence mode="wait">
              {phase === "reading" ? (
                <motion.div
                  key="steps"
                  initial={{ opacity: 0, filter: "blur(8px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(8px)" }}
                  className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3"
                >
                  <motion.img
                    src="/assets/illustrations/file-text-3d.webp"
                    alt=""
                    aria-hidden="true"
                    animate={{ y: [0, -4, 0], rotate: [0, -3, 0] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                    className="size-11 object-contain"
                  />
                  <div className="grid gap-2">
                    {STEPS.map((s, i) => (
                      <div key={s} className="flex items-center gap-2 text-[13px] font-semibold">
                        <span
                          className={`grid size-5 place-items-center rounded-full text-[10px] ${
                            i <= step
                              ? "bg-primary text-primary-foreground"
                              : "bg-ink-foreground/12 text-ink-foreground/50"
                          }`}
                        >
                          {i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                        </span>
                        <span className={i <= step ? "" : "text-ink-foreground/45"}>{t(s)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : phase === "error" ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid gap-3"
                >
                  <p className="text-[13px] font-semibold text-ink-foreground/70">{error}</p>
                  <Btn variant="accent" onClick={retake}>
                    <RefreshCw className="size-4" /> {t("Try another document")}
                  </Btn>
                </motion.div>
              ) : phase === "done" && result ? (
                <motion.div
                  key="fields"
                  initial={{ opacity: 0, y: 12, filter: "blur(10px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  className="grid gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12px] font-bold text-primary">
                      <Sparkles className="size-3.5" /> {t("Read from your document")}
                    </span>
                    <span className="num text-[11px] font-bold text-ink-foreground/50">
                      {Math.round(result.confidence * 100)}% {t("confidence")}
                    </span>
                  </div>
                  <Meter value={result.confidence * 100} tone="ink" className="mb-1" />

                  {result.summary && (
                    <p className="mb-1 text-[12.5px] leading-relaxed text-ink-foreground/60">
                      {result.summary}
                    </p>
                  )}

                  {(
                    [
                      ["Merchant", result.merchant],
                      ["Total", money(result.amount, result.currency)],
                      ["Date", result.date],
                      ["Category", result.category],
                      ["Pages", String(result.pages)],
                      ...(result.vat != null
                        ? ([["Tax", money(result.vat, result.currency)]] as [string, string][])
                        : []),
                      ...(result.taxId ? ([["Tax ID", result.taxId]] as [string, string][]) : []),
                      ...(result.invoiceNumber
                        ? ([["Number", result.invoiceNumber]] as [string, string][])
                        : []),
                    ] as [string, string][]
                  ).map(([k, v], i) => (
                    <motion.div
                      key={k}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.06 * i }}
                      className="flex items-center justify-between gap-3 text-[13px]"
                    >
                      <span className="shrink-0 text-ink-foreground/50">{t(k)}</span>
                      <span className="truncate text-right font-bold">{v}</span>
                    </motion.div>
                  ))}

                  {result.lineItems.length > 0 && (
                    <div className="mt-2 rounded-2xl bg-ink-foreground/8 p-3">
                      <Label className="text-ink-foreground">{t("Line items")}</Label>
                      <div className="mt-2 grid gap-1">
                        {result.lineItems.map((l, i) => (
                          <div
                            key={`${l.label}-${i}`}
                            className="flex items-center justify-between gap-3 text-[12px]"
                          >
                            <span className="truncate text-ink-foreground/60">{l.label}</span>
                            <span className="num shrink-0 font-bold">
                              {money(l.amount, result.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.raw && (
                    <details className="mt-2 rounded-2xl bg-ink-foreground/8 p-3">
                      <summary className="cursor-pointer text-[12px] font-bold">
                        {t("Extracted text")}
                      </summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-foreground/65">
                        {result.raw}
                      </pre>
                    </details>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Btn variant="ghost" onClick={retake}>
                      <RefreshCw className="size-4" /> {t(isMobile ? "Retake" : "New file")}
                    </Btn>
                    <Btn variant="accent" onClick={() => void save()} disabled={saving}>
                      {t(saving ? "Saving file…" : "Save document")}
                    </Btn>
                  </div>
                  {error && (
                    <p
                      role="alert"
                      className="mt-2 text-center text-[11.5px] font-semibold text-destructive"
                    >
                      {error}
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="controls"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-between gap-3"
                >
                  <label
                    onPointerEnter={() => sfx("hover")}
                    className={`press grid size-11 shrink-0 cursor-pointer place-items-center rounded-full ${
                      isMobile ? "bg-white/15 text-white" : "bg-ink-foreground/12"
                    }`}
                  >
                    <ImagePlus className="size-4" />
                    <input
                      type="file"
                      accept={
                        isMobile
                          ? "image/*,application/pdf,.docx"
                          : "image/*,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      }
                      className="hidden"
                      onChange={(e) => pickFile(e.target.files?.[0])}
                    />
                  </label>

                  {isMobile ? (
                    <motion.button
                      onClick={capture}
                      disabled={!ready}
                      whileTap={{ scale: 0.92 }}
                      animate={
                        ready
                          ? {
                              boxShadow: [
                                "0 0 0 0px rgba(255,255,255,0.25)",
                                "0 0 0 12px rgba(255,255,255,0)",
                              ],
                            }
                          : {}
                      }
                      transition={{ duration: 1.8, repeat: Infinity }}
                      className="grid size-[68px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                      aria-label={t("Capture document")}
                      type="button"
                    >
                      <Camera className="size-7" />
                    </motion.button>
                  ) : (
                    <span className="text-[12.5px] font-semibold text-ink-foreground/55">
                      {t("Camera capture is mobile-only")}
                    </span>
                  )}

                  {isMobile ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void switchCamera()}
                        disabled={!ready}
                        aria-label={t(
                          cameraFacing === "environment"
                            ? "Switch to front camera"
                            : "Switch to back camera",
                        )}
                        title={t(
                          cameraFacing === "environment"
                            ? "Switch to front camera"
                            : "Switch to back camera",
                        )}
                        className="press grid size-11 shrink-0 place-items-center rounded-full bg-white/15 text-white disabled:opacity-40"
                      >
                        <SwitchCamera className="size-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleFlash()}
                        disabled={!ready || !flashSupported}
                        aria-label={t(flashOn ? "Turn flash off" : "Turn flash on")}
                        title={t(
                          flashSupported
                            ? flashOn
                              ? "Turn flash off"
                              : "Turn flash on"
                            : "Flash unavailable on this camera",
                        )}
                        className={`press grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-40 ${
                          flashOn ? "bg-primary text-primary-foreground" : "bg-white/15 text-white"
                        }`}
                      >
                        {flashOn ? <ZapOff className="size-4" /> : <Zap className="size-4" />}
                      </button>
                    </>
                  ) : (
                    <span className="grid size-11 place-items-center rounded-full bg-ink-foreground/12">
                      <Zap className="size-4" />
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </BlurFade>
    </div>
  );
}
