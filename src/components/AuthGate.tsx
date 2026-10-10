import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Fingerprint, Loader2, Lock, Mail } from "lucide-react";
import { useStore } from "@/lib/app-store";
import { lockScroll } from "@/lib/scroll-lock";
import { sfx } from "@/lib/sfx";
import { LanguagePicker } from "@/components/LanguagePicker";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Glass sign-in curtain shown once a world (role) has been chosen. */
export function AuthGate({ enabled = true }: { enabled?: boolean }) {
  const { role, roleReady, user, setRole, signIn, signInWithOAuth, signInWithGoogleIdToken } =
    useStore();
  const { preferences, updatePreferences } = useUIPreferences();
  const t = useT();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [mode, setMode] = useState<"in" | "up">("up");

  useEffect(() => {
    try {
      const accountCreated = window.localStorage.getItem("fisco.account.created.v1") === "1";
      const storedRole = window.localStorage.getItem("fisco.role.v2");
      setMode(
        accountCreated || storedRole === "taxpayer" || storedRole === "accountant" ? "in" : "up",
      );
    } catch {
      setMode("up");
    }
  }, []);

  useEffect(() => {
    const resetSignupMode = () => {
      if (window.localStorage.getItem("fisco.account.created.v1") === "1") return;
      setMode("up");
      setEmail("");
      setPass("");
      setName("");
      setCurrencyCode("");
      setError("");
      setBusy(false);
      setDone(false);
    };
    window.addEventListener("fisco:reset-role-selection", resetSignupMode);
    return () => window.removeEventListener("fisco:reset-role-selection", resetSignupMode);
  }, []);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /* Keep the gate mounted while credentials resolve and the success cue plays. */
  const open = enabled && roleReady && !!role && (!user || busy || done) && pathname !== "/map";

  useEffect(() => {
    if (!open) return;
    return lockScroll();
  }, [open]);

  useEffect(() => {
    const onNativeGoogleAuth = (event: Event) => {
      const idToken = (event as CustomEvent<{ idToken?: unknown }>).detail?.idToken;
      if (typeof idToken !== "string" || !idToken) {
        setBusy(false);
        setError(t("Google sign in error"));
        return;
      }

      void (async () => {
        try {
          await signInWithGoogleIdToken(idToken);
          setError("");
          setDone(true);
          sfx("success");
          await new Promise<void>((resolve) => window.setTimeout(resolve, 850));
          window.dispatchEvent(new Event("fisco:show-loading"));
          await navigate({ to: "/" });
          setDone(false);
          setBusy(false);
        } catch (cause) {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : t("Google sign in error"));
        }
      })();
    };
    const onNativeGoogleCancel = () => setBusy(false);
    const onNativeGoogleError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: unknown }>).detail?.message;
      setBusy(false);
      setError(typeof message === "string" ? message : t("Google sign in error"));
    };

    window.addEventListener("fisco:native-google-auth", onNativeGoogleAuth);
    window.addEventListener("fisco:native-google-auth-cancel", onNativeGoogleCancel);
    window.addEventListener("fisco:native-google-auth-error", onNativeGoogleError);
    return () => {
      window.removeEventListener("fisco:native-google-auth", onNativeGoogleAuth);
      window.removeEventListener("fisco:native-google-auth-cancel", onNativeGoogleCancel);
      window.removeEventListener("fisco:native-google-auth-error", onNativeGoogleError);
    };
  }, [navigate, signInWithGoogleIdToken, t]);

  const valid =
    /\S+@\S+\.\S+/.test(email) &&
    pass.length >= 4 &&
    (mode === "in" || (name.trim() && currencyCode));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    sfx("confirm");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await signIn(
        email,
        pass,
        mode === "up" ? name : undefined,
        mode === "up" ? currencyCode : undefined,
      );
      if (result === "confirmation-required") {
        setMode("in");
        setNotice(t("Check your email to confirm your account, then sign in."));
        setBusy(false);
        return;
      }
      if (mode === "up") setMode("in");
      setDone(true);
      sfx("success");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 850));
      window.dispatchEvent(new Event("fisco:show-loading"));
      await navigate({ to: "/" });
      setDone(false);
      setBusy(false);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : t("Unable to continue. Please try again."));
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[115] overflow-x-hidden overflow-y-auto overscroll-contain bg-background"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <button
            type="button"
            disabled={busy || done}
            onClick={() => {
              sfx("close");
              setRole(null);
              window.dispatchEvent(new Event("fisco:reset-role-selection"));
            }}
            className="absolute top-[max(env(safe-area-inset-top),1rem)] right-4 z-[2] inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-background/85 px-3.5 text-[12px] font-bold shadow-sm backdrop-blur disabled:opacity-50"
          >
            <ArrowLeft className="size-4" /> {t("Change role")}
          </button>

          {/* drifting light bodies behind the glass */}
          <motion.span
            aria-hidden
            className="ambient-glow pointer-events-none absolute -top-24 -left-16 size-[62vmin] rounded-full"
            style={{
              background:
                "conic-gradient(from 140deg, oklch(0.78 0.15 44), oklch(0.85 0.09 92), oklch(0.8 0.08 210), oklch(0.78 0.15 44))",
              filter: "blur(44px)",
              opacity: 0.5,
            }}
            animate={{ x: [0, 40, 0], y: [0, 26, 0], rotate: 360 }}
            transition={{ duration: 44, repeat: Infinity, ease: "linear" }}
          />
          <motion.span
            aria-hidden
            className="ambient-glow pointer-events-none absolute -right-20 -bottom-24 size-[54vmin] rounded-full"
            style={{
              background:
                "radial-gradient(circle at 40% 40%, oklch(0.7 0.16 300), transparent 68%)",
              filter: "blur(40px)",
              opacity: 0.45,
            }}
            animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
            transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="fisco-auth-content relative mx-auto flex w-full max-w-[520px] flex-col justify-center px-5">
            {/* brand */}
            <motion.div
              initial={{ opacity: 0, y: 18, filter: "blur(14px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.55, ease: EASE }}
              className="mb-5 flex items-center gap-3"
            >
              <motion.span
                className="grid size-11 place-items-center rounded-2xl bg-ink text-ink-foreground"
                animate={{ rotate: [0, 6, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              >
                <Fingerprint className="size-5" strokeWidth={2} />
              </motion.span>
              <div>
                <div className="text-[11px] font-bold tracking-[0.28em] uppercase opacity-45">
                  {t(role === "accountant" ? "Practice access" : "Taxpayer access")}
                </div>
                <div className="serif text-[26px] leading-none">
                  {t(mode === "in" ? "Welcome back" : "Create your account")}
                </div>
              </div>
            </motion.div>

            {/* card */}
            <motion.div
              layout
              initial={{ opacity: 0, y: 34, filter: "blur(18px)", scale: 0.97 }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
              transition={{ duration: 0.6, delay: 0.05, ease: EASE }}
              className="glass relative overflow-hidden rounded-[34px] p-5"
            >
              {/* mode switch */}
              <div className="relative mb-4 flex rounded-full bg-foreground/6 p-1">
                {(["in", "up"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      sfx("tick");
                      setMode(m);
                      setNotice("");
                      setError("");
                    }}
                    onPointerEnter={() => sfx("hover")}
                    className="relative flex-1 rounded-full py-2 text-[12.5px] font-bold tracking-tight"
                  >
                    {mode === m && (
                      <motion.span
                        layoutId="auth-pill"
                        className="absolute inset-0 rounded-full bg-card shadow-soft"
                        transition={{ type: "spring", stiffness: 460, damping: 36 }}
                      />
                    )}
                    <span
                      className={
                        mode === m
                          ? "relative z-10 text-foreground"
                          : "relative z-10 text-muted-foreground"
                      }
                    >
                      {t(m === "in" ? "Sign in" : "Create account")}
                    </span>
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="grid gap-2.5">
                <AnimatePresence initial={false}>
                  {mode === "up" && (
                    <motion.div
                      key="name"
                      initial={{ opacity: 0, height: 0, filter: "blur(10px)" }}
                      animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
                      exit={{ opacity: 0, height: 0, filter: "blur(10px)" }}
                      transition={{ duration: 0.45, ease: EASE }}
                    >
                      <Field
                        icon={<Fingerprint className="size-4" />}
                        label={t("Full name")}
                        value={name}
                        onChange={setName}
                        type="text"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {mode === "up" && (
                  <div className="grid gap-1">
                    <label className="px-1 text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                      {t("Interface language")}
                    </label>
                    <LanguagePicker
                      value={preferences.language}
                      interfaceOnly
                      label={t("Choose interface language")}
                      onChange={(language) => {
                        if (typeof language === "string") updatePreferences({ language });
                      }}
                    />
                  </div>
                )}

                {mode === "up" && (
                  <div className="grid gap-1">
                    <label className="px-1 text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                      {t("Preferred currency")}
                    </label>
                    <CurrencyPicker
                      value={currencyCode}
                      onChange={setCurrencyCode}
                      label={t("Choose preferred currency")}
                    />
                  </div>
                )}

                <Field
                  icon={<Mail className="size-4" />}
                  label={t("Email")}
                  value={email}
                  onChange={setEmail}
                  type="email"
                />
                <Field
                  icon={<Lock className="size-4" />}
                  label={t("Password")}
                  value={pass}
                  onChange={setPass}
                  type="password"
                />

                <motion.button
                  type="submit"
                  disabled={!valid || busy || done}
                  whileHover={{ y: valid ? -2 : 0 }}
                  whileTap={{ scale: valid ? 0.985 : 1 }}
                  onPointerEnter={() => {
                    if (valid) sfx("hover");
                  }}
                  className="press mt-1.5 flex h-13 items-center justify-center gap-2 rounded-full bg-primary text-[14.5px] font-bold text-primary-foreground disabled:opacity-45"
                  style={{ boxShadow: "var(--shadow-accent)" }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {done ? (
                      <motion.span
                        key="done"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-2"
                      >
                        <Fingerprint className="size-4" /> {t("Authenticated")}
                      </motion.span>
                    ) : busy ? (
                      <motion.span
                        key="busy"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2"
                      >
                        <Loader2 className="size-4 animate-spin" /> {t("Securing session")}
                      </motion.span>
                    ) : (
                      <motion.span
                        key="idle"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2"
                      >
                        {t(mode === "in" ? "Sign in" : "Create account")}
                        <ArrowRight className="size-4" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              </form>

              {notice && (
                <p
                  role="status"
                  className="mt-3 text-center text-[12px] font-semibold text-primary"
                >
                  {notice}
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-3 text-center text-[12px] font-semibold text-destructive"
                >
                  {t(error)}
                </p>
              )}

              <div className="mt-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-foreground/10" />
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-40">
                  {t("or continue with")}
                </span>
                <span className="h-px flex-1 bg-foreground/10" />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    sfx("pop");
                    try {
                      const nativeGoogleAuth = (
                        window as Window & {
                          FiscoGoogleAuth?: { postMessage: (message: string) => void };
                        }
                      ).FiscoGoogleAuth;
                      if (nativeGoogleAuth) {
                        setBusy(true);
                        setError("");
                        nativeGoogleAuth.postMessage("sign-in");
                        return;
                      }
                      await signInWithOAuth("google");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t("Google sign in error"));
                    }
                  }}
                  className="press flex h-11 items-center justify-center gap-2 rounded-2xl bg-secondary/80 text-[13px] font-bold hover:bg-secondary transition-colors"
                >
                  <svg className="size-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Google</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    sfx("pop");
                    try {
                      await signInWithOAuth("apple");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t("Apple sign in error"));
                    }
                  }}
                  className="press flex h-11 items-center justify-center gap-2 rounded-2xl bg-secondary/80 text-[13px] font-bold hover:bg-secondary transition-colors"
                >
                  <svg className="size-4 fill-current" viewBox="0 0 24 24">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.77 1.06-1.85.94-2.93-.91.04-2.02.61-2.67 1.37-.58.67-1.09 1.76-.95 2.82 1.02.08 2.05-.49 2.68-1.26z" />
                  </svg>
                  <span>Apple</span>
                </button>
              </div>

              <p className="mt-4 text-center text-[11px] font-semibold text-muted-foreground">
                {t("Protected session · your documents stay private")}
              </p>
            </motion.div>
          </div>

          {/* success wash covers the entire gate, not just the auth card */}
          <AnimatePresence>
            {done && (
              <motion.div
                className="absolute inset-0 z-[105] grid place-items-center bg-ink/95 text-ink-foreground backdrop-blur-xl"
                initial={{ opacity: 0, clipPath: "circle(0px at 50% 50%)" }}
                animate={{ opacity: 1, clipPath: "circle(150vmax at 50% 50%)" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.52, ease: EASE }}
              >
                <div className="text-center">
                  <motion.span
                    className="mx-auto grid size-20 place-items-center rounded-full border border-ink-foreground/20 bg-ink-foreground/8"
                    initial={{ scale: 0.7 }}
                    animate={{ scale: [0.7, 1.08, 1] }}
                    transition={{ duration: 0.52, ease: EASE }}
                  >
                    <Fingerprint className="size-10" strokeWidth={1.5} />
                    <motion.span
                      className="absolute size-20 rounded-full border border-primary/70"
                      animate={{ scale: [0.78, 1.35], opacity: [0.9, 0] }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: "easeOut" }}
                    />
                  </motion.span>
                  <p className="mt-4 text-[15px] font-extrabold">{t("Identity confirmed")}</p>
                  <p className="mt-1 text-[11px] text-ink-foreground/55">
                    {t("Opening your secure space")}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({
  icon,
  label,
  value,
  onChange,
  type,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
}) {
  const [focus, setFocus] = useState(false);
  const lifted = focus || value.length > 0;
  return (
    <label className="relative block">
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        animate={{
          boxShadow: focus
            ? "0 0 0 2px color-mix(in oklab, var(--primary) 45%, transparent)"
            : "0 0 0 1px color-mix(in oklab, var(--foreground) 8%, transparent)",
        }}
        transition={{ duration: 0.25 }}
      />
      <span className="absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground">{icon}</span>
      <motion.span
        className="pointer-events-none absolute left-11 font-semibold text-muted-foreground"
        animate={{
          top: lifted ? 9 : "50%",
          y: lifted ? 0 : "-50%",
          fontSize: lifted ? 10 : 13,
          letterSpacing: lifted ? "0.14em" : "0em",
          opacity: lifted ? 0.6 : 0.85,
        }}
        transition={{ duration: 0.28, ease: EASE }}
      >
        <span className={lifted ? "uppercase" : ""}>{label}</span>
      </motion.span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setFocus(true);
          sfx("tap");
        }}
        onBlur={() => setFocus(false)}
        className="h-14 w-full rounded-2xl bg-card/70 pt-4 pr-4 pb-1 pl-11 text-[14px] font-semibold outline-none"
      />
    </label>
  );
}
