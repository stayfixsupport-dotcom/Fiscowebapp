import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, Label } from "@/components/kit";
import { FeeAnalyticsPanel } from "@/components/accountant/FeeAnalyticsPanel";
import { useStore } from "@/lib/app-store";
import { compactPracticeLocation } from "@/lib/practice-profile";
import { sfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/practice")({
  head: () => ({
    meta: [
      { title: "Practice — Fisco" },
      {
        name: "description",
        content: "Your practice profile and client documents.",
      },
      { property: "og:title", content: "Practice — Fisco" },
      { property: "og:description", content: "Your practice profile and client documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Practice,
});

function Practice() {
  const t = useT();
  const { docs, practice } = useStore();
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [selectedClientId, setSelectedClientId] = useState("all");
  const clientIds = useMemo(
    () => [...new Set(docs.flatMap((doc) => (doc.ownerId ? [doc.ownerId] : [])))],
    [docs],
  );
  const visibleDocs =
    selectedClientId === "all"
      ? docs
      : docs.filter((document) => document.ownerId === selectedClientId);

  useEffect(() => {
    let active = true;
    if (clientIds.length === 0) {
      setClientNames({});
      return;
    }

    void supabase
      .from("profiles" as never)
      .select("id, display_name")
      .in("id", clientIds)
      .then(({ data }) => {
        if (!active) return;
        const profiles = (data ?? []) as unknown as Array<{
          id: string;
          display_name: string | null;
        }>;
        setClientNames(
          Object.fromEntries(
            profiles.map((profile) => [profile.id, profile.display_name || "Client"]),
          ),
        );
      });

    return () => {
      active = false;
    };
  }, [clientIds]);

  return (
    <div>
      <PageHeader title="Practice" back backTo="/" />
      <div className="mx-auto w-full max-w-[1100px] px-4 pt-4 pb-32">
        <Card tone="ink" className="p-5">
          <Label className="text-ink-foreground/55">{t("Practice profile")}</Label>
          <h2 className="mt-2 text-[22px] font-extrabold text-ink-foreground">
            {practice.firm || t("Complete your practice profile")}
          </h2>
          <p className="mt-1 line-clamp-1 text-[12px] font-semibold text-ink-foreground/55">
            {practice.onboarded && practice.address
              ? compactPracticeLocation(practice.address, practice.city)
              : t("Add your business details and service area.")}
          </p>
          <Link
            to="/practice-profile"
            onClick={() => sfx("open")}
            className="press mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground"
          >
            {t("Edit profile")}
          </Link>
        </Card>

        <div className="mt-3">
          <FeeAnalyticsPanel />
        </div>

        <section className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-extrabold">{t("Client documents")}</h2>
            {docs.length > 0 && (
              <select
                aria-label={t("Filter client documents")}
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.currentTarget.value)}
                className="min-h-9 max-w-[55%] rounded-full border border-border bg-card px-3 text-[11px] font-bold"
              >
                <option value="all">{t("All clients")}</option>
                {clientIds.map((clientId) => (
                  <option key={clientId} value={clientId}>
                    {clientNames[clientId] || t("Client")}
                  </option>
                ))}
              </select>
            )}
          </div>
          {docs.length === 0 ? (
            <Card className="mt-2 p-7 text-center">
              <FileText className="mx-auto size-7 opacity-35" />
              <p className="mt-3 text-[13px] font-bold">{t("No client documents yet")}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {t("Documents shared with your practice will appear here.")}
              </p>
              <Link
                to="/inbox"
                onClick={() => sfx("open")}
                className="press mt-4 inline-flex rounded-full bg-secondary px-4 py-2 text-[12px] font-bold"
              >
                {t("Open inbox")}
              </Link>
            </Card>
          ) : (
            <Card className="mt-2 divide-y divide-border/70 p-1.5">
              {visibleDocs.map((doc) => (
                <Link
                  key={doc.id}
                  to="/documents/$id"
                  params={{ id: doc.id }}
                  onClick={() => sfx("open")}
                  className="press flex items-center gap-3 px-2.5 py-3"
                >
                  <FileText className="size-4 shrink-0 opacity-55" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{doc.merchant}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {clientNames[doc.ownerId ?? ""] || t("Client")} · {t(doc.category)} ·{" "}
                      {doc.date} · {t(doc.status)}
                    </span>
                  </span>
                </Link>
              ))}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
