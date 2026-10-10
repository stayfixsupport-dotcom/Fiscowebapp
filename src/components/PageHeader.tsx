import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { Avatar } from "@/components/kit";
import { NotificationMenu } from "@/components/NotificationMenu";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { useEffect, useState, type ReactNode } from "react";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

export function PageHeader({
  title,
  eyebrow,
  right,
  back,
  backTo,
}: {
  title: string;
  eyebrow?: string;
  right?: ReactNode;
  back?: boolean;
  backTo?: string;
}) {
  const router = useRouter();
  const { user } = useStore();
  const { preferences } = useUIPreferences();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -10, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        data-scrolled={
          preferences.headerBehavior === "glass" ||
          (preferences.headerBehavior === "adaptive" && scrolled)
        }
        data-clear={preferences.headerBehavior === "clear"}
        className={`app-header fixed inset-x-0 top-0 z-40 flex h-15 items-center px-4 ${
          eyebrow ? "gap-3" : "gap-2.5"
        }`}
        dir="ltr"
      >
        {eyebrow ? (
          <Link
            to="/profile"
            aria-label={t("Profile")}
            onClick={() => sfx("open")}
            className="press button-rim shrink-0 rounded-full"
          >
            <Avatar src={user?.photo} initials={user?.initials ?? "MB"} size={44} ring />
          </Link>
        ) : back ? (
          <button
            onClick={() => {
              sfx("close");
              if (backTo) {
                void router.navigate({ to: backTo });
                return;
              }
              if (window.history.length > 1) router.history.back();
              else void router.navigate({ to: "/" });
            }}
            onPointerEnter={() => sfx("hover")}
            aria-label={t("Go back")}
            className="press glass button-rim grid size-10 place-items-center rounded-full"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <span className="block text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
              {eyebrow}
            </span>
          )}
          <h1
            dir="auto"
            className={`truncate text-start font-extrabold ${
              eyebrow ? "text-[20px] leading-tight" : "text-[17px]"
            }`}
          >
            {t(title)}
          </h1>
        </div>
        {eyebrow ? (
          <NotificationMenu />
        ) : right ? (
          right
        ) : (
          <Link
            to="/profile"
            onClick={() => sfx("open")}
            onPointerEnter={() => sfx("hover")}
            className="press button-rim rounded-full"
          >
            <Avatar
              src={user?.photo}
              initials={user?.initials ?? "MB"}
              size={38}
              className="border border-white/10"
            />
          </Link>
        )}
      </motion.header>
      <div aria-hidden className="h-15" />
    </>
  );
}
