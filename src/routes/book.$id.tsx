import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, Check } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Btn, Card, Label } from "@/components/kit";
import { fetchAccountant } from "@/lib/accountants";
import { useStore } from "@/lib/app-store";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/ui-prefs";

export const Route = createFileRoute("/book/$id")({
  loader: async ({ params }) => {
    const accountant = await fetchAccountant(params.id);
    if (!accountant) throw notFound();
    return { accountant };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Booking unavailable — Fisco" }, { name: "robots", content: "noindex" }],
      };
    }
    const a = loaderData.accountant;
    const description = `Pick a day and time with ${a.name} at ${a.firm}.`;
    return {
      meta: [
        { title: `Book ${a.firm} — Fisco` },
        { name: "description", content: description },
        { property: "og:title", content: `Book ${a.firm} — Fisco` },
        { property: "og:description", content: description },
      ],
    };
  },
  component: Book,
});

const DAYS = ["Today", "Tomorrow", "Wed", "Thu", "Sun"] as const;
const SLOTS = ["09:00", "10:30", "12:00", "14:00", "15:30", "16:30", "18:00"] as const;

function startsAtFor(day: string, slot: string) {
  const date = new Date();
  if (day === "Tomorrow") {
    date.setDate(date.getDate() + 1);
  } else if (day !== "Today") {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const targetDay = weekdays.indexOf(day);
    const offset = (targetDay - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + offset);
  }
  const [hours, minutes] = slot.split(":").map(Number);
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date;
}

function Book() {
  const t = useT();
  const { accountant } = Route.useLoaderData();
  const navigate = useNavigate();
  const { setAppointment, appointment, choose, role, user } = useStore();
  const [day, setDay] = useState<string>(appointment?.day ?? "Today");
  const [slot, setSlot] = useState<string | null>(appointment?.slot ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!slot || !user?.id || role !== "taxpayer") {
      setError("Sign in as a taxpayer and choose a time to request an appointment.");
      return;
    }
    setSaving(true);
    setError(null);
    const relationshipReady = await choose(accountant.id);
    if (!relationshipReady) {
      setSaving(false);
      setError("Your accountant request could not be saved. Please try again.");
      return;
    }
    const startsAt = startsAtFor(day, slot);
    const { error: requestError } = await supabase.from("appointment_requests" as never).insert({
      accountant_id: accountant.id,
      taxpayer_id: user.id,
      starts_at: startsAt.toISOString(),
      duration_minutes: 45,
      meeting_type: "remote",
      status: "pending",
    } as never);
    setSaving(false);
    if (requestError) {
      setError("The appointment request could not be sent. Please choose another time and retry.");
      return;
    }
    setAppointment({ accountantId: accountant.id, day, slot });
    setConfirmed(true);
    window.setTimeout(() => navigate({ to: "/" }), 1300);
  };

  return (
    <div>
      <PageHeader title={t("Book an appointment")} back />
      <div className="mx-auto w-full max-w-[720px] px-4 pb-32">
        <BlurFade>
          <Card tone="ink" className="flex items-center gap-3 p-5">
            <Avatar src={accountant.photo} initials={accountant.initials} size={50} />
            <div className="min-w-0">
              <div className="truncate text-[16px] font-bold">{accountant.firm}</div>
              <div className="text-[12.5px] text-ink-foreground/55">{accountant.hours}</div>
            </div>
          </Card>
        </BlurFade>

        <BlurFade delay={0.08} className="mt-5">
          <Label>{t("Pick a day")}</Label>
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
            {DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={`press shrink-0 rounded-2xl px-4 py-3 text-[13.5px] font-bold ${
                  day === d ? "bg-ink text-ink-foreground" : "bg-secondary"
                }`}
              >
                {t(d)}
              </button>
            ))}
          </div>
        </BlurFade>

        <BlurFade delay={0.12} className="mt-5">
          <Label>{t("Available times")}</Label>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {SLOTS.map((s, i) => {
              const on = slot === s;
              const unavailable = startsAtFor(day, s).getTime() <= Date.now();
              return (
                <motion.button
                  key={s}
                  initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: 0.03 * i, duration: 0.4 }}
                  onClick={() => setSlot(s)}
                  disabled={unavailable}
                  className={`press num rounded-2xl py-3.5 text-[14px] font-bold ${
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-card shadow-soft text-foreground"
                  }`}
                >
                  {s}
                </motion.button>
              );
            })}
          </div>
        </BlurFade>

        <BlurFade delay={0.16} className="mt-6">
          {error && (
            <p role="alert" className="mb-3 text-center text-[12px] font-semibold text-destructive">
              {t(error)}
            </p>
          )}
          <Btn
            size="lg"
            className="w-full"
            onClick={() => void confirm()}
            disabled={!slot || saving || confirmed}
          >
            <AnimatePresence mode="wait" initial={false}>
              {confirmed ? (
                <motion.span
                  key="ok"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-2"
                >
                  <Check className="size-4" strokeWidth={3} /> {t("Request sent")}
                </motion.span>
              ) : (
                <motion.span
                  key="book"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2"
                >
                  <CalendarCheck className="size-4" />
                  {saving
                    ? t("Sending request…")
                    : slot
                      ? `${t("Request")} ${t(day)} · ${slot}`
                      : t("Select a time")}
                </motion.span>
              )}
            </AnimatePresence>
          </Btn>
        </BlurFade>
      </div>
    </div>
  );
}
