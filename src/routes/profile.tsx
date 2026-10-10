import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  ChevronRight,
  Compass,
  FileText,
  HelpCircle,
  MapPin,
  Shield,
  Volume2,
  LogOut,
  MoreHorizontal,
  Palmtree,
  Palette,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { BlurFade } from "@/components/motion/BlurFade";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { Avatar, Label } from "@/components/kit";
import { useStore } from "@/lib/app-store";
import { formatMoney } from "@/lib/practice-profile";
import { sfx, setMuted, isMuted } from "@/lib/sfx";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { AVATAR_OPTIONS } from "@/lib/illustrations";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/ui-prefs";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — Fisco" },
      {
        name: "description",
        content: "Your account, chosen accountant, document totals and privacy settings.",
      },
      { property: "og:title", content: "Your profile — Fisco" },
      {
        property: "og:description",
        content: "Manage your account and your accountant relationship.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Profile,
});

const EASE = [0.16, 1, 0.3, 1] as const;
const PREF_KEY = "fisco.prefs";

type Prefs = { notifications: boolean; sound: boolean };

function readPrefs(): Prefs {
  if (typeof window === "undefined") return { notifications: true, sound: true };
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw) return { notifications: true, sound: true, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { notifications: true, sound: true };
}

/* ------------------------------- primitives ------------------------------ */

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 ${
        on ? "bg-primary" : "bg-foreground/12"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className="absolute size-5 rounded-full bg-card shadow-soft"
        style={{ left: on ? 22 : 2 }}
      />
    </span>
  );
}

function SettingRow({
  icon: Icon,
  label,
  hint,
  on,
  onToggle,
  delay = 0,
}: {
  icon: typeof Bell;
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  delay?: number;
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ delay, duration: 0.55, ease: EASE }}
      onPointerEnter={() => sfx("hover")}
      onClick={onToggle}
      aria-pressed={on}
      className="press flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-start transition-colors hover:bg-secondary/50"
    >
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-full transition-colors ${
          on
            ? "bg-primary/12 text-primary dark:bg-amber-400/15 dark:text-amber-300"
            : "bg-secondary/80 text-foreground/60 dark:bg-cyan-400/15 dark:text-cyan-300"
        }`}
      >
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <Toggle on={on} />
    </motion.button>
  );
}

/* --------------------------------- page ---------------------------------- */

function Profile() {
  const {
    docs,
    ranked,
    chosenId,
    chosenRelationshipStatus,
    located,
    locationAccuracy,
    locating,
    requestLocation,
    role,
    practice,
    savePractice,
    user,
    signOut,
    deleteAccount,
    setUserPhoto,
    saveAvatar,
    openTaxpayerSetup,
  } = useStore();
  const t = useT();
  const preciseLocation = located && locationAccuracy !== null && locationAccuracy <= 200;
  const chosen = ranked.find((a) => a.id === chosenId);
  const total = docs.reduce((s, d) => s + d.amount, 0);
  const sent = docs.filter((d) => d.status === "sent").length;

  const [prefs, setPrefs] = useState<Prefs>({ notifications: true, sound: true });
  const [toast, setToast] = useState<string | null>(null);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const applyAvatar = async (photo: string, label: string) => {
    sfx("select");
    const saved = await setUserPhoto(photo);
    setToast(saved ? label : "Your photo could not be saved. Please try again.");
    window.setTimeout(() => setToast(null), 1800);
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      await applyAvatar(await saveAvatar(file), "Custom photo saved");
    } catch (error) {
      sfx("error");
      setToast(error instanceof Error ? error.message : "Photo upload failed.");
      window.setTimeout(() => setToast(null), 1800);
    }
  };

  const confirmAccountDeletion = async () => {
    if (!user || deleteName.trim() !== user.name.trim() || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteError("");
    try {
      await deleteAccount();
      setDeleteDialogOpen(false);
      setDeleteName("");
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Account deletion failed. Try again.",
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  useEffect(() => {
    const p = readPrefs();
    setPrefs(p);
    setMuted(!p.sound);
  }, []);

  useEffect(() => {
    if (!avatarMenuOpen) return;
    const closeOnScroll = () => setAvatarMenuOpen(false);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => window.removeEventListener("scroll", closeOnScroll, true);
  }, [avatarMenuOpen]);

  const save = (next: Prefs, message: string) => {
    setPrefs(next);
    setMuted(!next.sound);
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (next.sound && isMuted() === false) sfx("select");
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  };

  return (
    <div className="relative">
      <PageHeader
        title={t("Profile")}
        back
        right={
          user ? (
            <button
              type="button"
              aria-label={t("Sign out")}
              title={t("Sign out")}
              onClick={() => {
                sfx("close");
                void signOut();
              }}
              className="press grid size-10 place-items-center rounded-full bg-secondary/80 text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          ) : (
            <span />
          )
        }
      />

      {/* ambient wash behind the glass */}
      <div
        aria-hidden
        className="ambient-glow pointer-events-none absolute inset-x-0 top-0 h-[460px] overflow-hidden"
      >
        <motion.span
          className="absolute -top-24 left-[-10%] size-[420px] rounded-full blur-3xl"
          style={{
            background: "radial-gradient(closest-side, oklch(0.78 0.15 44 / 0.22), transparent)",
          }}
          animate={{ x: [0, 60, 0], y: [0, 24, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.span
          className="absolute -top-10 right-[-12%] size-[420px] rounded-full blur-3xl"
          style={{
            background: "radial-gradient(closest-side, oklch(0.68 0.13 265 / 0.2), transparent)",
          }}
          animate={{ x: [0, -50, 0], y: [0, 30, 0] }}
          transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-[760px] px-4 pb-36">
        {/* ------------------------------ identity ----------------------------- */}
        <BlurFade>
          <div className="glass relative overflow-hidden rounded-[30px] px-5 py-7 sm:px-8">
            <div className="flex items-center gap-4">
              <motion.div
                initial={{ scale: 0.85, opacity: 0, filter: "blur(12px)" }}
                animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                transition={{ duration: 0.8, ease: EASE }}
                className="relative"
              >
                <Avatar
                  src={user?.photo ?? practice.photo ?? undefined}
                  initials={
                    user?.initials ??
                    (role === "accountant" ? practice.name?.slice(0, 2).toUpperCase() : "??")
                  }
                  size={64}
                  ring
                />
                <motion.span
                  aria-hidden
                  className="absolute inset-[-6px] rounded-full border border-primary/35"
                  animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.15, 0.5] }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                />
              </motion.div>
              <div className="min-w-0 flex-1">
                <motion.div
                  initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.8, delay: 0.05, ease: EASE }}
                  className="serif truncate text-[30px] leading-[1] sm:text-[36px]"
                >
                  {user?.name ?? (role === "accountant" ? practice.name : t("Guest"))}
                </motion.div>
                <div className="mt-2 truncate text-[10px] font-semibold tracking-[0.28em] text-muted-foreground uppercase">
                  {user?.email ?? t(role === "accountant" ? "Accountant" : "Taxpayer")}
                </div>
              </div>
              <div className="ml-2 shrink-0">
                <Popover open={avatarMenuOpen} onOpenChange={setAvatarMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("Profile options")}
                      onClick={() => sfx(avatarMenuOpen ? "close" : "open")}
                      className="press grid size-10 place-items-center rounded-full bg-secondary/80 text-foreground"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={8}
                    className="w-52 overflow-hidden rounded-2xl border border-border bg-popover/95 p-1.5 shadow-2xl backdrop-blur-2xl"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        setAvatarPickerOpen((value) => !value);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-start text-[12px] font-semibold hover:bg-secondary/70"
                    >
                      <span>{t("Choose avatar")}</span>
                      <ChevronRight className="size-3.5 opacity-60" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        setAvatarPickerOpen(false);
                        avatarInputRef.current?.click();
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-start text-[12px] font-semibold hover:bg-secondary/70"
                    >
                      <span>{t("Upload photo")}</span>
                      <ChevronRight className="size-3.5 opacity-60" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarMenuOpen(false);
                        void signOut();
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-start text-[12px] font-semibold text-destructive hover:bg-secondary/70"
                    >
                      <span>{t("Sign out")}</span>
                      <ChevronRight className="size-3.5 opacity-60" />
                    </button>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <motion.span
              aria-hidden
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1.3, delay: 0.3, ease: EASE }}
              className="mt-6 block h-px w-full origin-left bg-gradient-to-r from-foreground/18 to-transparent"
            />

            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                { k: "Documents", v: docs.length, f: (n: number) => `${Math.round(n)}` },
                {
                  k: "Tracked",
                  v: total,
                  f: (n: number) =>
                    `${new Intl.NumberFormat("fr-FR", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(n)} €`,
                },
                { k: "Filed", v: sent, f: (n: number) => `${Math.round(n)}` },
              ].map((s, i) => (
                <motion.div
                  key={s.k}
                  initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: 0.15 + i * 0.08, duration: 0.7, ease: EASE }}
                  className="min-w-0 rounded-2xl border border-border/50 bg-card/40 px-3 py-3 backdrop-blur-xl"
                >
                  <div className="num truncate text-[19px] leading-none">
                    <AnimatedNumber value={s.v} format={s.f} />
                  </div>
                  <div className="mt-2 truncate text-[8.5px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
                    {t(s.k)}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </BlurFade>

        <Dialog open={avatarPickerOpen} onOpenChange={setAvatarPickerOpen}>
          <DialogContent className="max-h-[min(80dvh,38rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-[28px] border border-border/50 bg-card/95 p-3 shadow-2xl backdrop-blur-2xl [&>button:last-child]:hidden">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div>
                <DialogTitle className="text-[12px] font-bold">{t("Choose avatar")}</DialogTitle>
                <div className="text-[10px] text-muted-foreground">
                  {t("Orange-only avatar set")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  sfx("close");
                  setAvatarPickerOpen(false);
                }}
                className="press grid size-8 place-items-center rounded-full bg-secondary/80 text-foreground"
                aria-label={t("Close avatar picker")}
              >
                <ChevronRight className="size-3.5 rotate-90" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {AVATAR_OPTIONS.map((photo) => {
                const isSelected = user?.photo === photo;
                return (
                  <button
                    key={photo}
                    type="button"
                    onClick={() => {
                      applyAvatar(photo, "Avatar updated");
                      setAvatarPickerOpen(false);
                    }}
                    aria-label={`${t("Select avatar")} ${AVATAR_OPTIONS.indexOf(photo) + 1}`}
                    className={[
                      "press relative grid place-items-center rounded-full p-1 transition",
                      isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : "",
                    ].join(" ")}
                  >
                    <span className="grid size-14 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_30%,#f9a85a,#ef7b1b_55%,#d95d0f_100%)] shadow-[0_10px_22px_-14px_rgba(239,123,27,0.9)]">
                      <img
                        src={photo}
                        alt=""
                        className="size-full rounded-full object-contain p-0"
                        style={{ background: "transparent" }}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>

        {/* ------------------------- practice (accountant) ---------------------- */}
        {role === "accountant" && (
          <BlurFade delay={0.08} className="mt-6 block">
            <Label>{t("Your practice")}</Label>
            <motion.div
              whileHover={{ y: -2 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="glass mt-2 rounded-[26px] p-4"
            >
              <div className="flex items-center gap-3">
                <Avatar
                  src={practice.photo ?? undefined}
                  initials={practice.name.slice(0, 2).toUpperCase() || "PR"}
                  size={48}
                  ring
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold">
                    {practice.firm || t("Set up your practice")}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {practice.onboarded
                      ? `${formatMoney(practice.price, practice.currencyCode)} · ${practice.pricing.toLowerCase()}`
                      : t("Name, photo, location, rate and hours")}
                  </div>
                </div>
                <Link
                  to="/practice-profile"
                  onPointerEnter={() => sfx("hover")}
                  onClick={() => sfx("open")}
                  className="press rounded-full bg-ink px-4 py-2 text-[12px] font-bold text-ink-foreground"
                >
                  {t("Edit")}
                </Link>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    practice.holiday ? "bg-primary/12 text-primary" : "bg-positive/12 text-positive"
                  }`}
                >
                  <Palmtree className="size-3" />
                  {practice.holiday ? t("Holiday mode on") : t("Accepting clients")}
                </span>
                <span className="rounded-full bg-secondary/80 px-2.5 py-1 text-[11px] font-bold text-foreground/70">
                  {practice.days.length} {t("days")} · {practice.slots.length} {t("slots")}
                </span>
                <span className="rounded-full bg-secondary/80 px-2.5 py-1 text-[11px] font-bold text-foreground/70">
                  {t("Replies in")} {practice.responseHours} h
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  sfx("pop");
                  savePractice({ ...practice, holiday: !practice.holiday });
                  setToast(practice.holiday ? "Holiday mode off" : "Holiday mode on");
                  window.setTimeout(() => setToast(null), 1800);
                }}
                className="press mt-3 flex w-full items-center justify-between rounded-2xl bg-card/60 px-4 py-3 text-start"
              >
                <span className="text-[13px] font-bold">{t("Holiday mode")}</span>
                <Toggle on={practice.holiday} />
              </button>
            </motion.div>
          </BlurFade>
        )}

        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => uploadAvatar(event.target.files?.[0])}
        />

        {/* ---------------------------- accountant ------------------------------ */}
        {role === "taxpayer" && (
          <BlurFade delay={0.12} className="mt-6 block">
            <Label>{t("Your accountant")}</Label>
            <motion.div
              whileHover={{ y: -2 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="glass mt-2 flex items-center gap-3 rounded-[26px] p-4"
            >
              <Avatar src={chosen?.photo} initials={chosen?.initials ?? "—"} size={48} ring />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">
                  {chosen?.firm ?? t("No accountant selected")}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {chosen?.name ?? t("Browse accountants in your country")}
                </div>
                {chosenRelationshipStatus && (
                  <div
                    className={`mt-1 text-[10px] font-extrabold ${
                      chosenRelationshipStatus === "active"
                        ? "text-positive"
                        : chosenRelationshipStatus === "pending"
                          ? "text-primary"
                          : "text-muted-foreground"
                    }`}
                  >
                    {chosenRelationshipStatus === "active"
                      ? t("Request accepted")
                      : chosenRelationshipStatus === "pending"
                        ? t("Awaiting approval")
                        : t("Request declined")}
                  </div>
                )}
              </div>
              <Link
                to="/map"
                onPointerEnter={() => sfx("hover")}
                onClick={() => sfx("open")}
                className="press rounded-full bg-ink px-4 py-2 text-[12px] font-bold text-ink-foreground"
              >
                {t("Change")}
              </Link>
            </motion.div>
          </BlurFade>
        )}

        {/* ------------------------------ settings ------------------------------ */}
        <BlurFade delay={0.12} className="mt-6 block">
          <div className="mb-2 flex items-center gap-2">
            <Palette className="size-4 text-primary" />
            <Label>{t("Appearance & motion")}</Label>
          </div>
          <div className="glass rounded-[26px] p-4">
            <AppearanceSettings
              onNotice={(message) => {
                setToast(message);
                window.setTimeout(() => setToast(null), 1800);
              }}
            />
          </div>
        </BlurFade>

        <BlurFade delay={0.14} className="mt-6 block">
          <Label>{t("Settings")}</Label>
          <div className="glass mt-2 divide-y divide-border/50 rounded-[26px] p-1.5">
            {role === "taxpayer" && (
              <button
                type="button"
                onClick={() => {
                  sfx("open");
                  openTaxpayerSetup();
                }}
                className="press flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-start transition-colors hover:bg-secondary/50"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary/80 dark:bg-sky-400/15 dark:text-sky-300">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{t("Taxpayer profile")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("Edit your saved profile")}
                  </span>
                </span>
                <ChevronRight className="size-4 opacity-40" />
              </button>
            )}
            <Link
              to="/notifications"
              onClick={() => sfx("open")}
              className="press flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-start transition-colors hover:bg-secondary/50"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/12 text-primary dark:bg-rose-400/15 dark:text-rose-300">
                <Bell className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">{t("Notification center")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("Review your Fisco updates")}
                </span>
              </span>
              <ChevronRight className="size-4 opacity-40" />
            </Link>
            <SettingRow
              icon={Bell}
              label={t("Reminders")}
              hint={t(prefs.notifications ? "Deadline alerts on" : "No alerts")}
              on={prefs.notifications}
              delay={0.02}
              onToggle={() =>
                save(
                  { ...prefs, notifications: !prefs.notifications },
                  prefs.notifications ? "Reminders off" : "Reminders on",
                )
              }
            />
            <SettingRow
              icon={Volume2}
              label={t("Sound effects")}
              hint={t(prefs.sound ? "Interface sounds on" : "Muted")}
              on={prefs.sound}
              delay={0.06}
              onToggle={() =>
                save({ ...prefs, sound: !prefs.sound }, prefs.sound ? "Sound muted" : "Sound on")
              }
            />
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.1, duration: 0.55, ease: EASE }}
              onPointerEnter={() => sfx("hover")}
              onClick={() => {
                sfx("tap");
                requestLocation();
                setToast(located ? "Location refreshed" : "Requesting location…");
                window.setTimeout(() => setToast(null), 1800);
              }}
              className="press flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-start transition-colors hover:bg-secondary/50"
            >
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-full ${
                  located
                    ? "bg-positive/12 text-positive"
                    : "bg-secondary/80 text-foreground/60 dark:bg-emerald-400/15 dark:text-emerald-300"
                }`}
              >
                <Compass className={`size-4 ${locating ? "animate-spin" : ""}`} strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{t("Location")}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {locating
                    ? t("Locating…")
                    : preciseLocation
                      ? t("Precise distances on")
                      : located
                        ? `${t("Approximate")} · ±${Math.round(locationAccuracy ?? 0)} m`
                        : t("Country listings; exact distances need GPS")}
                </span>
              </span>
              <span className="num shrink-0 text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                {located ? t("On") : t("Off")}
              </span>
            </motion.button>

            {[
              {
                icon: FileText,
                label: "Document vault",
                to: "/documents" as const,
                hint: "files",
              },
              {
                icon: MapPin,
                label: "Nearby accountants",
                to: "/map" as const,
                hint: preciseLocation ? "nearby" : "in your country",
              },
              {
                icon: Shield,
                label: "Privacy & data",
                to: "/activity" as const,
                hint: "Stored on this device",
              },
              {
                icon: HelpCircle,
                label: "Help & FAQ",
                to: "/faq" as const,
                hint: "Answers to common questions",
              },
            ].map((row, i) => (
              <motion.div
                key={row.label}
                initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.14 + i * 0.05, duration: 0.55, ease: EASE }}
              >
                <Link
                  to={row.to}
                  onPointerEnter={() => sfx("hover")}
                  onClick={() => sfx("open")}
                  className="press group flex items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors hover:bg-secondary/50"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary/80 dark:bg-sky-400/15 dark:text-sky-300">
                    <row.icon className="size-4" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{t(row.label)}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {row.label === "Document vault"
                        ? `${docs.length} ${t("Files")}`
                        : row.label === "Nearby accountants"
                          ? `${ranked.length} ${t(row.hint)}`
                          : t(row.hint)}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 opacity-40 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </motion.div>
            ))}
          </div>
        </BlurFade>

        {user && (
          <BlurFade delay={0.16} className="mt-6 block">
            <Label>{t("Account")}</Label>
            <button
              type="button"
              onClick={() => {
                sfx("open");
                setDeleteName("");
                setDeleteError("");
                setDeleteDialogOpen(true);
              }}
              className="press mt-2 flex w-full items-center gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-start transition-colors hover:bg-destructive/10"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                <Trash2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-destructive">
                  {t("Delete account")}
                </span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {t("Permanently remove your Fisco data")}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-destructive/60" />
            </button>
          </BlurFade>
        )}
      </div>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteError("");
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-[24px] border border-border/70 bg-card/95 p-5 shadow-2xl backdrop-blur-2xl sm:p-6">
          <DialogTitle className="text-[18px] font-extrabold text-destructive">
            {t("Permanently delete your account?")}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            {t(
              "Your profile, documents, messages, and saved Fisco data will be removed. This cannot be undone.",
            )}
          </DialogDescription>
          <label className="grid gap-2 text-[12px] font-bold">
            {t("Type")} <span className="text-foreground">{user?.name}</span> {t("to confirm")}
            <input
              autoComplete="off"
              value={deleteName}
              onChange={(event) => setDeleteName(event.currentTarget.value)}
              placeholder={user?.name ?? t("Your name")}
              className="h-11 w-full rounded-xl border border-input bg-background/70 px-3 text-[14px] font-medium text-foreground outline-none transition focus:border-destructive/60 focus:ring-2 focus:ring-destructive/20"
            />
          </label>
          {deleteError && (
            <p role="alert" className="text-[12px] font-semibold text-destructive">
              {t(deleteError)}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deletingAccount}
              onClick={() => setDeleteDialogOpen(false)}
              className="press h-10 rounded-full border border-border px-4 text-[12px] font-bold text-foreground"
            >
              {t("Keep account")}
            </button>
            <button
              type="button"
              disabled={!user || deleteName.trim() !== user.name.trim() || deletingAccount}
              onClick={() => void confirmAccountDeletion()}
              className="press flex h-10 items-center justify-center gap-2 rounded-full bg-destructive px-4 text-[12px] font-bold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Trash2 className="size-3.5" />
              {deletingAccount ? t("Deleting…") : t("Delete permanently")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* --------------------------- feedback toast --------------------------- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 12, filter: "blur(10px)" }}
            transition={{ duration: 0.45, ease: EASE }}
            className="glass-ink fixed inset-x-0 bottom-[104px] z-40 mx-auto w-fit rounded-full px-4 py-2 text-[12px] font-bold"
          >
            {t(toast)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
