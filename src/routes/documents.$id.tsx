import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  Hash,
  Layers,
  Percent,
  Send,
  Share2,
  Sparkles,
  Loader2,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Label } from "@/components/kit";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { DocumentDetailSkeleton } from "@/components/Skeletons";
import { useCalmValue } from "@/lib/motion-prefs";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode } from "@/lib/i18n";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { deleteDocumentFromDriveAndVault, fetchDocumentBlob } from "@/lib/document-files";

export const Route = createFileRoute("/documents/$id")({
  head: () => ({
    meta: [
      { title: "Document receipt — Fisco" },
      {
        name: "description",
        content:
          "Open a scanned invoice or receipt and read every line: merchant, line items, tax and total.",
      },
      { property: "og:title", content: "Document receipt — Fisco" },
      {
        property: "og:description",
        content: "Read every line of a scanned invoice or receipt.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  pendingComponent: DocumentDetailSkeleton,
  component: DocumentDetail,
});

const EASE = [0.16, 1, 0.3, 1] as const;

function documentReference(id: string) {
  const seed = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  return `${id.toUpperCase()}-${(seed % 9000) + 1000}`;
}

function formatCurrency(value: number, currency?: string) {
  const code = currency || "EUR";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: code }).format(value);
  } catch {
    return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${code}`;
  }
}

const MONTHS = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["janvier", 1],
  ["janv", 1],
  ["يناير", 1],
  ["feb", 2],
  ["february", 2],
  ["février", 2],
  ["fevrier", 2],
  ["févr", 2],
  ["فبراير", 2],
  ["mar", 3],
  ["march", 3],
  ["mars", 3],
  ["مارس", 3],
  ["apr", 4],
  ["april", 4],
  ["avril", 4],
  ["avr", 4],
  ["أبريل", 4],
  ["may", 5],
  ["mai", 5],
  ["مايو", 5],
  ["jun", 6],
  ["june", 6],
  ["juin", 6],
  ["يونيو", 6],
  ["jul", 7],
  ["july", 7],
  ["juillet", 7],
  ["juil", 7],
  ["يوليو", 7],
  ["aug", 8],
  ["august", 8],
  ["août", 8],
  ["aout", 8],
  ["أغسطس", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["septembre", 9],
  ["سبتمبر", 9],
  ["oct", 10],
  ["october", 10],
  ["octobre", 10],
  ["أكتوبر", 10],
  ["nov", 11],
  ["november", 11],
  ["novembre", 11],
  ["نوفمبر", 11],
  ["dec", 12],
  ["december", 12],
  ["décembre", 12],
  ["ديسمبر", 12],
]);

function formatIssuedDate(value: string, locale: string) {
  const normalized = value.trim().replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(normalized);
  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(normalized);
  if (yearFirst) {
    year = Number(yearFirst[1]);
    month = Number(yearFirst[2]);
    day = Number(yearFirst[3]);
  } else if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
  } else {
    const dayFirst = /^(\d{1,2})\s+([^\s,]+)\s+(\d{4})$/u.exec(normalized);
    const monthFirst = /^([^\s,]+)\s+(\d{1,2}),?\s+(\d{4})$/u.exec(normalized);
    const monthName = (dayFirst?.[2] ?? monthFirst?.[1] ?? "")
      .toLocaleLowerCase(locale)
      .replace(/\.$/, "");
    month = MONTHS.get(monthName);
    day = Number(dayFirst?.[1] ?? monthFirst?.[2]);
    year = Number(dayFirst?.[3] ?? monthFirst?.[3]);

    if (!month) {
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        day = parsed.getUTCDate();
        month = parsed.getUTCMonth() + 1;
        year = parsed.getUTCFullYear();
      }
    }
  }

  if (
    !day ||
    !month ||
    !year ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    return value;

  const number = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
  return `${number.format(day)}/${number.format(month)}/${number.format(year)}`;
}

async function preparePreview(blob: Blob) {
  if (blob.type.toLowerCase().startsWith("image/")) {
    const imageDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Could not prepare this image preview."));
      reader.onerror = () => reject(new Error("Could not prepare this image preview."));
      reader.readAsDataURL(blob);
    });
    return new Blob(
      [
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>
          * { box-sizing: border-box; }
          html, body { width: 100%; height: 100%; margin: 0; }
          body { display: grid; place-items: center; overflow: auto; padding: 12px; background: #f1f2f5; }
          img { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; }
        </style></head><body><img src="${imageDataUrl}" alt="Document image"></body></html>`,
      ],
      { type: "text/html;charset=utf-8" },
    );
  }

  if (!blob.type.toLowerCase().includes("wordprocessingml.document")) return blob;

  const mammoth = await import("mammoth/mammoth.browser");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body { max-width: 900px; margin: 32px auto; padding: 0 24px; color: #20242a; font: 16px/1.6 Arial, sans-serif; }
    img { max-width: 100%; height: auto; } table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #d6dadd; padding: 6px 9px; text-align: left; }
  </style></head><body>${value}</body></html>`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return ".docx";
  }
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return "";
}

/* ------------------------------- small parts ------------------------------ */

function Stat({
  icon: Icon,
  k,
  v,
  i,
  calm,
}: {
  icon: typeof Hash;
  k: string;
  v: string;
  i: number;
  calm: boolean;
}) {
  return (
    <motion.div
      initial={calm ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: calm ? 0 : 0.12 + i * 0.04, duration: calm ? 0.15 : 0.35, ease: EASE }}
      className="glass min-w-0 rounded-2xl px-3 py-2.5"
    >
      <div className="flex items-center gap-1.5 opacity-45">
        <Icon className="size-3" strokeWidth={2.4} />
        <Label className="text-[8.5px] opacity-100">{k}</Label>
      </div>
      <div className="num mt-1 truncate text-[13px]">{v}</div>
    </motion.div>
  );
}

/** A stack of translucent pages that fans out — the scanned document itself. */
function PageStack({ pages, tint, calm }: { pages: number; tint: string; calm: boolean }) {
  const sheets = Math.min(4, Math.max(1, pages));
  return (
    <div className="relative grid h-[124px] w-[96px] shrink-0 place-items-center">
      {Array.from({ length: sheets }).map((_, i) => (
        <motion.div
          key={i}
          initial={calm ? false : { opacity: 0, y: 16, rotate: 0 }}
          animate={{ opacity: 1, y: 0, rotate: (i - (sheets - 1) / 2) * 6 }}
          transition={{
            delay: calm ? 0 : 0.08 + i * 0.05,
            duration: calm ? 0.15 : 0.5,
            ease: EASE,
          }}
          className={`glass absolute inset-0 grid content-start gap-1.5 rounded-2xl bg-gradient-to-br p-3 ${tint}`}
          style={{ zIndex: i }}
        >
          <span className="h-1.5 w-2/3 rounded-full bg-foreground/25" />
          <span className="h-1 w-full rounded-full bg-foreground/12" />
          <span className="h-1 w-5/6 rounded-full bg-foreground/12" />
          <span className="h-1 w-1/2 rounded-full bg-primary/50" />
          <span className="mt-auto h-1 w-2/3 rounded-full bg-foreground/10" />
        </motion.div>
      ))}
    </div>
  );
}

function DocumentDetail() {
  const { id } = useParams({ from: "/documents/$id" });
  const navigate = useNavigate();
  const { docs, ranked, chosenId, chosenRelationshipStatus, markSent, removeDoc } = useStore();
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale = localeCode(preferences.language);
  const doc = docs.find((d) => d.id === id);
  const accountantId = ranked.find((accountant) => accountant.id === chosenId)?.id;
  const canSend = chosenRelationshipStatus === "active" && !!accountantId;
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsHtml, setPreviewIsHtml] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const calm = useCalmValue();

  const reference = useMemo(() => documentReference(id), [id]);
  const issuedDate = doc ? formatIssuedDate(doc.date, locale) : "";

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  if (!doc) {
    return (
      <div>
        <PageHeader title="Document" back />
        <div className="mx-auto max-w-[560px] px-4 pt-16 text-center text-sm text-muted-foreground">
          This document is no longer in your vault.
        </div>
      </div>
    );
  }

  const copyRef = async () => {
    sfx("tick");
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      sfx("success");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      sfx("error");
    }
  };

  const previewDocument = async () => {
    sfx("open");
    setPreviewOpen(true);
    if (previewUrl || previewLoading) return;

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const blob = await fetchDocumentBlob(doc.id);
      const previewBlob = await preparePreview(blob);
      setPreviewIsHtml(previewBlob.type.startsWith("text/html"));
      setPreviewUrl(URL.createObjectURL(previewBlob));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Could not load this document.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadDocument = async () => {
    setDownloading(true);
    setSendError(null);
    try {
      const blob = await fetchDocumentBlob(doc.id, true);
      const fileUrl = URL.createObjectURL(blob);
      const fileName =
        doc.merchant.replace(/[\\/:*?"<>|]/g, "_").trim() + extensionForMimeType(blob.type);
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = fileName || "document";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 30_000);
      sfx("success");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not download this document.");
      sfx("error");
    } finally {
      setDownloading(false);
    }
  };

  const deleteStoredDocument = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDocumentFromDriveAndVault(doc.id);
      removeDoc(doc.id);
      setDeleteOpen(false);
      sfx("success");
      void navigate({ to: "/documents" });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete this document.");
      sfx("error");
    } finally {
      setDeleting(false);
    }
  };

  const shareDocument = async () => {
    const url = doc.driveUrl ?? doc.previewUrl;
    if (!url) {
      setSendError("This document does not have a shareable file link.");
      return;
    }
    try {
      if (navigator.share) await navigator.share({ title: doc.merchant, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
      sfx("success");
    } catch {
      sfx("error");
    }
  };

  const statusTone =
    doc.status === "sent"
      ? { dot: "bg-positive", text: t("Shared with your accountant") }
      : doc.status === "pending"
        ? { dot: "bg-primary", text: t("Waiting to be sent") }
        : { dot: "bg-iris", text: t("Stored in your vault") };

  const lineItems = doc.aiDetails?.lineItems ?? [];
  const maxLine = Math.max(...lineItems.map((line) => line.amount), 1);

  return (
    <div className="relative w-full max-w-full overflow-x-hidden">
      <PageHeader title={doc.merchant} back />

      {/* document-tinted light behind the glass */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-[300px] overflow-hidden bg-gradient-to-b ${doc.tint} opacity-70 blur-2xl`}
        style={{ transform: "translateZ(0)" }}
      />

      <div className="relative mx-auto w-full max-w-[560px] px-4 pt-4 pb-44">
        {/* ------------------------------- hero ------------------------------- */}
        <motion.section
          initial={calm ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: calm ? 0.15 : 0.45, ease: EASE }}
          className={`glass relative overflow-hidden rounded-[30px] p-5 ${calm ? "" : "sheen"}`}
        >
          <div className="relative flex items-start gap-4">
            <PageStack pages={doc.pages} tint={doc.tint} calm={calm} />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`size-1.5 rounded-full ${statusTone.dot}`} />
                <span className="truncate text-[10px] font-bold tracking-[0.16em] uppercase opacity-50">
                  {statusTone.text}
                </span>
              </div>

              <h2 className="serif mt-1.5 truncate text-[28px] leading-[1.05]">{doc.merchant}</h2>
              <div className="mt-0.5 text-[12px] font-semibold text-muted-foreground">
                {t(doc.category)} · {issuedDate}
              </div>

              <div className="num mt-4 text-[34px] leading-none">
                {doc.amount === 0 ? (
                  "—"
                ) : (
                  <AnimatedNumber
                    value={doc.amount}
                    format={(n) => formatCurrency(n, doc.currency)}
                    duration={0.9}
                  />
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <BadgeCheck className="size-3.5 text-positive" strokeWidth={2.3} />
                {doc.aiDetails?.confidence != null
                  ? `${t("Read by AI")} · ${Math.round(doc.aiDetails.confidence * 100)}% ${t("confidence")}`
                  : t("Read by AI")}
              </div>
            </div>
          </div>
        </motion.section>

        {/* ------------------------------ meta grid ---------------------------- */}
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-4">
          <Stat icon={Hash} k={t("Reference")} v={reference} i={0} calm={calm} />
          <Stat icon={Calendar} k={t("Issued")} v={issuedDate} i={1} calm={calm} />
          <Stat icon={Layers} k={t("Pages")} v={`${doc.pages}`} i={2} calm={calm} />
          <Stat
            icon={Percent}
            k={t("VAT")}
            v={
              !doc.aiDetails
                ? t("Not saved")
                : doc.aiDetails.vat == null
                  ? t("Not detected")
                  : formatCurrency(doc.aiDetails.vat, doc.currency)
            }
            i={3}
            calm={calm}
          />
        </div>

        {/* ------------------- built-in google drive preview ------------------- */}
        {(doc.driveFileId || doc.embedUrl || doc.previewUrl || doc.driveUrl) && (
          <motion.section
            id={`document-preview-${doc.id}`}
            initial={calm ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass mt-3 overflow-hidden rounded-[28px] p-4"
          >
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                <Label>{t("Document preview")}</Label>
              </div>
            </div>
            <div className="relative h-[460px] w-full overflow-hidden rounded-2xl border border-border/60 bg-secondary/30">
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  title={doc.merchant}
                  sandbox={previewIsHtml ? "" : undefined}
                  className="size-full border-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => void previewDocument()}
                  className="press group absolute inset-0 grid content-center justify-items-center gap-3 px-4 text-center text-sm font-semibold text-muted-foreground hover:bg-card/40"
                >
                  <img
                    src="/assets/illustrations/file-text-3d.webp"
                    alt=""
                    aria-hidden="true"
                    className="size-56 max-w-full object-contain drop-shadow-[0_20px_28px_rgba(20,30,45,0.16)] transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="rounded-full border border-border/70 bg-card/75 px-4 py-2.5 text-[14px] font-bold text-foreground shadow-soft backdrop-blur-sm transition-colors group-hover:bg-primary/10">
                    {previewLoading ? t("Preparing preview…") : t("Click here to view")}
                  </span>
                </button>
              )}
            </div>
            {previewError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {previewError}
              </p>
            )}
          </motion.section>
        )}

        <>
          <motion.section
            initial={calm ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: calm ? 0 : 0.08, duration: calm ? 0.15 : 0.4, ease: EASE }}
            className="glass mt-3 rounded-[28px] p-4"
          >
            <Label>{t("AI extraction")}</Label>
            {doc.aiDetails?.summary && (
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {doc.aiDetails.summary}
              </p>
            )}
            {!doc.aiDetails && (
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                {t("Detailed AI fields were not saved with this older document.")}
              </p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              {[
                [
                  t("Invoice number"),
                  !doc.aiDetails
                    ? t("Not saved")
                    : doc.aiDetails.invoiceNumber || t("Not detected"),
                ],
                [
                  t("Tax ID"),
                  !doc.aiDetails ? t("Not saved") : doc.aiDetails.taxId || t("Not detected"),
                ],
                [
                  t("VAT amount"),
                  !doc.aiDetails
                    ? t("Not saved")
                    : doc.aiDetails.vat == null
                      ? t("Not detected")
                      : formatCurrency(doc.aiDetails.vat, doc.currency),
                ],
                [
                  t("AI confidence"),
                  !doc.aiDetails
                    ? t("Not saved")
                    : doc.aiDetails.confidence == null
                      ? t("Not available")
                      : `${Math.round(doc.aiDetails.confidence * 100)}%`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-xl bg-secondary/55 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase opacity-45">{label}</div>
                  <div className="mt-1 break-words text-[13px] font-semibold">{value}</div>
                </div>
              ))}
            </div>
            {doc.aiDetails?.raw && (
              <details className="mt-3 border-t border-border/60 pt-3">
                <summary className="cursor-pointer text-[12px] font-bold">
                  {t("Extracted text")}
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted-foreground">
                  {doc.aiDetails.raw}
                </pre>
              </details>
            )}
          </motion.section>

          {/* ----------------------------- line items ---------------------------- */}
          <motion.section
            initial={calm ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: calm ? 0 : 0.1, duration: calm ? 0.15 : 0.45, ease: EASE }}
            className="glass mt-3 rounded-[28px] p-4"
          >
            <div className="flex items-center justify-between">
              <Label>{t("Line items")}</Label>
              <span className="text-[11px] font-bold text-muted-foreground">
                {lineItems.length} {t("entries")}
              </span>
            </div>

            {lineItems.length > 0 ? (
              <div className="mt-2.5 grid gap-1">
                {lineItems.map((line, i) => (
                  <motion.div
                    key={line.label + i}
                    initial={calm || i > 5 ? false : { opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: calm ? 0 : 0.16 + i * 0.05,
                      duration: calm ? 0.12 : 0.4,
                      ease: EASE,
                    }}
                    className="cv-auto relative overflow-hidden rounded-2xl px-3 py-2.5 transition-colors hover:bg-card/70"
                  >
                    <motion.span
                      aria-hidden
                      initial={calm ? false : { scaleX: 0 }}
                      animate={{ scaleX: line.amount / maxLine }}
                      transition={{
                        delay: calm ? 0 : 0.2 + i * 0.05,
                        duration: calm ? 0.15 : 0.6,
                        ease: EASE,
                      }}
                      className="absolute inset-y-0 left-0 w-full origin-left rounded-2xl bg-primary/8"
                    />
                    <div className="relative flex items-center gap-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-card/80">
                        <FileText className="size-3.5 opacity-60" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                        {line.label}
                      </span>
                      <span className="num shrink-0 text-[13.5px]">
                        {formatCurrency(line.amount, doc.currency)}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="mt-2.5 text-[12px] text-muted-foreground">
                {doc.aiDetails
                  ? t("No line items were detected.")
                  : t("Line items were not saved with this older document.")}
              </p>
            )}
          </motion.section>
        </>

        {/* ------------------------------ reference ---------------------------- */}
        <motion.section
          initial={calm ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: calm ? 0 : 0.16, duration: calm ? 0.15 : 0.45, ease: EASE }}
          className="glass-ink mt-3 flex items-center gap-3 rounded-[28px] p-4"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-ink-foreground/12">
            <Sparkles className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <Label className="text-ink-foreground">{t("Vault reference")}</Label>
            <div className="num mt-0.5 truncate text-[13.5px]">{reference}</div>
          </div>
          <button
            onClick={copyRef}
            onPointerEnter={() => sfx("hover")}
            aria-label={t("Copy reference")}
            className="press grid size-10 shrink-0 place-items-center rounded-full bg-ink-foreground/12"
          >
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="ok"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.18 }}
                >
                  <Check className="size-4" strokeWidth={3} />
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.18 }}
                >
                  <Copy className="size-4" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </motion.section>

        {/* ------------------------------ action dock ---------------------------- */}
        <motion.div
          initial={calm ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: calm ? 0 : 0.2, duration: calm ? 0.15 : 0.45, ease: EASE }}
          className="mt-3"
        >
          <div className="glass flex items-center gap-1.5 rounded-full p-1.5">
            <DockBtn onClick={() => void downloadDocument()} label={t("Download")}>
              {downloading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
            </DockBtn>
            <DockBtn onClick={() => void shareDocument()} label={t("Share")}>
              <Share2 className="size-4" />
            </DockBtn>
            <DockBtn onClick={previewDocument} label={t("Preview")}>
              <Eye className="size-4" />
            </DockBtn>
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              onPointerEnter={() => sfx("hover")}
              aria-label={t("Delete document")}
              title={t("Delete document")}
              className="press grid size-11 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive hover:bg-destructive/15"
            >
              <Trash2 className="size-4" />
            </button>
            <button
              onPointerEnter={() => sfx("hover")}
              disabled={sending || !canSend}
              onClick={async () => {
                if (sending) return;
                if (!accountantId) {
                  setSendError("Choose an accountant before sharing this document.");
                  return;
                }
                if (!canSend) {
                  setSendError(
                    "Your accountant must accept your request before you can share documents.",
                  );
                  return;
                }
                sfx("confirm");
                setSending(true);
                setSendError(null);
                const saved = await markSent([doc.id], accountantId);
                setSending(false);
                if (!saved) {
                  setSendError("This document was not shared. Please try again.");
                  return;
                }
                window.setTimeout(() => sfx("success"), 160);
                window.setTimeout(() => void navigate({ to: "/documents" }), 320);
              }}
              className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[13.5px] font-bold text-primary-foreground disabled:opacity-90"
              style={{ boxShadow: "var(--shadow-accent)" }}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {sending ? t("Sending…") : canSend ? t("Send to accountant") : t("Awaiting approval")}
            </button>
          </div>
          {sendError && (
            <p
              role="alert"
              className="mt-2 text-center text-[11.5px] font-semibold text-destructive"
            >
              {sendError}
            </p>
          )}
        </motion.div>
      </div>
      <Dialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-[20px] border border-border/70 bg-card/95 p-5 shadow-2xl backdrop-blur-2xl sm:p-6 [&>button:last-child]:hidden">
          <DialogTitle className="text-[18px] font-bold">{t("Delete this document?")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("This moves the Drive file to Google Drive Trash and removes its Fisco record.")}
          </p>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <button
                type="button"
                disabled={deleting}
                className="press h-10 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50"
              >
                {t("Cancel")}
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void deleteStoredDocument()}
              className="press inline-flex h-10 items-center justify-center gap-2 rounded-full bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {deleting ? t("Deleting…") : t("Delete document")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          data-fisco-document-preview
          className="fixed inset-0 left-0 top-0 z-[100] flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:rounded-none [&>button:last-child]:hidden"
        >
          <div className="glass relative z-10 flex min-h-14 items-center gap-3 border-b border-border/60 px-3 sm:px-5">
            <DialogClose asChild>
              <button
                type="button"
                aria-label={t("Return to document")}
                className="press glass button-rim grid size-10 shrink-0 place-items-center rounded-full border border-white/50 bg-card/55 shadow-soft backdrop-blur-xl"
              >
                <ArrowLeft className="size-4" />
              </button>
            </DialogClose>
            <DialogTitle className="min-w-0 flex-1 truncate text-start text-[14px] font-bold">
              {doc.merchant} · {t("Document preview")}
            </DialogTitle>
          </div>
          {previewLoading && (
            <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {t("Preparing preview…")}
              </span>
            </div>
          )}
          {previewError && (
            <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
              <div>
                <p role="alert" className="text-sm text-destructive">
                  {previewError}
                </p>
                <button
                  type="button"
                  onClick={() => void previewDocument()}
                  className="press mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  {t("Try again")}
                </button>
              </div>
            </div>
          )}
          {previewUrl && (
            <iframe
              src={previewUrl}
              title={`${doc.merchant} document preview`}
              sandbox={previewIsHtml ? "" : undefined}
              className="min-h-0 flex-1 border-0 bg-black"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DockBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onPointerEnter={() => sfx("hover")}
      aria-label={label}
      className="press grid size-11 place-items-center rounded-full bg-card/70 text-foreground"
    >
      {children}
    </button>
  );
}
