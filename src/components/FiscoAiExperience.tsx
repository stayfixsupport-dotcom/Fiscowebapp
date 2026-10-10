import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { AuroraBackground } from "@/components/AuroraBackground";
import { ChatWindow } from "@/components/ChatWindow";
import { FiscoOrb } from "@/components/FiscoOrb";
import { ThreadSidebar } from "@/components/ThreadSidebar";
import { loadMutePreference, sfx } from "@/lib/sound";
import { getThread, loadUserThreads, mergeThreads } from "@/lib/thread-store";
import { createId } from "@/lib/threads";
import { useStore } from "@/lib/app-store";
import { translateUi } from "@/lib/i18n";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

export function FiscoAiExperience({
  initialThreadId,
  showIntro = false,
}: {
  initialThreadId?: string;
  showIntro?: boolean;
}) {
  const { user, roleReady } = useStore();
  const t = useT();
  const { preferences } = useUIPreferences();
  const [threadId, setThreadId] = useState<string>(() => initialThreadId || createId());
  const [menuOpen, setMenuOpen] = useState(false);
  const [introVisible, setIntroVisible] = useState(showIntro);

  useEffect(() => {
    loadMutePreference();
    if (!showIntro) return;
    const timer = window.setTimeout(() => setIntroVisible(false), 720);
    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => sfx.boot());
    });
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
    };
  }, [showIntro]);

  useEffect(() => {
    if (!roleReady || !user?.id) return;
    let active = true;
    void loadUserThreads(user.id)
      .then((remoteThreads) => {
        if (!active) return;
        const threads = mergeThreads(remoteThreads, user.id);
        setThreadId((currentId) =>
          threads.some((thread) => thread.id === currentId)
            ? currentId
            : (threads[0]?.id ?? createId()),
        );
      })
      .catch((error: unknown) => {
        console.warn("Could not load Fisco AI chat history.", error);
        toast.error(translateUi("Your saved AI chats couldn't be loaded. Try again shortly.", preferences.language));
      });
    return () => {
      active = false;
    };
  }, [roleReady, user?.id, preferences.language]);

  return (
    <div
      data-fisco-ai
      className="fixed inset-0 z-50 flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-4 sm:pt-[max(env(safe-area-inset-top),1rem)] sm:pb-[max(env(safe-area-inset-bottom),1rem)] lg:flex-row lg:gap-4"
      style={{ backgroundColor: "oklch(0.12 0.006 50)" }}
    >
      <AuroraBackground />
      <AnimatePresence>
        {introVisible && (
          <motion.div
            key="fisco-ai-intro"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.01 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute inset-0 z-[60] flex flex-col items-center justify-center gap-6 overflow-hidden"
            style={{ background: "oklch(0.12 0.006 50)" }}
          >
            <div className="absolute inset-0 bg-[image:var(--gradient-aurora)] opacity-70" />
            <div className="relative z-10 flex flex-col items-center gap-5">
              <div className="drop-shadow-[0_0_32px_rgba(255,146,59,0.48)]">
                <FiscoOrb size={112} state="thinking" priority />
              </div>
              <div className="text-center">
                <p
                  className="font-display text-5xl font-extrabold uppercase tracking-[0.14em]"
                  style={{
                    background: "var(--gradient-brand)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  Fisco
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.26em] text-muted-foreground">
                  {t("AI Tax Assistant")}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ThreadSidebar
        activeId={threadId}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        showSoundToggle={false}
        onThreadChange={setThreadId}
      />
      <ChatWindow
        key={`${user?.id ?? "guest"}:${threadId}`}
        threadId={threadId}
        initialMessages={getThread(threadId, user?.id)?.messages ?? []}
        onOpenMenu={() => setMenuOpen(true)}
      />
    </div>
  );
}
