import { Link, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { MessageCircle } from "lucide-react";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { useNotificationFeed } from "@/hooks/useNotificationFeed";
import { useLocalNotificationReads } from "@/hooks/useLocalNotificationReads";
import { notificationIsUnread } from "@/lib/notification-events";
import { useT } from "@/lib/ui-prefs";

/** Floating entry point to the messaging surface, hidden while chatting. */
export function ChatFab() {
  const { role, user } = useStore();
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const notifications = useNotificationFeed();
  const scope = `${user?.id ?? "local"}.${role ?? "taxpayer"}`;
  const { readIds, dismissedIds } = useLocalNotificationReads(scope);
  const unreadMessages = notifications.filter(
    (item) =>
      item.source === "message" &&
      !dismissedIds.includes(item.id) &&
      notificationIsUnread(item, readIds),
  );
  const show = !!role && !path.startsWith("/chat");

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.6, y: 22 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.7, y: 16 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          className="fisco-native-chat-fab fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40"
        >
          <Link
            to="/chat"
            aria-label={`${t("Messages")}${unreadMessages.length ? `, ${unreadMessages.length} ${t("unread")}` : ""}`}
            onClick={() => {
              sfx("open");
            }}
            onPointerEnter={() => sfx("hover")}
            className="press fisco-chat-fab-surface relative grid size-12 place-items-center rounded-full"
          >
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full bg-primary/25"
              animate={{ scale: [1, 1.4], opacity: [0.45, 0] }}
              transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 1.4, ease: "easeOut" }}
            />
            <span className="relative size-5" aria-hidden="true">
              <MessageCircle
                className="fisco-chat-fab-icon-outline absolute inset-0 size-5"
                strokeWidth={3.8}
              />
              <MessageCircle
                className="fisco-chat-fab-icon-foreground absolute inset-0 size-5"
                strokeWidth={2}
              />
            </span>
            {unreadMessages.length > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 size-2.5 rounded-full bg-primary ring-2 ring-background"
              >
                <span className="sr-only">
                  {unreadMessages.length} {t("unread")}
                </span>
              </span>
            )}
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
