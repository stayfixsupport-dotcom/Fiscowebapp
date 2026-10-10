import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  Languages,
  MapPin,
  Phone,
  ShieldCheck,
  Star,
  Video,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ReviewPicker } from "@/components/accountant/ReviewPicker";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Btn, Card, Label, Live, Stars } from "@/components/kit";
import { fetchAccountant, fetchAccountantReviews } from "@/lib/accountants";
import { fmtKm } from "@/lib/geo";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode, translateWeekdayLabels } from "@/lib/i18n";
import { formatMoney } from "@/lib/practice-profile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/accountants/$id")({
  loader: async ({ params }) => {
    const [accountant, reviews] = await Promise.all([
      fetchAccountant(params.id),
      fetchAccountantReviews(params.id),
    ]);
    return { accountant, reviews };
  },
  head: ({ loaderData }) => {
    if (!loaderData?.accountant) {
      return {
        meta: [{ title: "Accountant unavailable" }, { name: "robots", content: "noindex" }],
      };
    }
    const a = loaderData.accountant;
    const description = `${a.firm} · ${a.specialties.join(", ")} · ${a.address}. Rated ${a.rating}/5 by ${a.reviews} clients.`;
    return {
      meta: [
        { title: `${a.firm} — verified accountant` },
        { name: "description", content: description },
        { property: "og:title", content: `${a.firm} — verified accountant` },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:image", content: a.photo },
        { name: "twitter:image", content: a.photo },
      ],
    };
  },
  component: AccountantDetail,
});
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const EASE = [0.16, 1, 0.3, 1] as const;

function formatInternationalPhone(phone: string, phoneCountryCode?: string) {
  try {
    const countryCode = /^[A-Z]{2}$/i.test(phoneCountryCode ?? "")
      ? (phoneCountryCode?.toUpperCase() as CountryCode)
      : undefined;
    return parsePhoneNumberFromString(phone, countryCode)?.formatInternational() ?? phone;
  } catch {
    return phone;
  }
}

function formatLocalizedMoney(amount: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return formatMoney(amount, currency);
  }
}

function AccountantDetail() {
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale = localeCode(preferences.language);
  const { accountant: remoteAccountant, reviews } = Route.useLoaderData();
  const { id } = Route.useParams();
  const { ranked, accountants, choose, chosenId, chosenRelationshipStatus, role, user } =
    useStore();
  const accountantIdForReview =
    remoteAccountant?.id ?? accountants.find((item) => item.id === id)?.id;
  const [profileReviews, setProfileReviews] = useState(reviews);
  const [reviewConversationId, setReviewConversationId] = useState<string | null>(null);
  const [reviewCaseId, setReviewCaseId] = useState<string | null>(null);
  const [canReviewAccountant, setCanReviewAccountant] = useState(false);
  const [hasReviewedAccountant, setHasReviewedAccountant] = useState(false);
  const [profileReviewOpen, setProfileReviewOpen] = useState(false);
  const { scrollY } = useScroll();
  const previousScrollY = useRef(0);
  const hasObservedScroll = useRef(false);
  const [bookingBarVisible, setBookingBarVisible] = useState(true);
  const reduceMotion = useReducedMotion();

  useMotionValueEvent(scrollY, "change", (current) => {
    if (!hasObservedScroll.current) {
      previousScrollY.current = current;
      hasObservedScroll.current = true;
      return;
    }
    const delta = current - previousScrollY.current;
    previousScrollY.current = current;
    if (current < 72 || delta < -3) setBookingBarVisible(true);
    else if (delta > 3) setBookingBarVisible(false);
  });

  useEffect(() => {
    let active = true;
    if (role !== "taxpayer" || !user?.id || !accountantIdForReview) {
      setReviewConversationId(null);
      setReviewCaseId(null);
      setCanReviewAccountant(false);
      setHasReviewedAccountant(false);
      return () => {
        active = false;
      };
    }

    const loadReviewEligibility = async () => {
      const [{ data: relationship }, { data: cases }, { data: conversation }] = await Promise.all([
        supabase
          .from("accountant_clients" as never)
          .select("status")
          .eq("accountant_id", accountantIdForReview)
          .eq("taxpayer_id", user.id)
          .maybeSingle(),
        supabase
          .from("service_cases" as never)
          .select("id, conversation_id")
          .eq("accountant_id", accountantIdForReview)
          .eq("taxpayer_id", user.id)
          .eq("status", "completed"),
        supabase
          .from("conversations" as never)
          .select("id")
          .eq("accountant_id", accountantIdForReview)
          .eq("taxpayer_id", user.id)
          .maybeSingle(),
      ]);
      if (!active) return;
      const relationshipActive =
        (relationship as unknown as { status: string } | null)?.status === "active" ||
        (chosenId === accountantIdForReview && chosenRelationshipStatus === "active");
      const completedCase =
        ((cases ?? []) as unknown as Array<{ id: string; conversation_id: string }>)[0] ?? null;
      const conversationData = conversation as unknown as { id: string } | null;
      const conversationId = conversationData?.id ?? completedCase?.conversation_id ?? null;
      setReviewConversationId(conversationId);
      setReviewCaseId(completedCase?.id ?? null);
      if (!conversationId) {
        setCanReviewAccountant(false);
        setHasReviewedAccountant(null);
        return;
      }

      const { data: reviewed } = await supabase.rpc(
        "has_reviewed_accountant" as never,
        {
          p_accountant_id: accountantIdForReview,
        } as never,
      );
      if (!active) return;
      const hasReviewed = reviewed === true;
      setHasReviewedAccountant(hasReviewed);
      setCanReviewAccountant(relationshipActive && !hasReviewed);
    };

    void loadReviewEligibility();
    const relationshipChannel = supabase
      .channel(`accountant-profile-review:${user.id}:${accountantIdForReview}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accountant_clients",
          filter: `taxpayer_id=eq.${user.id}`,
        },
        () => void loadReviewEligibility(),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(relationshipChannel);
    };
  }, [accountantIdForReview, chosenId, chosenRelationshipStatus, role, user?.id]);

  const accountant = remoteAccountant ?? accountants.find((item) => item.id === id);
  if (!accountant) {
    return (
      <main className="min-h-screen pb-32">
        <PageHeader title={t("Accountant unavailable")} back />
        <div className="mx-auto grid max-w-[520px] place-items-center px-5 py-16 text-center">
          <div className="glass w-full rounded-[26px] p-6">
            <div className="text-[16px] font-extrabold">
              {t("This profile isn’t available yet")}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {t(
                "The accountant may not have published a profile yet. Browse nearby listings to find another professional.",
              )}
            </p>
            <Link
              to="/map"
              className="press mt-5 inline-flex rounded-full bg-primary px-4 py-2.5 text-[13px] font-bold text-primary-foreground"
            >
              {t("Browse accountants")}
            </Link>
          </div>
        </div>
      </main>
    );
  }
  const withDistance = ranked.find((a) => a.id === accountant.id);
  const mine = chosenId === accountant.id;
  const relationshipStatus = mine ? chosenRelationshipStatus : null;
  const mapDestination =
    Number.isFinite(accountant.lat) && Number.isFinite(accountant.lng)
      ? `${accountant.lat},${accountant.lng}`
      : accountant.address;
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapDestination)}&travelmode=driving`;

  return (
    <div className="w-full min-w-0 overflow-x-clip">
      <PageHeader title={accountant.firm} back />

      <div className="mx-auto w-full min-w-0 max-w-[760px] px-3.5 pb-36">
        {/* ---------- hero ---------- */}
        <BlurFade>
          <div className="glass relative overflow-hidden rounded-[30px]">
            {/* ambient wash, drifting under the glass */}
            <motion.div
              aria-hidden
              className="ambient-glow pointer-events-none absolute -top-24 -right-16 size-72 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(closest-side, oklch(0.78 0.15 44 / 0.22), transparent)",
              }}
              animate={{ x: [0, -20, 0], y: [0, 14, 0] }}
              transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              aria-hidden
              className="ambient-glow pointer-events-none absolute -bottom-28 -left-16 size-72 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(closest-side, oklch(0.68 0.13 265 / 0.18), transparent)",
              }}
              animate={{ x: [0, 24, 0], y: [0, -12, 0] }}
              transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative p-5 sm:p-6">
              <div className="flex items-center gap-3.5">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0, filter: "blur(12px)" }}
                  animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                  transition={{ duration: 0.7, ease: EASE }}
                >
                  <Avatar
                    src={accountant.photo}
                    initials={accountant.initials}
                    size={72}
                    ring={mine}
                  />
                </motion.div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2 className="serif truncate text-[26px] leading-[1.05] sm:text-[30px]">
                      {accountant.name}
                    </h2>
                    {accountant.verified && <BadgeCheck className="size-4 shrink-0 text-primary" />}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                    <Stars rating={accountant.rating} className="text-foreground" />
                    <span className="opacity-40">·</span>
                    <span className="num">
                      {accountant.reviews} {t("reviews")}
                    </span>
                    {withDistance && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="num">{fmtKm(withDistance.km)}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-bold">
                    {accountant.holiday ? (
                      <span className="text-muted-foreground">
                        {t("On holiday")}
                        {accountant.holidayUntil ? ` ${t("until")} ${accountant.holidayUntil}` : ""}
                      </span>
                    ) : accountant.availableNow ? (
                      <>
                        <Live /> {t("Open now")}
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {accountant.nextSlot
                          ? `${t("Next")} · ${translateWeekdayLabels(accountant.nextSlot, t)}`
                          : t("Offline")}
                      </span>
                    )}
                  </div>
                  {role === "taxpayer" && relationshipStatus && (
                    <div
                      className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                        relationshipStatus === "active"
                          ? "bg-positive/12 text-positive"
                          : relationshipStatus === "pending"
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {relationshipStatus === "active"
                        ? t("Request accepted")
                        : relationshipStatus === "pending"
                          ? t("Awaiting accountant approval")
                          : t("Request declined")}
                    </div>
                  )}
                </div>
              </div>

              <motion.span
                aria-hidden
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 1.3, delay: 0.3, ease: EASE }}
                className="mt-5 block h-px w-full origin-left bg-gradient-to-r from-foreground/18 to-transparent"
              />

              <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
                {t(accountant.bio)}
              </p>

              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {accountant.specialties.map((s, i) => (
                  <motion.span
                    key={s}
                    initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ delay: 0.18 + 0.05 * i, duration: 0.5, ease: EASE }}
                    className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[11px] font-bold backdrop-blur-xl"
                  >
                    {t(s)}
                  </motion.span>
                ))}
              </div>
            </div>
          </div>
        </BlurFade>

        {/* ---------- practice facts ---------- */}
        <BlurFade delay={0.16} className="mt-2.5 block">
          <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            {[
              { icon: MapPin, label: "Address", value: accountant.address },
              ...(accountant.phone
                ? [
                    {
                      icon: Phone,
                      label: "Phone",
                      value: formatInternationalPhone(
                        accountant.phone,
                        accountant.phoneCountryCode,
                      ),
                    },
                  ]
                : []),
              ...(accountant.languages.length
                ? [{ icon: Languages, label: "Languages", value: accountant.languages.join(", ") }]
                : []),
              ...(accountant.verified
                ? [{ icon: ShieldCheck, label: "Registration", value: "Verified by Fisco" }]
                : []),
            ].map((row) => (
              <motion.div
                key={row.label}
                whileHover={{ y: -2 }}
                onPointerEnter={() => sfx("hover")}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
                className="glass flex w-full min-w-0 items-center gap-3 rounded-[22px] p-3.5"
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-secondary/80">
                  <row.icon className="size-4" strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <Label className="text-[9px]">{t(row.label)}</Label>
                  <div
                    className={`min-w-0 text-[13px] font-bold ${row.label === "Address" ? "truncate" : "break-words"}`}
                    title={row.label === "Address" ? row.value : undefined}
                  >
                    {row.label === "Phone" ? <bdi dir="ltr">{row.value}</bdi> : row.value}
                  </div>
                  {row.label === "Address" && role === "taxpayer" && (
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="press mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full bg-secondary/80 px-3 text-[11px] font-bold text-foreground hover:bg-secondary"
                    >
                      <MapPin className="size-3.5" />
                      {t("Open in Google Maps")}
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </BlurFade>

        <BlurFade delay={0.18} className="mt-3 block">
          <section className="glass rounded-[24px] p-4 sm:p-5" aria-labelledby="practice-details">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="practice-details" className="text-[15px] font-extrabold">
                  {t("Practice details")}
                </h2>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {t("Rates and availability set by the accountant")}
                </p>
              </div>
              <div className="text-right">
                <div className="num text-[20px] font-extrabold">
                  {formatLocalizedMoney(accountant.price, accountant.currencyCode, locale)}
                </div>
                <div className="text-[11px] text-muted-foreground">{t(accountant.pricing)}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-2.5 text-[12px]">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <div className="font-bold">{t("Bookable times")}</div>
                  <div className="mt-1 text-muted-foreground">
                    {accountant.days.length
                      ? accountant.days.map((day) => t(day)).join(", ")
                      : t("No schedule published")}
                    {accountant.slots.length > 0 && ` · ${accountant.slots.join(", ")}`}
                    {accountant.days.length > 0 && ` · ${accountant.slotMinutes} ${t("min")}`}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 text-[12px]">
                <Video className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <div className="font-bold">{t("Consultation options")}</div>
                  <div className="mt-1 text-muted-foreground">
                    {[
                      accountant.remote ? t("Remote") : null,
                      accountant.homeVisits ? t("Client visits") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("Contact for consultation options")}
                  </div>
                </div>
              </div>
              <div className="text-[12px]">
                <div className="font-bold">{t("Booking and response")}</div>
                <div className="mt-1 text-muted-foreground">
                  {accountant.autoAccept
                    ? t("Requests are auto-accepted")
                    : t("Requests are reviewed")}
                  {` · ${t("Reply within")} ${accountant.responseHours} ${t("h")}`}
                </div>
              </div>
              <div className="text-[12px]">
                <div className="font-bold">{t("Capacity and introduction")}</div>
                <div className="mt-1 text-muted-foreground">
                  {accountant.maxClients} {t("clients")}
                  {accountant.freeIntro && ` · ${t("Free 15-min intro call")}`}
                </div>
              </div>
            </div>
            {(accountant.websiteUrl || accountant.bookingUrl) && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                {[
                  [accountant.websiteUrl, t("Website")],
                  [accountant.bookingUrl, t("Booking page")],
                ].map(([url, label]) =>
                  url ? (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary/80 px-3 text-[11px] font-bold hover:bg-secondary"
                    >
                      {label} <ArrowUpRight className="size-3.5" />
                    </a>
                  ) : null,
                )}
              </div>
            )}
          </section>
        </BlurFade>

        <BlurFade delay={0.2} className="mt-3 block">
          <section className="glass rounded-[24px] p-4 sm:p-5" aria-labelledby="accountant-reviews">
            <div className="flex items-center justify-between gap-3">
              <h2 id="accountant-reviews" className="text-[15px] font-extrabold">
                {t("Client reviews")}
              </h2>
              <span className="num text-[11px] text-muted-foreground">
                {accountant.rating.toFixed(1)} · {accountant.reviews}
              </span>
            </div>
            {profileReviews.length ? (
              <div className="mt-3 divide-y divide-border/60">
                {profileReviews.map((review) => (
                  <article key={review.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar
                          src={review.reviewerPhoto ?? undefined}
                          initials={review.reviewerName.slice(0, 1).toUpperCase() || "T"}
                          size={34}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-bold">{review.reviewerName}</p>
                          <Stars rating={review.rating} className="text-foreground" />
                        </div>
                      </div>
                      <time className="text-[10px] text-muted-foreground">
                        {new Date(review.createdAt).toLocaleDateString(locale)}
                      </time>
                    </div>
                    {review.comment && (
                      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                        {review.comment}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-muted-foreground">
                {t("No completed-service reviews yet.")}
              </p>
            )}
            {role === "taxpayer" && user?.id && canReviewAccountant && (
              <div className="mt-4 border-t border-border/60 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setProfileReviewOpen(true);
                    sfx("open");
                  }}
                  className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-[12px] font-bold text-primary-foreground"
                >
                  <Star className="size-4" /> {t("Add review")}
                </button>
              </div>
            )}
            {role === "taxpayer" && user?.id && hasReviewedAccountant && (
              <p className="mt-4 border-t border-border/60 pt-3 text-[11px] font-semibold text-muted-foreground">
                {t("You already reviewed this accountant.")}
              </p>
            )}
          </section>
        </BlurFade>
      </div>

      {profileReviewOpen && reviewConversationId && accountantIdForReview && (
        <ReviewPicker
          conversationId={reviewConversationId}
          accountantId={accountantIdForReview}
          accountantName={accountant.name}
          accountantPhoto={accountant.photo}
          accountantFirm={accountant.firm}
          serviceCaseId={reviewCaseId ?? undefined}
          onSubmitted={() => {
            setHasReviewedAccountant(true);
            setCanReviewAccountant(false);
            setReviewCaseId(null);
            void fetchAccountantReviews(accountantIdForReview).then(setProfileReviews);
          }}
          onClose={() => setProfileReviewOpen(false)}
        />
      )}

      {/* ---------- sticky action bar ---------- */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{
          y: bookingBarVisible || reduceMotion ? 0 : 64,
          opacity: bookingBarVisible ? 1 : 0,
        }}
        transition={{
          duration: reduceMotion ? 0.15 : 0.35,
          delay: bookingBarVisible ? 0.15 : 0,
          ease: EASE,
        }}
        aria-hidden={!bookingBarVisible}
        inert={!bookingBarVisible}
        className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 px-3.5"
        style={{ pointerEvents: bookingBarVisible ? "auto" : "none" }}
      >
        <div className="glass mx-auto flex max-w-[680px] gap-2 rounded-[24px] p-2 pr-14 sm:pr-2">
          {role === "taxpayer" && (
            <Btn
              className="flex-1"
              variant={
                relationshipStatus === "active" || relationshipStatus === "pending"
                  ? "ghost"
                  : "accent"
              }
              disabled={relationshipStatus === "pending" || relationshipStatus === "active"}
              onClick={() => {
                sfx("select");
                void choose(accountant.id);
              }}
            >
              {relationshipStatus === "active"
                ? t("Your accountant")
                : relationshipStatus === "pending"
                  ? t("Request pending")
                  : relationshipStatus === "rejected"
                    ? t("Request again")
                    : t("Choose")}
            </Btn>
          )}
          <Link to="/book/$id" params={{ id: accountant.id }} className="flex-1">
            <Btn variant="ink" className="w-full" onClick={() => sfx("tap")}>
              {t("Book a slot")}
            </Btn>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
