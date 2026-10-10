import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Receipt, Landmark, LogIn } from "lucide-react";
import { useStore, type Role } from "@/lib/app-store";
import { lockScroll } from "@/lib/scroll-lock";
import { sfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";

const EASE = [0.16, 1, 0.3, 1] as const;

const CHOICES: { role: Role; title: string; hint: string; icon: typeof Receipt }[] = [
  {
    role: "taxpayer",
    title: "I'm looking for an accountant",
    hint: "Scan · track · send",
    icon: Receipt,
  },
  {
    role: "accountant",
    title: "I'm an accountant",
    hint: "Receive · review · file",
    icon: Landmark,
  },
];

/** Illustrated first-run role picker: art leads, copy stays minimal. */
export function RoleGate({ enabled = true }: { enabled?: boolean }) {
  const { role, roleReady, user, setRole } = useStore();
  const t = useT();
  const [selected, setSelected] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [hasPreviousAccount, setHasPreviousAccount] = useState(false);
  const [showRoleChoices, setShowRoleChoices] = useState(false);
  const [curtain, setCurtain] = useState(false);
  const [curtainRole, setCurtainRole] = useState<Role | null>(null);
  const open = enabled && roleReady && historyReady && !user && (!selected || curtain);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    try {
      setHasPreviousAccount(window.localStorage.getItem("fisco.account.created.v1") === "1");
    } catch {
      setHasPreviousAccount(false);
    }
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    const resetSelection = () => {
      setSelected(false);
      setHasPreviousAccount(false);
      setShowRoleChoices(false);
      setChoosing(false);
      setCurtain(false);
      setCurtainRole(null);
    };
    window.addEventListener("fisco:reset-role-selection", resetSelection);
    return () => window.removeEventListener("fisco:reset-role-selection", resetSelection);
  }, []);

  useEffect(() => (open ? lockScroll() : undefined), [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] overflow-x-hidden overflow-y-auto overscroll-contain bg-background"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          {/* ---- cinematic ink curtain, same language as the mode intro ---- */}
          <AnimatePresence>
            {curtain && (
              <motion.div
                className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 1.06 }}
                transition={{ duration: 0.8, ease: EASE }}
              >
                <span className="absolute inset-0 bg-ink" />
                <motion.span
                  aria-hidden
                  className="absolute size-[46vmin] rounded-full"
                  style={{
                    background:
                      "conic-gradient(from 180deg, oklch(0.78 0.15 44), oklch(0.85 0.09 92), oklch(0.8 0.08 210), oklch(0.78 0.15 44))",
                    filter: "blur(34px)",
                  }}
                  initial={{ scale: 0.15, opacity: 0 }}
                  animate={{ scale: [0.15, 1.3, 1.05], opacity: [0, 0.75, 0.4], rotate: 200 }}
                  transition={{ duration: 2.4, ease: EASE }}
                />
                <div className="relative flex flex-col items-center text-center">
                  <motion.img
                    src="/favicon.ico"
                    alt="Fisco"
                    initial={{ opacity: 0, y: 30, scale: 0.45, rotate: -18, filter: "blur(16px)" }}
                    animate={{
                      opacity: 1,
                      y: [30, -8, 0],
                      scale: [0.45, 1.06, 1],
                      rotate: [-18, 5, 0],
                      filter: "blur(0px)",
                    }}
                    transition={{ duration: 2.2, ease: EASE }}
                    className="size-[min(34vmin,176px)] object-contain drop-shadow-[0_0_36px_rgba(255,146,59,0.38)]"
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 14, filter: "blur(14px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ delay: 0.8, duration: 0.7, ease: EASE }}
                    className="text-[11px] font-bold tracking-[0.34em] text-ink-foreground/55 uppercase"
                  >
                    {t("Welcome")}
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 26, filter: "blur(20px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ delay: 1.05, duration: 0.85, ease: EASE }}
                    className="mt-2 max-w-[min(90vw,480px)] text-[clamp(1.4rem,5vw,2.125rem)] leading-[1.05] font-extrabold text-ink-foreground"
                  >
                    {t(
                      curtainRole === "accountant"
                        ? "I'm an accountant"
                        : "I'm looking for an accountant",
                    )}
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, scaleX: 0 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ delay: 1.6, duration: 0.8, ease: EASE }}
                    className="mx-auto mt-4 h-px w-24 origin-center bg-ink-foreground/25"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col px-5 pt-5 pb-6">
            {/* ---- illustrated hero ---- */}
            <div className="relative min-h-0 flex-1">
              <motion.div
                aria-hidden
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.9, delay: 1.35, ease: EASE }}
                className="absolute inset-0 grid place-items-center"
              >
                {/* orbiting halo */}
                <motion.div
                  className="absolute size-[74vw] max-w-[360px] rounded-full border border-foreground/8"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 46, repeat: Infinity, ease: "linear" }}
                >
                  <span className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full bg-primary" />
                </motion.div>
                <motion.div
                  className="absolute size-[54vw] max-w-[264px] rounded-full border border-foreground/8"
                  animate={{ rotate: -360 }}
                  transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                >
                  <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-ink" />
                </motion.div>

                {/* iridescent sphere */}
                <motion.div
                  className="size-[42vw] max-w-[210px] rounded-full"
                  style={{
                    background:
                      "radial-gradient(38% 38% at 34% 28%, oklch(1 0 0 / 0.95), transparent 62%), conic-gradient(from 210deg, oklch(0.78 0.15 44), oklch(0.85 0.09 92), oklch(0.8 0.08 210), oklch(0.78 0.15 44))",
                    filter: "saturate(1.15)",
                    boxShadow: "0 40px 90px -30px oklch(0.6 0.14 44 / 0.55)",
                  }}
                  animate={{ y: [0, -14, 0], rotate: [0, 8, 0] }}
                  transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
                />

                {/* floating document cards */}
                {[
                  { x: -118, y: -108, r: -13, d: 0 },
                  { x: 112, y: -18, r: 10, d: 0.6 },
                  { x: -74, y: 104, r: 7, d: 1.2 },
                ].map((cardPos, i) => (
                  <motion.div
                    key={i}
                    className="glass absolute grid h-16 w-24 gap-1.5 rounded-2xl p-3"
                    style={{ x: cardPos.x, y: cardPos.y, rotate: cardPos.r }}
                    initial={{ opacity: 0, scale: 0.7, filter: "blur(14px)" }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      filter: "blur(0px)",
                      y: [cardPos.y, cardPos.y - 10, cardPos.y],
                    }}
                    transition={{
                      opacity: { duration: 0.8, delay: 1.5 + i * 0.1, ease: EASE },
                      scale: { duration: 0.8, delay: 1.5 + i * 0.1, ease: EASE },
                      filter: { duration: 0.8, delay: 1.5 + i * 0.1 },
                      y: {
                        duration: 7 + i,
                        delay: cardPos.d,
                        repeat: Infinity,
                        ease: "easeInOut",
                      },
                    }}
                  >
                    <span className="h-1.5 w-2/3 rounded-full bg-foreground/20" />
                    <span className="h-1.5 w-full rounded-full bg-foreground/10" />
                    <span className="h-1.5 w-1/2 rounded-full bg-primary/60" />
                  </motion.div>
                ))}
              </motion.div>
            </div>

            {hasPreviousAccount && role && !showRoleChoices && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.12, ease: EASE }}
                className="grid gap-2.5"
              >
                <div className="text-[11px] font-bold tracking-[0.2em] uppercase opacity-45">
                  {t("Good to see you again")}
                </div>
                <div className="glass rounded-[26px] p-5">
                  <div className="serif text-[30px] leading-none">{t("Welcome back")}</div>
                  <p className="mt-2 text-[13px] font-semibold text-muted-foreground">
                    {t(
                      role === "accountant"
                        ? "Continue to your accountant profile."
                        : "Continue to your taxpayer profile.",
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      sfx("confirm");
                      setSelected(true);
                    }}
                    className="press mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-extrabold text-primary-foreground"
                  >
                    <LogIn className="size-4" /> {t("I'm back")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sfx("open");
                      setShowRoleChoices(true);
                    }}
                    className="press mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border/60 bg-card/60 text-[12px] font-bold"
                  >
                    <ArrowRight className="size-4" /> {t("Change role")}
                  </button>
                </div>
              </motion.div>
            )}

            {(!hasPreviousAccount || !role || showRoleChoices) && (
              <>
                {showRoleChoices && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.12, ease: EASE }}
                    className="text-[11px] font-bold tracking-[0.2em] uppercase opacity-45"
                  >
                    {t("Choose another role")}
                  </motion.div>
                )}

                <div className="mt-3 grid gap-2.5">
                  {CHOICES.map((c, i) => (
                    <motion.button
                      key={c.role}
                      type="button"
                      disabled={choosing}
                      onPointerEnter={() => sfx("hover")}
                      onClick={() => {
                        if (choosing) return;
                        setChoosing(true);
                        setSelected(true);
                        setCurtain(true);
                        setCurtainRole(c.role);
                        sfx("confirm");
                        window.setTimeout(() => sfx("success"), 160);
                        window.setTimeout(() => sfx("whoosh"), 320);
                        window.setTimeout(() => {
                          setRole(c.role);
                          setCurtain(false);
                        }, 3400);
                      }}
                      initial={{ opacity: 0, y: 30, filter: "blur(16px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{ duration: 0.45, delay: 0.18 + i * 0.08, ease: EASE }}
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.985 }}
                      className="glass group flex items-center gap-3.5 overflow-hidden rounded-[26px] p-4 text-start"
                    >
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ink text-ink-foreground">
                        <c.icon className="size-5" strokeWidth={1.9} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[19px] leading-tight font-extrabold">
                          {t(c.title)}
                        </span>
                        <span className="block text-[12px] font-semibold text-muted-foreground">
                          {t(c.hint)}
                        </span>
                      </span>
                      <motion.span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                        animate={{ x: [0, 3, 0] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <ArrowRight className="size-4" />
                      </motion.span>
                    </motion.button>
                  ))}
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
