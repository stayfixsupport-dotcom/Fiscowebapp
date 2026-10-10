import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuroraBackground } from "@/components/AuroraBackground";
import { ChatWindow } from "@/components/ChatWindow";
import { FiscoOrb } from "@/components/FiscoOrb";
import { ThreadSidebar } from "@/components/ThreadSidebar";
import { useStore } from "@/lib/app-store";
import { installIntroSound, loadMutePreference } from "@/lib/sound";
import { getThread } from "@/lib/thread-store";

export const Route = createFileRoute("/chat/$threadId")({
  head: () => ({
    meta: [
      { title: "Chat with Fisco — your cinematic AI companion" },
      {
        name: "description",
        content:
          "Talk to Fisco: a glassmorphic, sound-designed AI chat with threads, live thinking and smooth motion.",
      },
      { property: "og:title", content: "Chat with Fisco" },
      {
        property: "og:description",
        content: "A cinematic AI chat experience with threads, sound design and fluid motion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { threadId } = Route.useParams();
  const { user } = useStore();
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    loadMutePreference();
    const off = installIntroSound();
    setHydrated(true);
    return off;
  }, []);

  return (
    <div className="flex h-screen w-full flex-col p-3 sm:p-4 lg:flex-row lg:gap-4">
      <AuroraBackground />
      {hydrated ? (
        <>
          <ThreadSidebar activeId={threadId} open={menuOpen} onClose={() => setMenuOpen(false)} />
          <ChatWindow
            key={`${user?.id ?? "guest"}:${threadId}`}
            threadId={threadId}
            initialMessages={getThread(threadId, user?.id)?.messages ?? []}
            onOpenMenu={() => setMenuOpen(true)}
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <FiscoOrb size={96} state="thinking" priority />
        </div>
      )}
    </div>
  );
}
