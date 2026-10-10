import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  ChevronRight,
  Clock,
  FileText,
  Inbox,
  LineChart,
  ScanLine,
  Send,
  Users,
} from "lucide-react";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Card, Chip, Label, Stars } from "@/components/kit";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { PageHeader } from "@/components/PageHeader";
import { FeeAnalyticsPanel } from "@/components/accountant/FeeAnalyticsPanel";
import { eur } from "@/lib/data";
import { fmtKm, PRECISE_LOCATION_ACCURACY_METERS } from "@/lib/geo";
import { useStore } from "@/lib/app-store";
import { compactPracticeLocation } from "@/lib/practice-profile";
import { sfx } from "@/lib/sfx";
import { localeCode, translateWeekdayLabels } from "@/lib/i18n";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fisco — Your documents, your accountant, one place" },
      {
        name: "description",
        content:
          "Scan invoices, track purchases and send everything to a nearby accountant in seconds.",
      },
      { property: "og:title", content: "Fisco — Your accounting, organized" },
      {
        property: "og:description",
        content:
          "Scan invoices, track purchases and send everything to a nearby accountant in seconds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const EASE = [0.16, 1, 0.3, 1] as const;

/** Wide, editorial action row — replaces the old square stacked buttons. */
function ActionCard({
  to,
  icon: Icon,
  eyebrow,
  title,
  badge,
  tone = "light",
}: {
  to: "/scan" | "/send" | "/inbox" | "/clients" | "/practice";
  icon: typeof Send;
  eyebrow: string;
  title: string;
  badge?: string | undefined;
  tone?: "light" | "accent";
}) {
  const t = useT();
  return (
    <Link to={to} onClick={() => sfx("pop")} className="press block h-full">
      <Card
        tone={tone}
        className="group relative flex h-full items-center gap-3.5 overflow-hidden p-4"
      >
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
            tone === "accent"
              ? "bg-primary-foreground/15 text-primary-foreground"
              : "bg-ink text-ink-foreground"
          }`}
        >
          <Icon className="size-[18px]" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[10px] font-bold tracking-[0.18em] uppercase ${
              tone === "accent" ? "text-primary-foreground/70" : "opacity-50"
            }`}
          >
            {t(eyebrow)}
          </span>
          <span className="mt-0.5 block truncate text-[16px] leading-tight font-extrabold tracking-[-0.02em]">
            {t(title)}
          </span>
        </span>
        {badge && (
          <span
            className={`num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              tone === "accent"
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-secondary/80"
            }`}
          >
            {badge}
          </span>
        )}
        <ChevronRight
          className={`size-4 shrink-0 transition-transform group-hover:translate-x-0.5 ${
            tone === "accent" ? "text-primary-foreground/70" : "opacity-40"
          }`}
        />
      </Card>
    </Link>
  );
}

function Home() {
  const { role, user } = useStore();
  return role === "accountant" ? <AccountantHome /> : <TaxpayerHome />;
}

/* ------------------------------- accountant ------------------------------ */

function AccountantHome() {
  const { docs, documentsStatus, practice, accountantClientCount } = useStore();
  const t = useT();
  const queue = docs.filter((d) => d.status === "pending").length;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-32 pt-0">
      <PageHeader title="Practice overview" eyebrow={`${t("Accountant")} · 2026`} />

      <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
          <FeeAnalyticsPanel />
          <BlurFade>
            <Card className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Label>{t("Practice")}</Label>
                <div className="mt-0.5 truncate text-[14px] font-extrabold">
                  {practice.firm || t("Set up your practice")}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {practice.address
                    ? compactPracticeLocation(practice.address, practice.city)
                    : t("Add your service location")}
                </div>
              </div>
              <Link to="/practice-profile" className="text-[12px] font-bold text-primary">
                {t("Edit")}
              </Link>
            </Card>
          </BlurFade>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2.5">
          <BlurFade delay={0.1}>
            <ActionCard
              to="/inbox"
              icon={Inbox}
              eyebrow="Review"
              title="Client inbox"
              badge={queue ? String(queue) : undefined}
              tone="accent"
            />
          </BlurFade>
          <BlurFade delay={0.14}>
            <ActionCard to="/clients" icon={Users} eyebrow="Portfolio" title="Your clients" />
          </BlurFade>
          <BlurFade delay={0.18}>
            <ActionCard
              to="/practice"
              icon={LineChart}
              eyebrow="Practice"
              title="Profile and services"
            />
          </BlurFade>
        </div>
      </div>

      <BlurFade delay={0.08} inView className="mt-7">
        <div className="flex items-end justify-between">
          <div>
            <Label>{t("Needs attention")}</Label>
            <h2 className="mt-1 text-[20px] font-extrabold">{t("Waiting on you")}</h2>
          </div>
          <Link to="/inbox" className="text-[12px] font-bold text-primary">
            {t("Open inbox")}
          </Link>
        </div>
        <Card className="mt-3 divide-y divide-border/70 p-1.5">
          {queue === 0 ? (
            <div className="p-6 text-center text-[13px] text-muted-foreground">
              {t("No pending items — all clear! 🎉")}
            </div>
          ) : (
            docs
              .filter((d) => d.status === "pending")
              .slice(0, 5)
              .map((d, i) => (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, x: -10, filter: "blur(8px)" }}
                  whileInView={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.04 * i, duration: 0.5, ease: EASE }}
                  className="flex items-center gap-3 px-2.5 py-2.5"
                >
                  <div className="grid size-9 place-items-center rounded-xl bg-secondary/80">
                    <FileText className="size-[15px]" strokeWidth={1.9} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold">{d.merchant}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {d.category} · {d.date}
                    </div>
                  </div>
                  <span className="num text-[13px]">{eur(d.amount)}</span>
                </motion.div>
              ))
          )}
        </Card>
      </BlurFade>
    </div>
  );
}

/* -------------------------------- taxpayer ------------------------------- */

function TaxpayerHome() {
  const { ranked, chosenId, docs, documentsStatus, appointment, located, locationAccuracy } =
    useStore();
  const preciseLocation =
    located && locationAccuracy !== null && locationAccuracy <= PRECISE_LOCATION_ACCURACY_METERS;
  const chosen = ranked.find((a) => a.id === chosenId);
  const pending = docs.filter((d) => d.status === "pending").length;
  const t = useT();
  const { preferences } = useUIPreferences();
  const month = new Intl.DateTimeFormat(localeCode(preferences.language), { month: "long" }).format(
    new Date(),
  );

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-32 pt-0">
      <PageHeader title={`${month} ${t("overview")}`} eyebrow={`${t("Taxpayer")} · 2026`} />

      <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <AnalyticsPanel
          title={t("Your document activity")}
          docs={docs}
          status={documentsStatus}
          showMoney
          moneyOnly
          stats={[
            { k: t("All documents"), v: docs.length },
            { k: t("Pending"), v: pending },
            { k: t("Categories"), v: new Set(docs.map((doc) => doc.category)).size },
          ]}
        />

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2.5">
          <BlurFade delay={0.1}>
            <ActionCard
              to="/scan"
              icon={ScanLine}
              eyebrow="Capture"
              title="Scan an invoice"
              tone="accent"
            />
          </BlurFade>
          <BlurFade delay={0.14}>
            <ActionCard
              to="/send"
              icon={Send}
              eyebrow="Hand off"
              title="Send to accountant"
              badge={pending ? String(pending) : undefined}
            />
          </BlurFade>

          <BlurFade delay={0.2}>
            <Card className="flex items-center gap-3 p-4">
              <div className="relative grid size-10 shrink-0 place-items-center rounded-2xl bg-secondary/80">
                <Clock className="size-[17px]" strokeWidth={1.9} />
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-2xl border border-primary/40"
                  animate={{ opacity: [0, 0.8, 0], scale: [0.9, 1.08, 0.9] }}
                  transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Label>{t(appointment ? "Confirmed" : "Next slot")}</Label>
                <div className="mt-0.5 truncate text-[14px] font-extrabold">
                  {appointment
                    ? `${t(appointment.day)} · ${appointment.slot}`
                    : chosen?.nextSlot
                      ? translateWeekdayLabels(chosen.nextSlot, t)
                      : t("Choose an accountant first")}
                </div>
              </div>
              {chosen ? (
                <Link
                  to="/book/$id"
                  params={{ id: chosen.id }}
                  className="press rounded-full bg-ink px-3.5 py-2 text-[12px] font-bold text-ink-foreground"
                >
                  {t(appointment ? "Manage" : "Book")}
                </Link>
              ) : (
                <Link
                  to="/map"
                  className="press rounded-full bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground"
                >
                  {t("Find one")}
                </Link>
              )}
            </Card>
          </BlurFade>

          <BlurFade delay={0.22}>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <Label>{t("Your accountant")}</Label>
                <Link to="/map" className="text-[11px] font-bold text-primary">
                  {t("Change")}
                </Link>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Avatar src={chosen?.photo} initials={chosen?.initials ?? "—"} size={46} ring />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-extrabold">
                    {chosen?.firm ?? t("No accountant selected")}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    {chosen && <Stars rating={chosen.rating} className="text-foreground" />}
                    {preciseLocation && chosen && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="num">{fmtKm(chosen.km)}</span>
                      </>
                    )}
                  </div>
                </div>
                {chosen ? (
                  <Link
                    to="/accountants/$id"
                    params={{ id: chosen.id }}
                    aria-label={t("Open profile")}
                    className="press grid size-9 place-items-center rounded-full bg-secondary/80"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                ) : (
                  <Link
                    to="/map"
                    aria-label={t("Find an accountant")}
                    className="press grid size-9 place-items-center rounded-full bg-secondary/80"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                )}
              </div>
            </Card>
          </BlurFade>
        </div>
      </div>

      {/* ---------- nearby rail ---------- */}
      <BlurFade delay={0.08} inView className="mt-7">
        <div className="flex items-end justify-between">
          <div>
            <Label>{t(preciseLocation ? "Nearest to you" : "Accountants in your country")}</Label>
            <h2 className="mt-1 text-[20px] font-extrabold">
              {t(preciseLocation ? "Around the corner" : "Available listings")}
            </h2>
          </div>
          <Link to="/map" className="text-[12px] font-bold text-primary">
            {t("Open map")}
          </Link>
        </div>
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-2">
          {ranked.slice(0, 6).map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 22, filter: "blur(12px)" }}
              whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 * i, duration: 0.65, ease: EASE }}
            >
              <Link to="/accountants/$id" params={{ id: a.id }} className="press block">
                <Card
                  tone={i === 0 ? "ink" : "light"}
                  className="w-[176px] shrink-0 overflow-hidden p-3.5"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar src={a.photo} initials={a.initials} size={34} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-extrabold">{a.firm}</div>
                      <div className="num text-[11px] opacity-55">
                        {preciseLocation ? fmtKm(a.km) : t("Country listing")}
                      </div>
                    </div>
                  </div>
                  <div className="num mt-4 text-[22px] leading-none">{a.rating.toFixed(1)}</div>
                  <div className="mt-1 text-[10px] font-bold tracking-[0.12em] uppercase opacity-45">
                    {a.reviews} {t("reviews")}
                  </div>
                  <div className="mt-3">
                    <Chip tone={i === 0 ? "ink" : a.availableNow ? "positive" : "light"}>
                      {a.availableNow ? t("Open now") : translateWeekdayLabels(a.nextSlot, t)}
                    </Chip>
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </BlurFade>

      {/* ---------- recent ---------- */}
      <BlurFade delay={0.08} inView className="mt-7">
        <div className="flex items-end justify-between">
          <Label>{t("Latest")}</Label>
          <Link to="/documents" className="text-[12px] font-bold text-primary">
            {t("All documents")}
          </Link>
        </div>
        <Card className="mt-3 divide-y divide-border/70 p-1.5">
          {docs.length === 0 ? (
            <div className="p-6 text-center">
              <FileText className="mx-auto mb-2 size-7 opacity-25" />
              <div className="text-[13px] font-bold">{t("No documents yet")}</div>
              <div className="mt-1 text-[11.5px] text-muted-foreground">
                {t("Scan your first invoice to get started")}
              </div>
            </div>
          ) : (
            docs.slice(0, 5).map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, x: -10, filter: "blur(8px)" }}
                whileInView={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                viewport={{ once: true }}
                transition={{ delay: 0.04 * i, duration: 0.5, ease: EASE }}
                className="flex items-center gap-3 px-2.5 py-2.5"
              >
                <div className="grid size-9 place-items-center rounded-xl bg-secondary/80">
                  <FileText className="size-[15px]" strokeWidth={1.9} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold">{d.merchant}</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">
                    {t(d.category)} · {d.date}
                  </div>
                </div>
                <span className="num text-[13px]">{d.amount > 0 ? eur(d.amount) : "—"}</span>
              </motion.div>
            ))
          )}
        </Card>
      </BlurFade>
    </div>
  );
}
