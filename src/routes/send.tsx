import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Send } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Btn, Card, Label } from "@/components/kit";
import { eur } from "@/lib/data";
import { fmtKm } from "@/lib/geo";
import { useStore } from "@/lib/app-store";
import { useT } from "@/lib/ui-prefs";

export const Route = createFileRoute("/send")({
  head: () => ({
    meta: [
      { title: "Send documents — Fisco" },
      {
        name: "description",
        content: "Pick the documents to hand over and deliver them to your accountant instantly.",
      },
      { property: "og:title", content: "Send documents — Fisco" },
      {
        property: "og:description",
        content: "Batch your invoices and deliver them to your accountant.",
      },
    ],
  }),
  component: SendScreen,
});

function SendScreen() {
  const navigate = useNavigate();
  const { docs, ranked, chosenId, chosenRelationshipStatus, markSent } = useStore();
  const t = useT();
  const target = ranked.find((a) => a.id === chosenId);
  const canSend = chosenRelationshipStatus === "active" && !!target;
  const sendable = docs.filter((d) => d.status !== "sent");
  const [picked, setPicked] = useState<string[]>(sendable.map((d) => d.id));
  const [selectionInitialized, setSelectionInitialized] = useState(sendable.length > 0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectionInitialized || sendable.length === 0) return;
    setPicked(sendable.map((doc) => doc.id));
    setSelectionInitialized(true);
  }, [sendable, selectionInitialized]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const total = docs.filter((d) => picked.includes(d.id)).reduce((s, d) => s + d.amount, 0);

  const submit = async () => {
    if (!target?.id) {
      setError(t("Choose an accountant before sharing documents."));
      return;
    }
    if (!canSend) {
      setError(t("Your accountant must accept your request before you can share documents."));
      return;
    }
    setSending(true);
    setError(null);
    const saved = await markSent(picked, target.id);
    setSending(false);
    if (!saved) {
      setError(t("Your documents were not shared. Please check your connection and try again."));
      return;
    }
    setDone(true);
    window.setTimeout(() => navigate({ to: "/documents" }), 900);
  };

  return (
    <div>
      <PageHeader title="Send to accountant" back />
      <div className="mx-auto w-full max-w-[720px] px-4 pb-32">
        <BlurFade>
          <Card tone="ink" className="p-5">
            <Label className="text-ink-foreground">{t("Recipient")}</Label>
            <div className="mt-3 flex items-center gap-3">
              <Avatar src={target?.photo} initials={target?.initials ?? "—"} size={50} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-bold">{target?.firm}</div>
                <div className="text-[12.5px] text-ink-foreground/55">
                  {target?.name} · {target ? fmtKm(target.km) : ""}
                </div>
                {target && (
                  <div className="mt-1 text-[11px] font-bold text-ink-foreground/65">
                    {canSend
                      ? t("Approved. You can share documents.")
                      : chosenRelationshipStatus === "rejected"
                        ? t("Your request was declined. Choose another accountant or request again.")
                        : chosenRelationshipStatus === "pending"
                          ? t("Request pending. Sharing unlocks after approval.")
                          : t("Choose an accountant and wait for approval before sharing.")}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </BlurFade>

        <BlurFade delay={0.08} className="mt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-extrabold">{t("Choose documents")}</h2>
            <button
              onClick={() =>
                setPicked(picked.length === sendable.length ? [] : sendable.map((d) => d.id))
              }
              className="text-[12.5px] font-bold text-muted-foreground"
            >
              {t(picked.length === sendable.length ? "Clear" : "Select all")}
            </button>
          </div>

          <Card className="mt-3 divide-y divide-border p-2">
            {sendable.map((d, i) => {
              const on = picked.includes(d.id);
              return (
                <motion.button
                  key={d.id}
                  initial={{ opacity: 0, x: -10, filter: "blur(6px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  transition={{ delay: 0.04 * i, duration: 0.4 }}
                  onClick={() => toggle(d.id)}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  <motion.span
                    animate={on ? { scale: 1, backgroundColor: "var(--primary)" } : { scale: 0.95 }}
                    className={`grid size-6 place-items-center rounded-full ${
                      on ? "text-primary-foreground" : "bg-secondary"
                    }`}
                  >
                    {on && <Check className="size-3.5" strokeWidth={3} />}
                  </motion.span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold">{d.merchant}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {d.category} · {d.date}
                    </div>
                  </div>
                  <div className="num text-[14px]">{d.amount === 0 ? "—" : eur(d.amount)}</div>
                </motion.button>
              );
            })}
            {sendable.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {t("Everything has already been sent.")}
              </p>
            )}
          </Card>
        </BlurFade>

        <BlurFade delay={0.14} className="mt-5">
          {error && (
            <p role="alert" className="mb-3 text-center text-[12px] font-semibold text-destructive">
              {error}
            </p>
          )}
          <Card className="flex items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <Label>{picked.length} {t("selected documents")}</Label>
              <div className="num mt-1 text-[24px]">{eur(total)}</div>
            </div>
            <Btn
              size="lg"
              onClick={() => void submit()}
              disabled={picked.length === 0 || sending || done || !canSend}
            >
              <AnimatePresence mode="wait" initial={false}>
                {done ? (
                  <motion.span
                    key="done"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-2"
                  >
                    <Check className="size-4" strokeWidth={3} /> {t("Delivered")}
                  </motion.span>
                ) : (
                  <motion.span
                    key="send"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2"
                  >
                    <Send className="size-4" /> {t(sending ? "Sending…" : "Send")}
                  </motion.span>
                )}
              </AnimatePresence>
            </Btn>
          </Card>
        </BlurFade>
      </div>
    </div>
  );
}
