import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/lib/app-store";
import { lockScroll } from "@/lib/scroll-lock";
import { PracticeSetup } from "./PracticeSetup";

const EASE = [0.16, 1, 0.3, 1] as const;

/** First-run practice setup, shown right after an accountant signs in. */
export function PracticeGate() {
  const {
    role,
    roleReady,
    user,
    practice,
    savePractice,
    saveAvatar,
    practiceSaveError,
    skipPracticeSetup,
    practiceSetupOpen,
  } = useStore();
  const open =
    roleReady && role === "accountant" && !!user && practiceSetupOpen && !practice.onboarded;

  useEffect(() => {
    if (!open) return;
    return lockScroll();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="no-scrollbar fixed inset-0 z-[90] w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto bg-background/92 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.03 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <motion.span
            aria-hidden
            className="pointer-events-none fixed -top-24 -left-16 size-[54vmin] rounded-full"
            style={{
              background:
                "conic-gradient(from 140deg, oklch(0.78 0.15 44), oklch(0.85 0.09 92), oklch(0.8 0.08 210), oklch(0.78 0.15 44))",
              filter: "blur(46px)",
              opacity: 0.4,
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
          />
          <div className="relative mx-auto w-full min-w-0 max-w-[620px] px-4 py-8">
            <motion.div
              initial={{ opacity: 0, y: 26, filter: "blur(16px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <PracticeSetup
                value={practice}
                onSave={savePractice}
                saveAvatar={saveAvatar}
                onClose={skipPracticeSetup}
                saveError={practiceSaveError}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
