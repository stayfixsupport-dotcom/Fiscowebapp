import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppStoreProvider, useStore } from "@/lib/app-store";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/nav/BottomNav";
import { RoleGate } from "@/components/RoleGate";
import { AuthGate } from "@/components/AuthGate";
import { ChatFab } from "@/components/nav/ChatFab";
import { PracticeGate } from "@/components/accountant/PracticeGate";
import { TaxpayerProfileGate } from "@/components/TaxpayerProfileGate";
import { Ambient } from "@/components/motion/Ambient";
import { NavigationMotion, RouteStage } from "@/components/motion/NavigationMotion";
import { UIPreferencesProvider } from "@/lib/ui-prefs";
import { FiscoLoader } from "@/components/FiscoLoader";
import { FiscoOrb } from "@/components/FiscoOrb";
import { AVATAR_OPTIONS } from "@/lib/illustrations";
import { sfx } from "@/lib/sfx";
import { useT, useUIPreferences } from "@/lib/ui-prefs";

function NotFoundComponent() {
  const router = useRouter();
  useEffect(() => {
    void router.navigate({ to: "/", replace: true });
  }, [router]);
  return null;
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  useEffect(() => {
    if (pathname !== "/") void router.navigate({ to: "/", replace: true });
  }, [pathname, router]);

  return (
    <main role="alert" className="grid min-h-[50vh] place-content-center gap-4 p-6 text-center">
      <p>Unable to open this view.</p>
      <button
        type="button"
        className="mx-auto rounded-lg border px-4 py-2"
        onClick={() => {
          router.invalidate();
          reset();
        }}
      >
        Try again
      </button>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Fisco — Scan Invoices, Find an Accountant Near You" },
      {
        name: "description",
        content:
          "Fisco is the smart accounting app that scans invoices with AI, organises your documents, and connects you with a verified accountant nearby. Available in Poland, France, Algeria and worldwide.",
      },
      {
        name: "keywords",
        content:
          "accountant near me, scan invoice AI, tax help, VAT return, document scanning, accounting app, bookkeeping, fiscal documents, comptable, NIP, comptabilité",
      },
      { name: "author", content: "Fisco" },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Fisco" },
      { property: "og:title", content: "Fisco — Scan Invoices, Find an Accountant Near You" },
      {
        property: "og:description",
        content:
          "Scan invoices, organize purchases and connect with a nearby accountant in seconds.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Fisco — Your accounting, organized" },
      {
        name: "twitter:description",
        content: "AI document scanning + find a verified accountant near you.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700;800&display=swap",
      },
      { rel: "preconnect", href: "https://basemaps.cartocdn.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://basemaps.cartocdn.com" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add("fisco-loader-boot");
            try {
              const preferenceKey = "fisco.ui-preferences.v1";
              const preferences = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
              if (typeof preferences.language !== "string" || !preferences.language) {
                const locales = [...(navigator.languages || []), navigator.language];
                const code = locales.map((locale) => locale.toLowerCase().split(/[-_]/)[0])
                  .find((locale) => ["en", "fr", "ar"].includes(locale)) || "en";
                preferences.language = { en: "English", fr: "French", ar: "Arabic" }[code];
                localStorage.setItem(preferenceKey, JSON.stringify(preferences));
              }
              const code = { English: "en", French: "fr", Arabic: "ar" }[preferences.language] || "en";
              document.documentElement.lang = code;
              document.documentElement.dir = code === "ar" ? "rtl" : "ltr";
            } catch {}
            try {
              document.documentElement.dataset.fiscoLoaderShape = String(Math.floor(Math.random() * 4));
              const navigation = performance.getEntriesByType("navigation")[0];
              const pendingAuthAt = Number(localStorage.getItem("fisco.auth.loading.pending.v1"));
              const authFailed = new URLSearchParams(location.search).has("error") ||
                new URLSearchParams(location.hash.slice(1)).has("error");
              const authPending = !authFailed && pendingAuthAt > 0 && Date.now() - pendingAuthAt < 300000;
              if (authFailed || (pendingAuthAt > 0 && !authPending)) {
                localStorage.removeItem("fisco.auth.loading.pending.v1");
              }
            } catch {}`,
          }}
        />
      </head>
      <body>
        <UIPreferencesProvider>
          <FiscoLoader mode="loading" bootOnly />
          {children}
        </UIPreferencesProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <UIPreferencesProvider>
        <AppStoreProvider>
          <RootContent />
        </AppStoreProvider>
      </UIPreferencesProvider>
    </QueryClientProvider>
  );
}

function RootContent() {
  const { role, roleReady, user, documentsStatus, taxpayerSetupOpen, practice, practiceSetupOpen } =
    useStore();
  const { preferencesReady } = useUIPreferences();
  const t = useT();
  const router = useRouter();
  const [loaderFinished, setLoaderFinished] = useState(false);
  const [loaderMode, setLoaderMode] = useState<"intro" | "refresh" | "loading" | null>(null);
  const [loaderRun, setLoaderRun] = useState(0);
  const [loaderAssetsReady, setLoaderAssetsReady] = useState(true);
  const [aiEntryLoading, setAiEntryLoading] = useState(false);
  const aiEntryTimer = useRef<number | null>(null);
  const finishLoader = useCallback(() => {
    setLoaderFinished(true);
    setLoaderMode(null);
    setLoaderAssetsReady(true);
    document.documentElement.classList.remove("fisco-loader-boot");
    try {
      window.localStorage.setItem("fisco.intro.seen.v1", "1");
      window.localStorage.removeItem("fisco.auth.loading.pending.v1");
    } catch {
      return;
    }
  }, []);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isNotFound = router.hasNotFoundMatch();
  const isAiEntryRoute =
    pathname === "/chat" || pathname === "/fisco-ai" || pathname === "/chat/fisco-ai";
  const taxpayerSetupPending = role === "taxpayer" && taxpayerSetupOpen && !isAiEntryRoute;
  const practiceSetupPending = role === "accountant" && practiceSetupOpen && !practice.onboarded;
  const hidePracticeNavigation = practiceSetupPending || pathname === "/practice-profile";
  const canShowRoute =
    isNotFound ||
    (roleReady && !!role && !!user && !taxpayerSetupPending && !practiceSetupPending) ||
    (roleReady && role !== null && user === null && pathname === "/map");

  useEffect(() => {
    if (!user?.id) return;

    const registerToken = (candidate?: unknown) => {
      let payload = candidate;
      if (!payload) {
        try {
          payload = JSON.parse(window.localStorage.getItem("fisco.native-push-token.v1") || "null");
        } catch {
          return;
        }
      }
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== "object") return;

      const registration = payload as { token?: unknown; platform?: unknown };
      if (
        typeof registration.token !== "string" ||
        (registration.platform !== "android" && registration.platform !== "ios")
      ) {
        return;
      }

      void supabase
        .from("push_tokens" as never)
        .upsert(
          {
            user_id: user.id,
            token: registration.token,
            platform: registration.platform,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "user_id,token" },
        )
        .then(({ error }) => {
          if (error) console.warn("Could not register native push token.", error.code);
        })
        .catch((error: unknown) => console.warn("Could not register native push token.", error));
    };

    const handleNativePushToken = (event: Event) => {
      registerToken((event as CustomEvent<unknown>).detail);
    };

    registerToken();
    window.addEventListener("fisco:native-push-token", handleNativePushToken);
    return () => window.removeEventListener("fisco:native-push-token", handleNativePushToken);
  }, [user?.id]);

  useLayoutEffect(() => {
    try {
      const introSeen = window.localStorage.getItem("fisco.intro.seen.v1") === "1";
      const pendingAuthAt = Number(window.localStorage.getItem("fisco.auth.loading.pending.v1"));
      const authFailed =
        new URLSearchParams(window.location.search).has("error") ||
        new URLSearchParams(window.location.hash.slice(1)).has("error");
      const authPending = !authFailed && pendingAuthAt > 0 && Date.now() - pendingAuthAt < 300000;
      if (authFailed || (pendingAuthAt > 0 && !authPending)) {
        window.localStorage.removeItem("fisco.auth.loading.pending.v1");
      }
      const navigation = window.performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const nextLoaderMode = !introSeen
        ? "intro"
        : authPending
          ? "loading"
          : navigation?.type === "reload"
            ? "refresh"
            : null;
      if (nextLoaderMode) {
        document.documentElement.classList.add("fisco-loader-live");
      }
      setLoaderMode(nextLoaderMode);
      if (!nextLoaderMode) {
        setLoaderFinished(true);
        document.documentElement.classList.remove("fisco-loader-boot");
      }
    } catch {
      setLoaderMode("intro");
    }
  }, []);

  useEffect(() => {
    const restartIntro = () => {
      document.documentElement.dataset.fiscoLoaderShape = String(Math.floor(Math.random() * 4));
      setLoaderRun((run) => run + 1);
      setLoaderFinished(false);
      setLoaderMode("intro");
    };
    const showLoading = () => {
      setLoaderAssetsReady(false);
      void Promise.all(
        AVATAR_OPTIONS.map(
          (src) =>
            new Promise<void>((resolve) => {
              const image = new Image();
              image.src = src;
              void image.decode().then(resolve, resolve);
            }),
        ),
      ).then(() => setLoaderAssetsReady(true));
      document.documentElement.dataset.fiscoLoaderShape = String(Math.floor(Math.random() * 4));
      setLoaderRun((run) => run + 1);
      setLoaderFinished(false);
      setLoaderMode("loading");
    };
    window.addEventListener("fisco:restart-intro", restartIntro);
    window.addEventListener("fisco:show-loading", showLoading);
    return () => {
      window.removeEventListener("fisco:restart-intro", restartIntro);
      window.removeEventListener("fisco:show-loading", showLoading);
    };
  }, []);

  useEffect(() => {
    const beginAiEntry = () => {
      if (aiEntryTimer.current !== null) window.clearTimeout(aiEntryTimer.current);
      setAiEntryLoading(false);
      aiEntryTimer.current = window.setTimeout(() => {
        aiEntryTimer.current = null;
        setAiEntryLoading(true);
        sfx("thinking");
      }, 240);
    };
    const cancelAiEntry = () => {
      if (aiEntryTimer.current !== null) window.clearTimeout(aiEntryTimer.current);
      aiEntryTimer.current = null;
      setAiEntryLoading(false);
    };
    window.addEventListener("fisco:enter-ai", beginAiEntry);
    window.addEventListener("fisco:cancel-ai-entry", cancelAiEntry);
    return () => {
      cancelAiEntry();
      window.removeEventListener("fisco:enter-ai", beginAiEntry);
      window.removeEventListener("fisco:cancel-ai-entry", cancelAiEntry);
    };
  }, []);

  useEffect(() => {
    if (pathname === "/fisco-ai" || pathname === "/chat/fisco-ai") {
      if (aiEntryTimer.current !== null) window.clearTimeout(aiEntryTimer.current);
      aiEntryTimer.current = null;
      setAiEntryLoading(false);
    }
  }, [pathname]);

  return (
    <>
      <Ambient />
      <RouteStage>{canShowRoute ? <Outlet /> : null}</RouteStage>
      {canShowRoute && !isNotFound && pathname !== "/scan" && !hidePracticeNavigation && (
        <BottomNav />
      )}
      {canShowRoute && !isNotFound && pathname !== "/scan" && !hidePracticeNavigation && (
        <ChatFab />
      )}
      {canShowRoute && !isNotFound && <NavigationMotion />}
      <RoleGate enabled={!isNotFound && loaderFinished && preferencesReady} />
      <AuthGate enabled={!isNotFound && loaderFinished && preferencesReady} />
      <TaxpayerProfileGate />
      <PracticeGate />
      {loaderMode && !loaderFinished ? (
        <FiscoLoader
          key={loaderRun}
          mode={loaderMode === "intro" ? "intro" : "loading"}
          interval={1200}
          maxDuration={loaderMode === "intro" ? 4200 : 10000}
          canFinish={
            roleReady &&
            documentsStatus !== "loading" &&
            loaderAssetsReady &&
            (loaderMode !== "loading" || !!user)
          }
          onDone={finishLoader}
        />
      ) : null}
      <AnimatePresence>
        {aiEntryLoading && (
          <motion.div
            role="status"
            aria-label={t("Opening Fisco AI")}
            aria-live="polite"
            className="fixed inset-0 z-[90] grid place-items-center px-5"
            style={{
              background: "oklch(0.12 0.006 50 / 0.2)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(10px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              className="glass flex items-center gap-3 rounded-[22px] border border-white/20 px-4 py-3 shadow-2xl"
              initial={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -4, scale: 0.99, filter: "blur(5px)" }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            >
              <FiscoOrb size={40} state="thinking" priority />
              <span className="pr-2 text-sm font-bold">{t("Opening Fisco AI")}</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
