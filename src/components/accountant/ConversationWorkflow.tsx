import { useCallback, useEffect, useState } from "react";
import { BriefcaseBusiness, CalendarClock, Check, Clock3, Star, X } from "lucide-react";
import type { Role } from "@/lib/app-store";
import { ReviewPicker } from "@/components/accountant/ReviewPicker";
import { supabase } from "@/integrations/supabase/client";
import { sfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";

type ServiceCase = {
  id: string;
  accountant_id: string;
  taxpayer_id: string;
  created_by: string;
  title: string;
  description: string;
  status: "proposed" | "accepted" | "in_progress" | "completed" | "cancelled";
  quoted_amount: number | null;
  counter_amount: number | null;
  currency_code: string;
  completed_at: string | null;
  created_at: string;
};

type Appointment = {
  id: string;
  proposed_by: string;
  starts_at: string;
  duration_minutes: number;
  meeting_type: "remote" | "office" | "client_site";
  note: string;
  status: "proposed" | "confirmed" | "declined" | "cancelled";
};

type Conversation = {
  id: string;
  accountant_id: string;
  taxpayer_id: string;
  accountant_work_completed_at: string | null;
  review_prompt_dismissed_at: string | null;
};

type ConversationWorkflowProps = {
  conversationId: string;
  userId: string;
  role: Role;
  accountantName?: string;
  accountantPhoto?: string;
  accountantFirm?: string;
  initiallyExpanded?: boolean;
  messageCount?: number;
};

const CASE_SELECT =
  "id, accountant_id, taxpayer_id, created_by, title, description, status, quoted_amount, counter_amount, currency_code, completed_at, created_at";
const APPOINTMENT_SELECT =
  "id, proposed_by, starts_at, duration_minutes, meeting_type, note, status";

export function ConversationWorkflow({
  conversationId,
  userId,
  role,
  accountantName,
  accountantPhoto,
  accountantFirm,
  initiallyExpanded = false,
  messageCount = 0,
}: ConversationWorkflowProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [cases, setCases] = useState<ServiceCase[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [hasReviewedAccountant, setHasReviewedAccountant] = useState<boolean | null>(null);
  const [currencyCode, setCurrencyCode] = useState("EUR");
  const [caseFormOpen, setCaseFormOpen] = useState(false);
  const [appointmentFormOpen, setAppointmentFormOpen] = useState(false);
  const [caseTitle, setCaseTitle] = useState("");
  const [caseDescription, setCaseDescription] = useState("");
  const [quote, setQuote] = useState("");
  const [counterValues, setCounterValues] = useState<Record<string, string>>({});
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentNote, setAppointmentNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [{ data: conversationData }, { data: caseData }, { data: appointmentData }] =
      await Promise.all([
        supabase
          .from("conversations" as never)
          .select(
            "id, accountant_id, taxpayer_id, accountant_work_completed_at, review_prompt_dismissed_at",
          )
          .eq("id", conversationId)
          .maybeSingle(),
        supabase
          .from("service_cases" as never)
          .select(CASE_SELECT)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("appointments" as never)
          .select(APPOINTMENT_SELECT)
          .eq("conversation_id", conversationId)
          .order("starts_at", { ascending: true }),
      ]);
    setConversation((conversationData as unknown as Conversation | null) ?? null);
    setCases((caseData as unknown as ServiceCase[] | null) ?? []);
    setAppointments((appointmentData as unknown as Appointment[] | null) ?? []);
    const accountantId = (conversationData as unknown as Conversation | null)?.accountant_id;
    if (accountantId) {
      const { data: accountantData } = await supabase
        .from("accountants" as never)
        .select("currency_code")
        .eq("id", accountantId)
        .maybeSingle();
      const code = (accountantData as unknown as { currency_code?: string } | null)?.currency_code;
      if (code && /^[A-Z]{3}$/.test(code)) setCurrencyCode(code);
    }

    const currentConversation = conversationData as unknown as Conversation | null;
    if (role === "taxpayer" && currentConversation?.accountant_id) {
      const { data: reviewed, error: reviewStatusError } = await supabase.rpc(
        "has_reviewed_accountant" as never,
        {
          p_accountant_id: currentConversation.accountant_id,
        } as never,
      );
      setHasReviewedAccountant(reviewStatusError ? null : reviewed === true);
    } else {
      setHasReviewedAccountant(null);
    }
  }, [conversationId, role]);

  const completedAt = [
    conversation?.accountant_work_completed_at ?? null,
    ...cases
      .filter((serviceCase) => serviceCase.status === "completed")
      .map((serviceCase) => serviceCase.completed_at),
  ].reduce<string | null>(
    (latest, candidate) => (candidate && (!latest || candidate > latest) ? candidate : latest),
    null,
  );
  const dismissedAt = conversation?.review_prompt_dismissed_at ?? null;
  const completedAfterDismissal = Boolean(
    completedAt && (!dismissedAt || completedAt > dismissedAt),
  );
  const reviewPromptEligible =
    role === "taxpayer" &&
    hasReviewedAccountant === false &&
    conversation?.id === conversationId &&
    Boolean(conversation.accountant_id) &&
    ((messageCount >= 10 && !dismissedAt) || completedAfterDismissal);

  useEffect(() => {
    if (reviewPromptEligible && !reviewOpen) {
      setExpanded(true);
      setReviewOpen(true);
    }
  }, [reviewOpen, reviewPromptEligible]);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`conversation-workflow:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "service_cases" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, refresh)
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [conversationId, refresh]);

  const save = async (operation: () => PromiseLike<{ error: unknown }>) => {
    setSaving(true);
    setError(null);
    try {
      const result = await operation();
      if (result.error) throw result.error;
      sfx("success");
      await refresh();
      return true;
    } catch {
      sfx("error");
      setError("That update could not be saved. Check the conversation status and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const createCase = async () => {
    if (!conversation || !caseTitle.trim() || !userId) return;
    const amount = quote.trim() ? Number(quote) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError("Enter a valid quote.");
      return;
    }
    const created = await save(() =>
      supabase.from("service_cases" as never).insert({
        conversation_id: conversationId,
        accountant_id: conversation.accountant_id,
        taxpayer_id: conversation.taxpayer_id,
        created_by: userId,
        title: caseTitle.trim(),
        description: caseDescription.trim(),
        quoted_amount: amount,
        currency_code: currencyCode,
      } as never),
    );
    if (created) {
      setCaseTitle("");
      setCaseDescription("");
      setQuote("");
      setCaseFormOpen(false);
    }
  };

  const createAppointment = async () => {
    if (!conversation || !appointmentTime) return;
    const startsAt = new Date(appointmentTime);
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError("Choose a future date and time.");
      return;
    }
    const created = await save(() =>
      supabase.from("appointments" as never).insert({
        conversation_id: conversationId,
        accountant_id: conversation.accountant_id,
        taxpayer_id: conversation.taxpayer_id,
        proposed_by: userId,
        starts_at: startsAt.toISOString(),
        duration_minutes: 45,
        meeting_type: "remote",
        note: appointmentNote.trim(),
      } as never),
    );
    if (created) {
      setAppointmentTime("");
      setAppointmentNote("");
      setAppointmentFormOpen(false);
    }
  };

  const updateCase = async (serviceCase: ServiceCase, patch: Partial<ServiceCase>) => {
    await save(() =>
      supabase
        .from("service_cases" as never)
        .update(patch as never)
        .eq("id", serviceCase.id),
    );
  };

  const dismissReviewPrompt = () => {
    setReviewOpen(false);
    setConversation((current) =>
      current ? { ...current, review_prompt_dismissed_at: new Date().toISOString() } : current,
    );
    void supabase
      .rpc(
        "dismiss_accountant_review_prompt" as never,
        { p_conversation_id: conversationId } as never,
      )
      .then(({ error: dismissError }) => {
        if (dismissError) {
          setError("That update could not be saved. Check the conversation status and try again.");
        } else {
          void refresh();
        }
      });
  };

  return (
    <section className="mx-auto w-full max-w-[560px] px-4 pb-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((value) => !value);
          sfx("tap");
        }}
        className="press flex w-full items-center justify-between rounded-2xl border border-border/70 bg-card/60 px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[12px] font-extrabold">
          <BriefcaseBusiness className="size-4 text-primary" /> {t("Work & appointments")}
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground">
          {cases.length} {t("work")} · {appointments.length} {t("dates")}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 max-h-[42dvh] space-y-2 overflow-y-auto rounded-2xl border border-border/60 bg-card/70 p-3">
          {role === "taxpayer" && reviewPromptEligible && (
            <button
              type="button"
              onClick={() => {
                setReviewOpen(true);
              }}
              className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[11px] font-bold"
            >
              <Star className="size-3.5" /> {t("Review accountant")}
            </button>
          )}
          {role === "accountant" && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCaseFormOpen((value) => !value)}
                className="press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-[11px] font-bold text-primary-foreground"
              >
                <BriefcaseBusiness className="size-3.5" /> {t("Propose work")}
              </button>
              <button
                type="button"
                onClick={() => setAppointmentFormOpen((value) => !value)}
                className="press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-[11px] font-bold"
              >
                <CalendarClock className="size-3.5" /> {t("Suggest appointment")}
              </button>
              {!completedAt && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void save(() =>
                      supabase.rpc(
                        "mark_conversation_work_complete" as never,
                        { p_conversation_id: conversationId } as never,
                      ),
                    )
                  }
                  className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[11px] font-bold disabled:opacity-50"
                >
                  <Check className="size-3.5" /> {t("Mark work complete")}
                </button>
              )}
            </div>
          )}

          {role === "taxpayer" && completedAt && (
            <p className="inline-flex items-center gap-1.5 px-1 text-[11px] font-bold text-positive">
              <Check className="size-3.5" /> {t("Work complete")}
            </p>
          )}

          {caseFormOpen && role === "accountant" && (
            <div className="grid gap-2 rounded-xl border border-border/60 p-3">
              <input
                value={caseTitle}
                onChange={(event) => setCaseTitle(event.target.value)}
                maxLength={120}
                placeholder={t("Work title")}
                aria-label={t("Work proposal title")}
                className="h-10 rounded-lg border border-border bg-background px-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <textarea
                value={caseDescription}
                onChange={(event) => setCaseDescription(event.target.value)}
                maxLength={1200}
                placeholder={t("What is included?")}
                aria-label={t("Work proposal details")}
                className="min-h-16 rounded-lg border border-border bg-background px-3 py-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-[11px] text-muted-foreground">
                {t("Quote")} ({currencyCode})
                <input
                  inputMode="decimal"
                  value={quote}
                  onChange={(event) => setQuote(event.target.value)}
                  placeholder={t("Optional")}
                  aria-label={t("Quoted amount in euros")}
                  className="min-w-0 flex-1 bg-transparent text-right text-[12px] text-foreground outline-none"
                />
              </label>
              <button
                type="button"
                disabled={saving || caseTitle.trim().length < 2}
                onClick={() => void createCase()}
                className="press min-h-9 rounded-full bg-primary px-4 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
              >
                {t("Send proposal")}
              </button>
            </div>
          )}

          {appointmentFormOpen && role === "accountant" && (
            <div className="grid gap-2 rounded-xl border border-border/60 p-3">
              <label className="grid gap-1 text-[10px] font-bold text-muted-foreground">
                {t("Date and time")} ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                <input
                  type="datetime-local"
                  value={appointmentTime}
                  onChange={(event) => setAppointmentTime(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                />
              </label>
              <input
                value={appointmentNote}
                onChange={(event) => setAppointmentNote(event.target.value)}
                maxLength={500}
                placeholder={t("Note for the taxpayer")}
                aria-label={t("Appointment note")}
                className="h-10 rounded-lg border border-border bg-background px-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <button
                type="button"
                disabled={saving || !appointmentTime}
                onClick={() => void createAppointment()}
                className="press min-h-9 rounded-full bg-primary px-4 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
              >
                {t("Send appointment")}
              </button>
            </div>
          )}

          {cases.map((serviceCase) => (
            <article
              key={serviceCase.id}
              className="rounded-xl border border-border/60 bg-background/65 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[12px] font-extrabold">{serviceCase.title}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {serviceCase.description}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
                    {serviceCase.quoted_amount !== null
                      ? `${t("Quote")} ${new Intl.NumberFormat(undefined, { style: "currency", currency: serviceCase.currency_code }).format(Number(serviceCase.quoted_amount))}`
                      : t("Quote not set")}
                    {serviceCase.counter_amount !== null
                      ? ` · ${t("Counter")} ${new Intl.NumberFormat(undefined, { style: "currency", currency: serviceCase.currency_code }).format(Number(serviceCase.counter_amount))}`
                      : ""}
                    {` · ${t(serviceCase.status.replaceAll("_", " "))}`}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[9px] font-bold uppercase">
                  {t(serviceCase.status.replaceAll("_", " "))}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {role === "taxpayer" && serviceCase.status === "proposed" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void updateCase(serviceCase, { status: "accepted" })}
                      className="press inline-flex min-h-8 items-center gap-1 rounded-full bg-primary px-2.5 text-[10px] font-bold text-primary-foreground"
                    >
                      <Check className="size-3" /> {t("Accept")}
                    </button>
                    <label className="flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 text-[10px] font-semibold">
                      {t("Counter")} {currencyCode}
                      <input
                        inputMode="decimal"
                        aria-label={t("Counter offer in euros")}
                        value={counterValues[serviceCase.id] ?? ""}
                        className="w-16 bg-transparent text-[10px] outline-none"
                        onChange={(event) =>
                          setCounterValues((previous) => ({
                            ...previous,
                            [serviceCase.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      disabled={
                        saving ||
                        !counterValues[serviceCase.id]?.trim() ||
                        !Number.isFinite(Number(counterValues[serviceCase.id])) ||
                        Number(counterValues[serviceCase.id]) < 0
                      }
                      onClick={() => {
                        const amount = Number(counterValues[serviceCase.id]);
                        void updateCase(serviceCase, { counter_amount: amount });
                        setCounterValues((previous) => ({ ...previous, [serviceCase.id]: "" }));
                      }}
                      className="press min-h-8 rounded-full border border-border px-2.5 text-[10px] font-bold disabled:opacity-50"
                    >
                      {t("Send counter")}
                    </button>
                  </>
                )}
                {role === "accountant" && serviceCase.counter_amount !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      void updateCase(serviceCase, {
                        quoted_amount: serviceCase.counter_amount,
                        status: "accepted",
                      })
                    }
                    className="press min-h-8 rounded-full bg-primary px-2.5 text-[10px] font-bold text-primary-foreground"
                  >
                    {t("Accept counter")}
                  </button>
                )}
                {role === "accountant" && ["proposed", "accepted"].includes(serviceCase.status) && (
                  <button
                    type="button"
                    onClick={() => void updateCase(serviceCase, { status: "in_progress" })}
                    className="press min-h-8 rounded-full border border-border px-2.5 text-[10px] font-bold"
                  >
                    {t("Start work")}
                  </button>
                )}
                {role === "accountant" && serviceCase.status === "in_progress" && (
                  <button
                    type="button"
                    onClick={() => void updateCase(serviceCase, { status: "completed" })}
                    className="press min-h-8 rounded-full bg-primary px-2.5 text-[10px] font-bold text-primary-foreground"
                  >
                    {t("Mark complete")}
                  </button>
                )}
              </div>
            </article>
          ))}

          {appointments.map((appointment) => {
            const canRespond =
              role === "taxpayer" &&
              appointment.proposed_by !== userId &&
              appointment.status === "proposed";
            return (
              <article
                key={appointment.id}
                className="flex items-start gap-2 rounded-xl border border-border/60 bg-background/65 p-3"
              >
                <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[11px] font-extrabold">
                    {new Date(appointment.starts_at).toLocaleString()} ·{" "}
                    {appointment.duration_minutes} min
                  </h3>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {appointment.note || t("Appointment proposal")} · {t(appointment.status)}
                  </p>
                  {canRespond && (
                    <div className="mt-2 flex gap-1.5">
                      {(["confirmed", "declined"] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() =>
                            void save(() =>
                              supabase
                                .from("appointments" as never)
                                .update({ status } as never)
                                .eq("id", appointment.id),
                            )
                          }
                          className="press inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 text-[10px] font-bold"
                        >
                          {status === "confirmed" ? (
                            <Check className="size-3" />
                          ) : (
                            <X className="size-3" />
                          )}
                          {status === "confirmed" ? t("Confirm") : t("Decline")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          {error && (
            <p role="alert" className="px-1 text-[10px] font-semibold text-destructive">
              {t(error)}
            </p>
          )}
          {!cases.length && !appointments.length && !caseFormOpen && !appointmentFormOpen && (
            <p className="px-1 py-2 text-center text-[10px] text-muted-foreground">
              {t("Work plans, quotes, appointments, and completion reviews will appear here.")}
            </p>
          )}
        </div>
      )}
      {reviewOpen && conversation && role === "taxpayer" && (
        <ReviewPicker
          conversationId={conversationId}
          accountantId={conversation.accountant_id}
          accountantName={accountantName || t("Accountant")}
          accountantPhoto={accountantPhoto}
          accountantFirm={accountantFirm}
          serviceCaseId={cases.find((serviceCase) => serviceCase.status === "completed")?.id}
          onSubmitted={() => setHasReviewedAccountant(true)}
          onClose={dismissReviewPrompt}
        />
      )}
    </section>
  );
}
