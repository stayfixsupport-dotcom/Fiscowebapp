import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCheck,
  FileCheck2,
  MessageCircle,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Card, Label } from "@/components/kit";
import { useLocalNotificationReads } from "@/hooks/useLocalNotificationReads";
import { useNotificationFeed } from "@/hooks/useNotificationFeed";
import {
  notificationInitials,
  notificationIsUnread,
  notificationTime,
} from "@/lib/notification-events";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Fisco" },
      {
        name: "description",
        content: "A quiet place for updates and useful next steps in your Fisco workspace.",
      },
      { property: "og:title", content: "Notifications — Fisco" },
    ],
  }),
  component: Notifications,
});

const FILTERS = ["All", "Unread"] as const;
type Filter = (typeof FILTERS)[number];
const EASE = [0.16, 1, 0.3, 1] as const;

function Notifications() {
  const { role, user } = useStore();
  const t = useT();
  const notices = useNotificationFeed();
  const scope = `${user?.id ?? "local"}.${role ?? "taxpayer"}`;
  const { readIds, dismissedIds, markRead, markAllRead, clearAll } =
    useLocalNotificationReads(scope);
  const [filter, setFilter] = useState<Filter>("All");
  const currentNotices = notices.filter((notice) => !dismissedIds.includes(notice.id));
  const unreadCount = currentNotices.filter((notice) =>
    notificationIsUnread(notice, readIds),
  ).length;
  const visibleNotices = currentNotices.filter(
    (notice) => filter === "All" || notificationIsUnread(notice, readIds),
  );

  return (
    <main>
      <PageHeader title="Notifications" back backTo="/" />
      <div className="mx-auto w-full max-w-[820px] px-4 pt-4 pb-32">
        <BlurFade>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <Label>{t("ACTIVITY")}</Label>
              <h2 className="mt-1 text-[27px] leading-tight font-extrabold sm:text-[32px]">
                {t("Notifications")}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    markAllRead(currentNotices.map((notice) => notice.id));
                    sfx("confirm");
                  }}
                  className="press inline-flex min-h-10 items-center gap-2 rounded-full border border-border/70 bg-card/55 px-3.5 text-[11px] font-extrabold transition-colors hover:bg-secondary/70"
                >
                  <CheckCheck className="size-4 text-primary" /> {t("Mark all read")}
                </button>
              )}
              {currentNotices.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    void clearAll(currentNotices.map((notice) => notice.id));
                    sfx("close");
                  }}
                  className="press inline-flex min-h-10 items-center gap-2 rounded-full border border-border/70 bg-card/55 px-3.5 text-[11px] font-extrabold transition-colors hover:bg-secondary/70"
                >
                  <Trash2 className="size-4 text-muted-foreground" /> {t("Clear all")}
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-border/70 py-3">
            <div
              className="flex items-center gap-1 rounded-full bg-secondary/55 p-1"
              role="tablist"
              aria-label={t("Notification filter")}
            >
              {FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={filter === item}
                  onClick={() => {
                    setFilter(item);
                    sfx("tick");
                  }}
                  className={`relative min-h-8 rounded-full px-3.5 text-[11px] font-extrabold ${
                    filter === item ? "text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {filter === item && (
                    <motion.span
                      layoutId="notification-filter"
                      className="absolute inset-0 rounded-full bg-primary"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{t(item)}</span>
                </button>
              ))}
            </div>
            <span className="text-[10px] font-extrabold tracking-[0.14em] text-muted-foreground uppercase">
              {unreadCount ? `${unreadCount} ${t("unread")}` : t("You’re all caught up")}
            </span>
          </div>

          <div className="mt-4 grid gap-2.5">
            <AnimatePresence mode="popLayout" initial={false}>
              {visibleNotices.map((notice, index) => {
                const unread = notificationIsUnread(notice, readIds);
                const SourceIcon =
                  notice.source === "message"
                    ? MessageCircle
                    : notice.source === "ai"
                      ? Sparkles
                      : notice.source === "relationship"
                        ? Users
                        : notice.source === "appointment"
                          ? CalendarClock
                          : notice.source === "service"
                            ? BriefcaseBusiness
                            : FileCheck2;
                return (
                  <motion.article
                    key={notice.id}
                    layout
                    initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
                    animate={{ opacity: unread ? 1 : 0.72, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -8, filter: "blur(8px)" }}
                    transition={{ delay: index * 0.045, duration: 0.38, ease: EASE }}
                    className="glass w-full min-w-0 rounded-[22px] border border-glass-border p-3.5 sm:p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Link
                        to={notice.to}
                        onClick={() => {
                          markRead(notice.id);
                          sfx("open");
                        }}
                        className="press flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        {notice.photo || notice.source === "message" ? (
                          <Avatar
                            src={notice.photo}
                            initials={notificationInitials(notice.actor) || "AC"}
                            size={44}
                            ring={unread}
                          />
                        ) : (
                          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                            <SourceIcon className="size-[18px]" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="min-w-0 truncate text-[13px] font-extrabold">
                              {notice.actor}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {notificationTime(notice.at)}
                            </span>
                            {unread && (
                              <span
                                className="size-1.5 rounded-full bg-primary"
                                aria-label={t("Unread")}
                              />
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] font-bold">
                            {t(notice.title)}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {notice.preview}
                          </span>
                        </span>
                      </Link>
                      {unread && (
                        <button
                          type="button"
                          aria-label={`${t("Mark as read")}: ${t(notice.title)}`}
                          onClick={() => {
                            markRead(notice.id);
                            sfx("confirm");
                          }}
                          className="press grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>

            {visibleNotices.length === 0 && (
              <Card className="grid justify-items-center gap-2 px-5 py-12 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-secondary/70 text-muted-foreground">
                  <Bell className="size-5" />
                </span>
                <h3 className="text-[15px] font-extrabold">
                  {filter === "Unread" ? t("You’re all caught up") : t("No notifications yet")}
                </h3>
                <p className="max-w-[300px] text-[12px] leading-relaxed text-muted-foreground">
                  {filter === "Unread"
                    ? t("No unread notifications.")
                    : t("New messages and updates will appear here.")}
                </p>
                <Link
                  to="/"
                  onClick={() => sfx("close")}
                  className="press mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[11px] font-extrabold text-primary-foreground"
                >
                  {t("Back to home")} <Bell className="size-3.5" />
                </Link>
              </Card>
            )}
          </div>
        </BlurFade>
      </div>
    </main>
  );
}
