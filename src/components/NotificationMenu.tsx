import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

export function NotificationMenu() {
  const { role, user } = useStore();
  const t = useT();
  const notifications = useNotificationFeed();
  const scope = `${user?.id ?? "local"}.${role ?? "taxpayer"}`;
  const { readIds, dismissedIds, markRead, markAllRead, clearAll } =
    useLocalNotificationReads(scope);
  const [open, setOpen] = useState(false);
  const visibleNotifications = notifications.filter((item) => !dismissedIds.includes(item.id));
  const unreadCount = visibleNotifications.filter((item) =>
    notificationIsUnread(item, readIds),
  ).length;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        sfx(nextOpen ? "open" : "close");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${t("Open notifications")}${unreadCount ? `, ${unreadCount} ${t("unread")}` : ""}`}
          className="press glass relative grid size-10 place-items-center rounded-2xl transition-colors hover:bg-card/80"
        >
          <Bell className="size-[17px]" strokeWidth={1.9} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] leading-4 font-extrabold text-primary-foreground shadow-sm">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="w-[calc(100vw-2.5rem)] max-w-[320px] overflow-hidden rounded-[24px] border border-glass-border bg-background/80 p-2 text-foreground shadow-[0_24px_64px_-20px_rgba(5,10,18,0.6)] backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="text-[14px] font-extrabold">{t("Notifications")}</h2>
          <Link
            to="/notifications"
            onClick={() => sfx("open")}
            className="press rounded-full px-2.5 py-1 text-[10px] font-extrabold text-primary hover:bg-primary/10"
          >
            {t("See all")}
          </Link>
        </div>

        {visibleNotifications.length > 0 && (
          <div className="mb-1 flex items-center gap-1 border-b border-border/60 px-2 pb-2">
            <button
              type="button"
              disabled={!unreadCount}
              onClick={() => {
                markAllRead(visibleNotifications.map((item) => item.id));
                sfx("confirm");
              }}
              className="press inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-full bg-secondary/60 px-2 text-[10px] font-bold disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> {t("Mark read")}
            </button>
            <button
              type="button"
              onClick={() => {
                void clearAll(visibleNotifications.map((item) => item.id));
                sfx("close");
              }}
              className="press inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-full bg-secondary/60 px-2 text-[10px] font-bold"
            >
              <Trash2 className="size-3.5" /> {t("Clear")}
            </button>
          </div>
        )}

        <div className="grid max-h-[min(58dvh,390px)] gap-1 overflow-y-auto overscroll-contain">
          {visibleNotifications.slice(0, 5).map((item) => {
            const unread = notificationIsUnread(item, readIds);
            return (
              <Link
                key={item.id}
                to={item.to}
                onClick={() => {
                  markRead(item.id);
                  sfx("open");
                }}
                className={`press flex min-w-0 items-center gap-2.5 rounded-[17px] px-2.5 py-2 transition-colors hover:bg-secondary/60 ${
                  unread ? "bg-card/45" : "opacity-60"
                }`}
              >
                <Avatar
                  src={item.photo}
                  initials={notificationInitials(item.actor) || "F"}
                  size={34}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[11px] font-extrabold">
                      {item.actor}
                    </span>
                    <span className="shrink-0 text-[9px] text-muted-foreground">
                      {notificationTime(item.at)}
                    </span>
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {item.title} · {item.preview}
                  </span>
                </span>
                {unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
              </Link>
            );
          })}

          {visibleNotifications.length === 0 && (
            <p className="px-3 py-5 text-center text-[11px] text-muted-foreground">
              {t("No notifications yet")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
