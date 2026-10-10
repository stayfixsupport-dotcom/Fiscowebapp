import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Star, X } from "lucide-react";
import { Avatar } from "@/components/kit";
import { supabase } from "@/integrations/supabase/client";
import { sfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";

type ReviewStep = "rating" | "comment" | "confirm" | "done";

type ReviewPickerProps = {
  conversationId: string;
  accountantId: string;
  accountantName?: string;
  accountantPhoto?: string | null;
  accountantFirm?: string;
  serviceCaseId?: string;
  onClose: () => void;
  onSubmitted: () => void;
};

export function ReviewPicker({
  conversationId,
  accountantId,
  accountantName,
  accountantPhoto,
  accountantFirm,
  serviceCaseId,
  onClose,
  onSubmitted,
}: ReviewPickerProps) {
  const t = useT();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState<ReviewStep>("rating");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const displayAccountantName = accountantName?.trim() || t("Accountant");
  const initials = displayAccountantName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const stepIndex = step === "rating" ? 0 : step === "comment" ? 1 : 2;

  const submit = async () => {
    setSaving(true);
    setError("");
    const { error: submitError } = await supabase.rpc(
      "submit_accountant_review" as never,
      {
        p_conversation_id: conversationId,
        p_accountant_id: accountantId,
        p_rating: rating,
        p_comment: comment.trim(),
        p_service_case_id: serviceCaseId ?? null,
      } as never,
    );
    setSaving(false);
    if (submitError) {
      const alreadyReviewed = submitError.message?.toLowerCase().includes("already reviewed");
      if (alreadyReviewed) onSubmitted();
      setError(
        alreadyReviewed
          ? "You already reviewed this accountant."
          : "Your review could not be saved. Please try again.",
      );
      sfx("error");
      return;
    }
    sfx("success");
    onSubmitted();
    setStep("done");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="fixed inset-0 z-[140] grid place-items-center bg-foreground/20 px-4 py-6 backdrop-blur-[16px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-picker-title"
        aria-describedby="review-picker-description"
        initial={{ opacity: 0, y: reducedMotion ? 0 : 22, scale: reducedMotion ? 1 : 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: reducedMotion ? 0 : 12, scale: reducedMotion ? 1 : 0.98 }}
        transition={{ duration: reducedMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
        className="glass w-full max-w-[440px] overflow-hidden rounded-[28px] border border-white/40 p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary">
              {step === "done" ? t("Review submitted") : t("Review your accountant")}
            </p>
            <h2 id="review-picker-title" className="serif mt-1 text-[23px] leading-tight">
              {step === "rating"
                ? t("How was your experience?")
                : step === "comment"
                  ? t("Add a comment")
                  : step === "confirm"
                    ? t("Review your feedback")
                    : t("Thank you for sharing your experience.")}
            </h2>
            <p id="review-picker-description" className="mt-1 text-[12px] text-muted-foreground">
              {step === "rating"
                ? t("Select a star rating to continue.")
                : step === "comment"
                  ? t("Tell other taxpayers what stood out.")
                  : step === "confirm"
                    ? t("Check the details before you send your review.")
                    : t("Your review is now part of this accountant’s profile.")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("Close review")}
            disabled={saving}
            onClick={onClose}
            className="press grid size-9 shrink-0 place-items-center rounded-full bg-secondary/80 disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="my-4 flex items-center gap-3 border-y border-border/60 py-3">
          <Avatar src={accountantPhoto ?? undefined} initials={initials || "AC"} size={46} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-extrabold">{displayAccountantName}</p>
            {accountantFirm && accountantFirm !== displayAccountantName && (
              <p className="truncate text-[11px] text-muted-foreground">{accountantFirm}</p>
            )}
          </div>
          {step === "done" && (
            <motion.span
              initial={{ scale: 0, rotate: -18 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 360, damping: 20 }}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-positive/12 text-positive"
            >
              <Check className="size-5" />
            </motion.span>
          )}
        </div>

        {step !== "done" && (
          <div className="mb-4 flex gap-1.5" aria-label={t(`Step ${stepIndex + 1} of 3`)}>
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={false}
                  animate={{ scaleX: index <= stepIndex ? 1 : 0 }}
                  style={{ transformOrigin: "left" }}
                  transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            ))}
          </div>
        )}

        <div className="min-h-[228px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: reducedMotion ? 0 : 22, filter: "blur(8px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: reducedMotion ? 0 : -18, filter: "blur(6px)" }}
              transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {step === "rating" && (
                <div className="flex min-h-[228px] flex-col items-center justify-center">
                  <div
                    className="flex justify-center gap-2"
                    role="group"
                    aria-label={t("Review rating")}
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <motion.button
                        key={value}
                        type="button"
                        aria-label={`${value} ${t(value === 1 ? "star" : "stars")}`}
                        aria-pressed={rating === value}
                        {...(reducedMotion
                          ? {}
                          : { whileHover: { y: -4, scale: 1.12 }, whileTap: { scale: 0.88 } })}
                        onClick={() => {
                          setRating(value);
                          setError("");
                          sfx("tick");
                        }}
                        className="press grid size-12 place-items-center rounded-full transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <motion.span
                          animate={{ scale: rating >= value ? 1 : 0.82 }}
                          transition={{ type: "spring", stiffness: 420, damping: 18 }}
                        >
                          <Star
                            className={`size-7 ${rating >= value ? "fill-primary text-primary" : "text-muted-foreground/50"}`}
                          />
                        </motion.span>
                      </motion.button>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] font-bold text-muted-foreground">
                    {rating > 0 ? `${rating} / 5` : t("Select a star rating to continue.")}
                  </p>
                </div>
              )}

              {step === "comment" && (
                <div className="grid gap-2 pt-1">
                  <label htmlFor="review-comment" className="sr-only">
                    {t("Review comment")}
                  </label>
                  <textarea
                    id="review-comment"
                    autoFocus={!reducedMotion}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={600}
                    rows={5}
                    placeholder={t("Share a few words (optional)")}
                    className="w-full resize-none rounded-2xl border border-border/70 bg-card/65 px-4 py-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/45"
                  />
                  <p className="text-right text-[10px] tabular-nums text-muted-foreground">
                    {comment.length}/600
                  </p>
                </div>
              )}

              {step === "confirm" && (
                <div className="grid gap-3 rounded-2xl border border-border/60 bg-card/45 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-bold text-muted-foreground">
                      {t("Your rating")}
                    </span>
                    <div className="flex items-center gap-1" aria-label={`${rating} / 5`}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Star
                          key={value}
                          className={`size-4 ${rating >= value ? "fill-primary text-primary" : "text-muted-foreground/40"}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="h-px bg-border/60" />
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground">
                      {t("Review comment")}
                    </p>
                    <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed">
                      {comment.trim() || (
                        <span className="italic text-muted-foreground">
                          {t("No comment added")}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {step === "done" && (
                <motion.div
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.3 }}
                  className="flex min-h-[180px] flex-col items-center justify-center text-center"
                >
                  <p className="text-[12px] text-muted-foreground">
                    {t("Your review is now part of this accountant’s profile.")}
                  </p>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-[11px] font-semibold text-destructive">
            {t(error)}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          {step === "done" ? (
            <span />
          ) : (
            <button
              type="button"
              disabled={step === "rating" || saving}
              onClick={() => {
                setError("");
                setStep(step === "confirm" ? "comment" : "rating");
                sfx("tap");
              }}
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-muted-foreground transition-colors hover:bg-secondary disabled:invisible"
            >
              <ArrowLeft className="size-4" /> {t("Previous step")}
            </button>
          )}
          {step === "rating" && (
            <button
              type="button"
              disabled={rating === 0}
              onClick={() => {
                setStep("comment");
                sfx("tap");
              }}
              className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-[12px] font-extrabold text-primary-foreground disabled:opacity-45"
            >
              {t("Continue to comment")} <ArrowRight className="size-4" />
            </button>
          )}
          {step === "comment" && (
            <button
              type="button"
              onClick={() => {
                setStep("confirm");
                sfx("tap");
              }}
              className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-[12px] font-extrabold text-primary-foreground"
            >
              {t("Review details")} <ArrowRight className="size-4" />
            </button>
          )}
          {step === "confirm" && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-[12px] font-extrabold text-primary-foreground disabled:opacity-50"
            >
              {saving ? t("Saving review…") : t("Submit review")}
              {!saving && <ArrowRight className="size-4" />}
            </button>
          )}
          {step === "done" && (
            <button
              type="button"
              onClick={onClose}
              className="press min-h-11 w-full rounded-full bg-primary px-5 text-[12px] font-extrabold text-primary-foreground"
            >
              {t("Close review")}
            </button>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}
