import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MessageSquare, PenLine, Plus, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FiscoOrb } from "@/components/FiscoOrb";
import { useStore } from "@/lib/app-store";
import { isMuted, setMuted, sfx } from "@/lib/sound";
import {
  createThread,
  deleteThread,
  getThread,
  renameThread,
  useThreads,
} from "@/lib/thread-store";
import { createId } from "@/lib/threads";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/ui-prefs";

type ThreadSidebarProps = {
  activeId: string;
  open: boolean;
  onClose: () => void;
  showSoundToggle?: boolean;
  onThreadChange?: (threadId: string) => void;
};

export function ThreadSidebar({
  activeId,
  open,
  onClose,
  showSoundToggle = true,
  onThreadChange,
}: ThreadSidebarProps) {
  const t = useT();
  const { user } = useStore();
  const threads = useThreads(user?.id);
  const navigate = useNavigate();
  const [muted, setMutedState] = useState(() => isMuted());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const onNew = () => {
    sfx.newThread();
    if (
      onThreadChange &&
      !threads.some((thread) => thread.id === activeId) &&
      !getThread(activeId, user?.id)?.messages.length
    ) {
      onClose();
      return;
    }
    const id = onThreadChange ? createId() : createThread(user?.id);
    onClose();
    if (onThreadChange) onThreadChange(id);
    else void navigate({ to: "/chat/$threadId", params: { threadId: id } });
  };

  const onDelete = async (id: string) => {
    const remaining = threads.filter((t) => t.id !== id);
    const deleted = await deleteThread(id, user?.id);
    if (!deleted) {
      toast.error(t("This conversation couldn't be permanently deleted. Please try again."));
      return;
    }
    sfx.delete();
    if (id === activeId) {
      const nextId = remaining[0]?.id ?? (onThreadChange ? createId() : createThread(user?.id));
      if (onThreadChange) onThreadChange(nextId);
      else void navigate({ to: "/chat/$threadId", params: { threadId: nextId } });
    }
  };

  const commitRename = async (id: string) => {
    if (draft.trim() && !(await renameThread(id, draft.trim(), user?.id))) {
      toast.error(t("Conversation title couldn't be saved."));
    }
    setEditingId(null);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) sfx.click();
  };

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-smooth lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={cn(
          "glass fixed inset-y-0 left-0 z-40 flex w-[19rem] flex-col rounded-r-3xl p-4 transition-smooth lg:static lg:z-0 lg:translate-x-0 lg:rounded-3xl",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-2 pb-4">
          <FiscoOrb size={40} priority />
          <div className="flex-1">
            <p className="font-display text-lg font-extrabold uppercase tracking-[0.14em] text-gradient">
              Fisco
            </p>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("your AI companion")}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("Close menu")}
            className="rounded-full p-2 text-muted-foreground transition-smooth hover:bg-glass-strong hover:text-foreground lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <button
          onClick={onNew}
          onMouseEnter={() => sfx.hover()}
          className="group flex items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-primary-foreground transition-smooth hover:scale-[1.02] hover:glow"
        >
          <Plus className="size-4 transition-smooth group-hover:rotate-90" />
          {t("New conversation")}
        </button>

        <div className="mt-5 flex-1 space-y-1.5 overflow-y-auto pr-1">
          <p className="px-2 pb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("Threads")}
          </p>
          {threads.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">{t("No conversations yet.")}</p>
          )}
          {threads.map((thread, i) => (
            <div
              key={thread.id}
              style={{ animationDelay: `${i * 40}ms` }}
              className={cn(
                "group flex animate-rise items-center gap-2 rounded-2xl px-3 py-2.5 transition-smooth",
                thread.id === activeId
                  ? "glass-strong text-foreground"
                  : "text-muted-foreground hover:bg-glass hover:text-foreground",
              )}
            >
              {editingId === thread.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commitRename(thread.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(thread.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full bg-transparent text-sm outline-none"
                />
              ) : (
                <Link
                  to="/chat/$threadId"
                  params={{ threadId: thread.id }}
                  onClick={(event) => {
                    if (onThreadChange) {
                      event.preventDefault();
                      onThreadChange(thread.id);
                    }
                    sfx.click();
                    onClose();
                  }}
                  onMouseEnter={() => sfx.hover()}
                  className="flex min-w-0 flex-1 items-center gap-2.5"
                >
                  <MessageSquare className="size-4 shrink-0 opacity-70" />
                  <span className="truncate text-sm">{thread.title}</span>
                </Link>
              )}
              <button
                aria-label={t("Rename conversation")}
                onClick={() => {
                  setEditingId(thread.id);
                  setDraft(thread.title);
                }}
                className="opacity-0 transition-smooth hover:text-accent group-hover:opacity-100"
              >
                <PenLine className="size-3.5" />
              </button>
              <button
                aria-label={`${t("Delete")} ${thread.title}`}
                title={t("Delete conversation")}
                onClick={() => void onDelete(thread.id)}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => void navigate({ to: "/chat" })}
          onMouseEnter={() => sfx.hover()}
          className="mt-3 flex items-center gap-2.5 rounded-2xl border border-glass-border bg-glass/60 px-3 py-2.5 text-sm text-muted-foreground transition-smooth hover:bg-glass hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("Messages")}
        </button>

        {showSoundToggle && (
          <button
            onClick={toggleMute}
            onMouseEnter={() => sfx.hover()}
            className="mt-3 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm text-muted-foreground transition-smooth hover:bg-glass hover:text-foreground"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            {muted ? t("Sound off") : t("Sound on")}
          </button>
        )}
      </aside>
    </>
  );
}
