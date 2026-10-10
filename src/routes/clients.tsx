import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, MessageCircle, Search, UserRoundX, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Btn, Card, Chip, Label, Segmented } from "@/components/kit";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/ui-prefs";
import { ensureHumanConversation } from "@/lib/human-chat";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Your taxpayers — practice client list" },
      {
        name: "description",
        content:
          "Every taxpayer you file for, with documents received, open items and filing progress.",
      },
      { property: "og:title", content: "Your taxpayers — Fisco for accountants" },
      {
        property: "og:description",
        content: "Track filing progress and open items per taxpayer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Clients,
});

const EASE = [0.16, 1, 0.3, 1] as const;
const FILTERS = ["All", "Requests", "Approved", "Declined"] as const;

type Relationship = {
  id: string;
  taxpayer_id: string;
  status: "pending" | "active" | "rejected" | "ended";
  created_at: string;
  approved_at: string | null;
};

type TaxpayerProfile = { id: string; display_name: string | null; avatar_url: string | null };
type ClientRow = Relationship & {
  name: string;
  photo: string | undefined;
  conversationId?: string;
};

function Clients() {
  const t = useT();
  const navigate = useNavigate();
  const { role, user } = useStore();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "accountant" || !user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

    let alive = true;
    const load = async () => {
      setLoading(true);
      const { data, error: relationshipError } = await supabase
        .from("accountant_clients" as never)
        .select("id, taxpayer_id, status, created_at, approved_at")
        .eq("accountant_id", user.id)
        .in("status", ["pending", "active", "rejected"])
        .order("created_at", { ascending: false });
      if (relationshipError) {
        if (alive) {
          setError("Client relationships could not be loaded.");
          setLoading(false);
        }
        return;
      }

      const relationships = (data ?? []) as unknown as Relationship[];
      const ids = [...new Set(relationships.map((relationship) => relationship.taxpayer_id))];
      const { data: conversationData } = ids.length
        ? await supabase
            .from("conversations" as never)
            .select("id, taxpayer_id")
            .eq("accountant_id", user.id)
            .in("taxpayer_id", ids)
        : { data: [] };
      const conversationByTaxpayer = new Map(
        ((conversationData ?? []) as unknown as Array<{ id: string; taxpayer_id: string }>).map(
          (conversation) => [conversation.taxpayer_id, conversation.id],
        ),
      );
      const { data: profileData } = ids.length
        ? await supabase
            .from("profiles" as never)
            .select("id, display_name, avatar_url")
            .in("id", ids)
        : { data: [] };
      const profiles = (profileData ?? []) as unknown as TaxpayerProfile[];
      const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

      if (alive) {
        setRows(
          relationships.map((relationship) => {
            const profile = profileById.get(relationship.taxpayer_id);
            const conversationId = conversationByTaxpayer.get(relationship.taxpayer_id);
            return {
              ...relationship,
              name: profile?.display_name || "Taxpayer",
              photo: profile?.avatar_url ?? undefined,
              ...(conversationId ? { conversationId } : {}),
            };
          }),
        );
        setError(null);
        setLoading(false);
      }
    };

    void load();
    const channel = supabase
      .channel(`accountant-clients-page:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accountant_clients",
          filter: `accountant_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [role, user?.id, t]);

  const openClientChat = async (client: ClientRow) => {
    if (!user?.id) return;
    try {
      const conversationId =
        client.conversationId ?? (await ensureHumanConversation(user.id, client.taxpayer_id));
      setRows((previous) =>
        previous.map((row) => (row.id === client.id ? { ...row, conversationId } : row)),
      );
      sfx("open");
      void navigate({ to: "/chat", search: { thread: conversationId } });
    } catch {
      setError("This client conversation could not be opened.");
    }
  };

  const respond = async (client: ClientRow, approve: boolean) => {
    if (!user?.id) return;
    sfx(approve ? "confirm" : "close");
    const { error: updateError } = await supabase
      .from("accountant_clients" as never)
      .update({ status: approve ? "active" : "rejected" } as never)
      .eq("id", client.id)
      .eq("accountant_id", user.id);
    if (updateError) {
      setError("That request could not be updated. Please try again.");
      return;
    }

    if (approve) {
      const { data: existing } = await supabase
        .from("conversations" as never)
        .select("id")
        .eq("accountant_id", user.id)
        .eq("taxpayer_id", client.taxpayer_id)
        .maybeSingle();
      if (!existing) {
        const { error: conversationError } = await supabase
          .from("conversations" as never)
          .insert({ accountant_id: user.id, taxpayer_id: client.taxpayer_id } as never);
        if (conversationError && (conversationError as { code?: string }).code !== "23505") {
          setError("The client was approved, but chat could not be started yet.");
        }
      }
    }
  };

  const clients = useMemo(
    () =>
      rows
        .filter((client) => client.name.toLowerCase().includes(q.trim().toLowerCase()))
        .filter((client) =>
          filter === "All"
            ? true
            : filter === "Requests"
              ? client.status === "pending"
              : filter === "Approved"
                ? client.status === "active"
                : client.status === "rejected",
        ),
    [rows, q, filter],
  );

  return (
    <div>
      <PageHeader title={t("Taxpayers")} back backTo="/" />
      <div className="mx-auto w-full max-w-[980px] px-4 pt-4 pb-32">
        {role !== "accountant" ? (
          <Card className="p-6 text-center text-[13px] font-semibold text-muted-foreground">
            {t("Client approvals are available in accountant mode.")}
          </Card>
        ) : (
          <>
            <BlurFade>
              <div className="glass flex flex-wrap items-center gap-2 rounded-[26px] p-3">
                <div className="flex h-11 min-w-[200px] flex-1 items-center gap-2 rounded-full bg-card/70 px-4">
                  <Search className="size-4 opacity-45" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("Search a taxpayer")}
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <Segmented
                  options={FILTERS.map(t)}
                  value={t(filter)}
                  onChange={(value) =>
                    setFilter(FILTERS.find((option) => t(option) === value) ?? "All")
                  }
                />
              </div>
            </BlurFade>

            <BlurFade delay={0.05} className="mt-2.5 block">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  {
                    k: "Approved",
                    v: `${rows.filter((client) => client.status === "active").length}`,
                  },
                  {
                    k: "Requests",
                    v: `${rows.filter((client) => client.status === "pending").length}`,
                  },
                  {
                    k: "Declined",
                    v: `${rows.filter((client) => client.status === "rejected").length}`,
                  },
                  { k: "Total", v: `${rows.length}` },
                ].map((s) => (
                  <Card key={s.k} tone="glass" className="p-3.5">
                    <Label>{t(s.k)}</Label>
                    <div className="num mt-1 text-[20px] leading-none font-bold">{s.v}</div>
                  </Card>
                ))}
              </div>
            </BlurFade>

            <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {clients.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: Math.min(0.04 * i, 0.24), duration: 0.5, ease: EASE }}
                >
                  <Card tone="glass" className="h-full p-4">
                    <div className="flex items-center gap-3">
                      <Avatar src={c.photo} initials={c.name.slice(0, 2).toUpperCase()} size={42} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-extrabold">{c.name}</div>
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {c.status === "active"
                            ? t("Approved client")
                            : c.status === "pending"
                              ? t("Connection request")
                              : t("Request declined")}
                        </div>
                      </div>
                      <Chip
                        tone={
                          c.status === "active"
                            ? "positive"
                            : c.status === "rejected"
                              ? "light"
                              : "accent"
                        }
                      >
                        {c.status === "active"
                          ? t("Approved")
                          : c.status === "rejected"
                            ? t("Declined")
                            : t("Pending")}
                      </Chip>
                    </div>

                    {c.status === "pending" ? (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Btn variant="ghost" size="sm" onClick={() => void respond(c, false)}>
                          <UserRoundX className="size-4" /> {t("Decline")}
                        </Btn>
                        <Btn variant="accent" size="sm" onClick={() => void respond(c, true)}>
                          <Check className="size-4" /> {t("Approve")}
                        </Btn>
                      </div>
                    ) : c.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => void openClientChat(c)}
                        className="press mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-[12px] font-bold text-ink-foreground"
                      >
                        <MessageCircle className="size-3.5" /> {t("Message client")}
                      </button>
                    ) : null}
                  </Card>
                </motion.div>
              ))}
            </div>

            {error && (
              <p
                role="alert"
                className="mt-3 text-center text-[12px] font-semibold text-destructive"
              >
                {t(error)}
              </p>
            )}

            {loading ? (
              <Card className="mt-3 p-6 text-center text-[13px] text-muted-foreground">
                {t("Loading clients…")}
              </Card>
            ) : (
              clients.length === 0 && (
                <BlurFade delay={0.1} className="mt-8 block">
                  <div className="glass rounded-[28px] p-10 text-center">
                    <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary/10">
                      <Users className="size-7 text-primary" />
                    </div>
                    <div className="text-[17px] font-extrabold">{t("No taxpayers yet")}</div>
                    <div className="mt-1.5 text-[13px] text-muted-foreground">
                      {filter === "Requests"
                        ? t("New taxpayer requests will appear here for your approval.")
                        : filter === "Declined"
                          ? t("Declined requests will appear here.")
                          : t("Approved taxpayers will appear here and can message you privately.")}
                    </div>
                  </div>
                </BlurFade>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
