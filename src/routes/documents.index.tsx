import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  FileText,
  LayoutGrid,
  ListChecks,
  Plus,
  Rows3,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { Label } from "@/components/kit";
import { eur, type Doc } from "@/lib/data";
import { useStore } from "@/lib/app-store";
import { deleteDocumentFromDriveAndVault } from "@/lib/document-files";
import { sfx } from "@/lib/sfx";
import { DocumentsListSkeleton } from "@/components/Skeletons";
import { useT } from "@/lib/ui-prefs";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/documents/")({
  head: () => ({
    meta: [
      { title: "Documents — Fisco" },
      {
        name: "description",
        content: "Every invoice, receipt and tax form you scanned, sorted and ready to send.",
      },
      { property: "og:title", content: "Documents — Fisco" },
      {
        property: "og:description",
        content: "Invoices, receipts and tax forms in one organized vault.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  pendingComponent: DocumentsListSkeleton,
  component: Documents,
});

const EASE = [0.16, 1, 0.3, 1] as const;
const FILTERS = ["All", "Stored", "Pending", "Sent"] as const;
const SORTS = ["Recent", "Value", "Pages"] as const;

type Filter = (typeof FILTERS)[number];
type Sort = (typeof SORTS)[number];

const STATUS_COLOR: Record<Doc["status"], string> = {
  stored: "bg-iris",
  pending: "bg-primary",
  sent: "bg-positive",
};

function Documents() {
  const { docs, removeDoc, ranked, chosenId, chosenRelationshipStatus, markSent, role } =
    useStore();
  const t = useT();
  const chosenAccountant = ranked.find((accountant) => accountant.id === chosenId);
  const [filter, setFilter] = useState<Filter>("All");
  const [sort, setSort] = useState<Sort>("Recent");
  const [dense, setDense] = useState(false);
  const [q, setQ] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [deleteSelectedError, setDeleteSelectedError] = useState<string | null>(null);
  const [sendingSelected, setSendingSelected] = useState(false);
  const [sendSelectedError, setSendSelectedError] = useState<string | null>(null);
  const documentHoldTimerRef = useRef<number | null>(null);
  const documentHoldOriginRef = useRef<{ x: number; y: number } | null>(null);
  const documentHoldTriggeredRef = useRef(false);
  const canSendSelected =
    role === "taxpayer" && chosenRelationshipStatus === "active" && !!chosenAccountant;

  const clearDocumentHold = () => {
    if (documentHoldTimerRef.current !== null) {
      window.clearTimeout(documentHoldTimerRef.current);
      documentHoldTimerRef.current = null;
    }
    documentHoldOriginRef.current = null;
  };

  useEffect(() => () => clearDocumentHold(), []);

  const list = useMemo(() => {
    const out = docs.filter((d) => {
      const byFilter = filter === "All" || d.status === filter.toLowerCase();
      const term = q.trim().toLowerCase();
      const byQuery =
        !term || d.merchant.toLowerCase().includes(term) || d.category.toLowerCase().includes(term);
      return byFilter && byQuery;
    });
    if (sort === "Value") out.sort((a, b) => b.amount - a.amount);
    if (sort === "Pages") out.sort((a, b) => b.pages - a.pages);
    return out;
  }, [docs, filter, q, sort]);

  const total = list.reduce((s, d) => s + d.amount, 0);
  const pages = list.reduce((s, d) => s + d.pages, 0);
  const counts = {
    stored: docs.filter((d) => d.status === "stored").length,
    pending: docs.filter((d) => d.status === "pending").length,
    sent: docs.filter((d) => d.status === "sent").length,
  };
  const all = Math.max(1, docs.length);
  const allVisibleSelected = list.length > 0 && list.every((doc) => selectedIds.includes(doc.id));
  const someVisibleSelected = list.some((doc) => selectedIds.includes(doc.id));

  const toggleVisibleSelection = () => {
    const visibleIds = new Set(list.map((doc) => doc.id));
    setSelectedIds((current) => {
      const hiddenIds = current.filter((id) => !visibleIds.has(id));
      return allVisibleSelected ? hiddenIds : [...hiddenIds, ...visibleIds];
    });
  };

  const toggleDocumentSelection = (id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id),
    );
  };

  const sendSelectedDocuments = async () => {
    if (!canSendSelected || !chosenAccountant || selectedIds.length === 0) return;
    setSendingSelected(true);
    setSendSelectedError(null);
    try {
      const saved = await markSent(selectedIds, chosenAccountant.id);
      if (!saved) {
        setSendSelectedError(
          t("Your documents were not shared. Please check your connection and try again."),
        );
        return;
      }
      setSelectedIds([]);
      setSelectionMode(false);
      sfx("success");
    } catch {
      setSendSelectedError(
        t("Your documents were not shared. Please check your connection and try again."),
      );
    } finally {
      setSendingSelected(false);
    }
  };

  const deleteSelectedDocuments = async () => {
    const selectedDocs = docs.filter((doc) => selectedIds.includes(doc.id));
    if (!selectedDocs.length) {
      setDeleteSelectedOpen(false);
      return;
    }

    setDeletingSelected(true);
    setDeleteSelectedError(null);
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    const failureMessages: string[] = [];
    for (let index = 0; index < selectedDocs.length; index += 3) {
      const batch = selectedDocs.slice(index, index + 3);
      const results = await Promise.allSettled(
        batch.map((doc) => deleteDocumentFromDriveAndVault(doc.id)),
      );
      results.forEach((result, resultIndex) => {
        const doc = batch[resultIndex];
        if (!doc) return;
        if (result.status === "fulfilled") deletedIds.push(doc.id);
        else {
          failedIds.push(doc.id);
          if (result.reason instanceof Error) failureMessages.push(result.reason.message);
        }
      });
    }

    deletedIds.forEach(removeDoc);
    setSelectedIds(failedIds);
    setDeletingSelected(false);
    if (failedIds.length) {
      const detail = failureMessages[0];
      setDeleteSelectedError(
        detail
          ? `${t("Some documents could not be deleted.")} ${detail}`
          : t("Some documents could not be deleted."),
      );
      return;
    }

    setDeleteSelectedOpen(false);
    setSelectionMode(false);
    sfx("success");
  };

  return (
    <div className="relative flex min-h-dvh w-full max-w-full flex-col overflow-x-hidden">
      {/* ambient light field */}
      <div
        aria-hidden
        className="ambient-glow pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-40 -left-24 size-[520px] rounded-full bg-primary/10 blur-[90px]" />
        <div className="absolute top-1/3 -right-32 size-[460px] rounded-full bg-iris/8 blur-[90px]" />
      </div>

      <PageHeader title="Vault" back />

      <div className="mx-auto min-w-0 w-full max-w-[1180px] flex-1 px-4 pb-32">
        {/* ---------- hero ---------- */}
        <motion.section
          initial={false}
          className="glass-ink sheen relative mt-3 overflow-hidden rounded-4xl p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <Label className="text-ink-foreground/70">
                {filter === "All" ? t("Whole vault") : t(filter)} · {list.length} {t("documents")}
              </Label>
              <div className="num mt-2 text-[38px] leading-none sm:text-[46px]">
                <AnimatedNumber value={total} format={eur} />
              </div>
              <div className="mt-1.5 text-[12.5px] text-ink-foreground/55">
                {pages} {t("scanned pages in this view")}
              </div>
            </div>

            <Link
              to="/scan"
              onClick={() => sfx("open")}
              onPointerEnter={() => sfx("hover")}
              className="press group inline-flex h-11 items-center gap-2 rounded-full bg-ink-foreground px-5 text-[13px] font-bold text-ink"
            >
              <Plus className="size-4 transition-transform group-hover:rotate-90" />
              {t("Capture")}
            </Link>
          </div>

          {/* distribution ribbon */}
          <div className="mt-5 flex h-1.5 gap-1 overflow-hidden rounded-full">
            {(["sent", "pending", "stored"] as const).map((k) => (
              <span
                key={k}
                className={`h-full rounded-full ${STATUS_COLOR[k]}`}
                style={{ width: `${(counts[k] / all) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {(["sent", "pending", "stored"] as const).map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.1em] text-ink-foreground/60 uppercase"
              >
                <i className={`size-1.5 rounded-full ${STATUS_COLOR[k]}`} />
                {t(k[0]?.toUpperCase() + k.slice(1))} · {counts[k]}
              </span>
            ))}
          </div>
        </motion.section>

        {/* ---------- command bar ---------- */}
        <motion.div initial={false} className="glass mt-3 rounded-3xl p-2">
          <div className="flex items-center gap-2">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-card/60 px-3.5">
              <Search className="size-4 shrink-0 opacity-45" />
              <input
                value={q}
                onChange={(e) => {
                  setSelectedIds([]);
                  setQ(e.target.value);
                }}
                placeholder={t("Search merchant or category")}
                className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-muted-foreground"
              />
              <AnimatePresence>
                {q && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    onClick={() => {
                      sfx("tap");
                      setQ("");
                      setSelectedIds([]);
                    }}
                    aria-label={t("Clear search")}
                    className="grid size-5 place-items-center rounded-full bg-foreground/10"
                  >
                    <X className="size-3" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={() => {
                sfx("pop");
                setDense((d) => !d);
              }}
              aria-label={t(dense ? "Grid view" : "List view")}
              className="press grid size-10 shrink-0 place-items-center rounded-full bg-card/60"
            >
              <motion.span
                key={String(dense)}
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {dense ? <LayoutGrid className="size-4" /> : <Rows3 className="size-4" />}
              </motion.span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectionMode((current) => !current);
                setSelectedIds([]);
                setDeleteSelectedError(null);
              }}
              aria-label={t(selectionMode ? "Done selecting" : "Select documents")}
              title={t(selectionMode ? "Done selecting" : "Select documents")}
              aria-pressed={selectionMode}
              className={`press grid size-10 shrink-0 place-items-center rounded-full ${selectionMode ? "bg-primary text-primary-foreground" : "bg-card/60"}`}
            >
              {selectionMode ? <X className="size-4" /> : <ListChecks className="size-4" />}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5 pb-0.5">
            {FILTERS.map((f) => (
              <Pill
                key={f}
                active={f === filter}
                onClick={() => {
                  setFilter(f);
                  setSelectedIds([]);
                }}
                id="doc-filter"
              >
                {t(f)}
              </Pill>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-foreground/10" />
            <SlidersHorizontal className="size-3.5 shrink-0 opacity-40" />
            {SORTS.map((s) => (
              <Pill key={s} active={s === sort} onClick={() => setSort(s)} id="doc-sort" subtle>
                {t(s)}
              </Pill>
            ))}
          </div>
        </motion.div>

        {selectionMode && list.length > 0 && (
          <div className="glass mt-2 grid min-w-0 gap-2 rounded-2xl p-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <label className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 text-[12.5px] font-semibold">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected;
                  }}
                  onChange={toggleVisibleSelection}
                  className="size-4 accent-primary"
                />
                {t("Select all in this view")}
              </label>
              <span className="shrink-0 text-[11.5px] text-muted-foreground">
                {selectedIds.length}{" "}
                {t(selectedIds.length === 1 ? "document selected" : "documents selected")}
              </span>
            </div>
            <div className="grid min-w-0 gap-2 sm:flex sm:justify-end">
              <button
                type="button"
                disabled={!selectedIds.length || deletingSelected}
                onClick={() => {
                  setDeleteSelectedError(null);
                  setDeleteSelectedOpen(true);
                }}
                className="press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-destructive/10 px-3.5 text-[12px] font-bold text-destructive disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                <Trash2 className="size-4" />
                {t("Delete selected")}
              </button>
              {role === "taxpayer" && (
                <button
                  type="button"
                  disabled={!selectedIds.length || sendingSelected || !canSendSelected}
                  onClick={() => void sendSelectedDocuments()}
                  className="press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-[12px] font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
                >
                  {sendingSelected ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {t(
                    !chosenAccountant
                      ? "Choose an accountant before sharing documents."
                      : canSendSelected
                        ? "Send to accountant"
                        : "Your accountant must accept your request before you can share documents.",
                  )}
                </button>
              )}
            </div>
            {sendSelectedError && (
              <p role="alert" className="text-[11.5px] font-semibold text-destructive">
                {sendSelectedError}
              </p>
            )}
          </div>
        )}

        {/* ---------- results ---------- */}
        <motion.div
          layout
          className={dense ? "mt-3 grid gap-2" : "mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3"}
        >
          <AnimatePresence initial={false}>
            {list.map((d, i) => (
              <motion.div key={d.id} initial={false} exit={{ opacity: 0 }}>
                <div className="flex min-w-0 items-center gap-2">
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(d.id)}
                      onChange={(event) => toggleDocumentSelection(d.id, event.target.checked)}
                      aria-label={`${t("Select document")} ${d.merchant}`}
                      className="size-4 shrink-0 accent-primary"
                    />
                  )}
                  <Link
                    to="/documents/$id"
                    params={{ id: d.id }}
                    onPointerEnter={() => sfx("hover")}
                    onClick={() => sfx("open")}
                    preload="intent"
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button !== 0) return;
                      documentHoldTriggeredRef.current = false;
                      clearDocumentHold();
                      documentHoldOriginRef.current = { x: event.clientX, y: event.clientY };
                      documentHoldTimerRef.current = window.setTimeout(() => {
                        documentHoldTriggeredRef.current = true;
                        setSelectionMode(true);
                        setSelectedIds((current) =>
                          current.includes(d.id) ? current : [...current, d.id],
                        );
                        setSendSelectedError(null);
                        sfx("tick");
                        documentHoldTimerRef.current = null;
                      }, 450);
                    }}
                    onPointerUp={clearDocumentHold}
                    onPointerCancel={clearDocumentHold}
                    onPointerLeave={clearDocumentHold}
                    onPointerMove={(event) => {
                      const origin = documentHoldOriginRef.current;
                      if (!origin || documentHoldTimerRef.current === null) return;
                      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) {
                        clearDocumentHold();
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      clearDocumentHold();
                      setSelectionMode(true);
                      setSelectedIds((current) =>
                        current.includes(d.id) ? current : [...current, d.id],
                      );
                      setSendSelectedError(null);
                      sfx("tick");
                    }}
                    onClick={(event) => {
                      if (documentHoldTriggeredRef.current) {
                        event.preventDefault();
                        documentHoldTriggeredRef.current = false;
                        return;
                      }
                      if (selectionMode) {
                        event.preventDefault();
                        toggleDocumentSelection(d.id, !selectedIds.includes(d.id));
                        setSendSelectedError(null);
                        return;
                      }
                      sfx("open");
                    }}
                    className={`press glass group relative block min-w-0 max-w-full flex-1 touch-pan-y overflow-hidden rounded-3xl ${selectedIds.includes(d.id) ? "ring-2 ring-primary/55" : ""}`}
                  >
                    {/* tint aura */}
                    <span
                      aria-hidden
                      className={`pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-gradient-to-br opacity-70 blur-3xl transition-opacity duration-500 group-hover:opacity-100 ${d.tint}`}
                    />
                    <div className={`relative flex items-center gap-3 ${dense ? "p-3" : "p-4"}`}>
                      <div className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-card/80 shadow-soft">
                        <FileText className="size-[16px]" strokeWidth={1.9} />
                        <span
                          className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card ${STATUS_COLOR[d.status]}`}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] leading-tight font-extrabold tracking-tight">
                          {d.merchant}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/45">
                          <span className="rounded-full bg-foreground/6 px-2 py-0.5">
                            {d.category}
                          </span>
                          <span>{d.pages}p</span>
                          <span className="opacity-50">·</span>
                          <span>{d.date}</span>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="num text-[15px] leading-none">
                          {d.amount === 0 ? "—" : eur(d.amount)}
                        </div>
                        <span className="mt-1.5 inline-block text-[9.5px] font-bold tracking-[0.14em] uppercase opacity-45">
                          {t(d.status[0]?.toUpperCase() + d.status.slice(1))}
                        </span>
                      </div>

                      <ArrowUpRight className="size-4 shrink-0 opacity-25 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-70" />
                    </div>
                  </Link>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        <AnimatePresence>
          {list.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0 }}
              className="glass mt-3 grid place-items-center gap-2 rounded-3xl p-12 text-center"
            >
              <div className="breathe grid size-12 place-items-center rounded-2xl bg-card/70">
                <FileText className="size-5 opacity-40" />
              </div>
              <Label>{t("Nothing in this view")}</Label>
              <button
                onClick={() => {
                  sfx("tap");
                  setQ("");
                  setFilter("All");
                }}
                className="text-[12.5px] font-bold text-primary"
              >
                {t("Reset filters")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Dialog
        open={deleteSelectedOpen}
        onOpenChange={(open) => !deletingSelected && setDeleteSelectedOpen(open)}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-[20px] border border-border/70 bg-card/95 p-5 shadow-2xl backdrop-blur-2xl sm:p-6 [&>button:last-child]:hidden">
          <DialogTitle className="text-[18px] font-bold">
            {t("Delete selected documents?")}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("These files will be moved to Google Drive Trash and their Fisco records removed.")}
          </p>
          <p className="text-sm font-semibold">
            {selectedIds.length}{" "}
            {t(selectedIds.length === 1 ? "document selected" : "documents selected")}
          </p>
          {deleteSelectedError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteSelectedError}
            </p>
          )}
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <button
                type="button"
                disabled={deletingSelected}
                className="press h-10 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50"
              >
                {t("Cancel")}
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={deletingSelected || !selectedIds.length}
              onClick={() => void deleteSelectedDocuments()}
              className="press inline-flex h-10 items-center justify-center gap-2 rounded-full bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
            >
              <Trash2 className="size-4" />
              {deletingSelected ? t("Deleting…") : t("Delete selected")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Pill({
  children,
  active,
  onClick,
  id,
  subtle,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  id: string;
  subtle?: boolean;
}) {
  return (
    <button
      onClick={() => {
        sfx("pop");
        onClick();
      }}
      onPointerEnter={() => sfx("hover")}
      className={`press relative shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold tracking-tight transition-colors ${
        active ? (subtle ? "text-foreground" : "text-primary-foreground") : "text-muted-foreground"
      }`}
    >
      {active && (
        <motion.span
          layoutId={id}
          className={`absolute inset-0 rounded-full ${subtle ? "bg-card shadow-soft" : "bg-primary shadow-[var(--shadow-accent)]"}`}
          transition={{ type: "spring", stiffness: 440, damping: 34 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  );
}
