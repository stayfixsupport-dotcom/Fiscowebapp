import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, Check, Clock3, FileText, Inbox as InboxIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Btn, Card, Chip, Label } from "@/components/kit";
import { eur } from "@/lib/data";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { supabase } from "@/integrations/supabase/client";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode } from "@/lib/i18n";
import { ensureHumanConversation } from "@/lib/human-chat";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Client inbox — review incoming documents" },
      {
        name: "description",
        content: "Documents taxpayers have shared with your approved practice.",
      },
      { property: "og:title", content: "Client inbox — Fisco for accountants" },
      {
        property: "og:description",
        content: "Review, accept or return documents shared by approved taxpayers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InboxScreen,
});

const EASE = [0.16, 1, 0.3, 1] as const;
const TABS = ["To review", "Accepted", "Returned"] as const;

type DocumentRow = {
  id: string;
  owner_id: string;
  name: string;
  status: "sent" | "ready" | "returned";
  extracted_data: Record<string, unknown> | null;
  created_at: string;
};

type OwnerProfile = { id: string; display_name: string | null; avatar_url: string | null };
type AppointmentRequest = {
  id: string;
  taxpayer_id: string;
  starts_at: string;
  duration_minutes: number;
  meeting_type: "remote" | "office" | "client_site";
  status: "pending" | "accepted" | "rejected";
  clientName: string;
  photo: string | null;
};
type InboxRow = DocumentRow & {
  clientName: string;
  photo: string | null;
  amount: number;
  category: string;
  date: string;
  pages: number;
};
type ApprovedClient = {
  taxpayerId: string;
  name: string;
  photo: string | null;
  conversationId: string | null;
};

function InboxScreen() {
  const { role, user, accountantClientCount } = useStore();
  const navigate = useNavigate();
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale = localeCode(preferences.language);
  const [tab, setTab] = useState<(typeof TABS)[number]>("To review");
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [approvedClients, setApprovedClients] = useState<ApprovedClient[]>([]);
  const [appointmentRequests, setAppointmentRequests] = useState<AppointmentRequest[]>([]);
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
      const { data, error: documentError } = await supabase
        .from("documents" as never)
        .select("id, owner_id, name, status, extracted_data, created_at")
        .eq("accountant_id", user.id)
        .eq("owner_role", "taxpayer")
        .in("status", ["sent", "ready", "returned"])
        .order("created_at", { ascending: false });
      if (documentError) {
        if (alive) {
          setError("Shared documents could not be loaded.");
          setLoading(false);
        }
        return;
      }

      const documents = (data ?? []) as unknown as DocumentRow[];
      const [appointmentResult, clientsResult] = await Promise.all([
        supabase
          .from("appointment_requests" as never)
          .select("id, taxpayer_id, starts_at, duration_minutes, meeting_type, status")
          .eq("accountant_id", user.id)
          .in("status", ["pending", "accepted", "rejected"])
          .order("starts_at", { ascending: true }),
        supabase
          .from("accountant_clients" as never)
          .select("taxpayer_id")
          .eq("accountant_id", user.id)
          .eq("status", "active"),
      ]);
      const appointmentData = appointmentResult.data;
      const appointmentError = appointmentResult.error;
      const clientRelationships = (clientsResult.data ?? []) as unknown as Array<{
        taxpayer_id: string;
      }>;
      if (appointmentError) {
        if (alive) setError("Appointment requests could not be loaded.");
      }
      const requests = (appointmentData ?? []) as unknown as Omit<
        AppointmentRequest,
        "clientName" | "photo"
      >[];
      const clientIds = [...new Set(clientRelationships.map((client) => client.taxpayer_id))];
      const { data: conversationData } = clientIds.length
        ? await supabase
            .from("conversations" as never)
            .select("id, taxpayer_id")
            .eq("accountant_id", user.id)
            .in("taxpayer_id", clientIds)
        : { data: [] };
      const conversationByTaxpayer = new Map(
        ((conversationData ?? []) as unknown as Array<{ id: string; taxpayer_id: string }>).map(
          (conversation) => [conversation.taxpayer_id, conversation.id],
        ),
      );
      const ownerIds = [
        ...new Set([
          ...documents.map((document) => document.owner_id),
          ...requests.map((request) => request.taxpayer_id),
          ...clientIds,
        ]),
      ];
      const { data: profiles } = ownerIds.length
        ? await supabase
            .from("profiles" as never)
            .select("id, display_name, avatar_url")
            .in("id", ownerIds)
        : { data: [] };
      const profileById = new Map(
        ((profiles ?? []) as unknown as OwnerProfile[]).map((profile) => [profile.id, profile]),
      );

      if (!alive) return;
      setRows(
        documents.map((document) => {
          const extracted = document.extracted_data ?? {};
          const profile = profileById.get(document.owner_id);
          return {
            ...document,
            clientName: profile?.display_name || "Taxpayer",
            photo: profile?.avatar_url ?? null,
            amount: Number(extracted["amount"] ?? 0),
            category:
              typeof extracted["category"] === "string" ? extracted["category"] : "Document",
            date:
              typeof extracted["date"] === "string"
                ? extracted["date"]
                : new Date(document.created_at).toLocaleDateString(locale),
            pages: typeof extracted["pages"] === "number" ? extracted["pages"] : 1,
          };
        }),
      );
      setAppointmentRequests(
        requests.map((request) => {
          const profile = profileById.get(request.taxpayer_id);
          return {
            ...request,
            clientName: profile?.display_name || "Taxpayer",
            photo: profile?.avatar_url ?? null,
          };
        }),
      );
      setApprovedClients(
        clientIds.map((taxpayerId) => {
          const profile = profileById.get(taxpayerId);
          return {
            taxpayerId,
            name: profile?.display_name || "Taxpayer",
            photo: profile?.avatar_url ?? null,
            conversationId: conversationByTaxpayer.get(taxpayerId) ?? null,
          };
        }),
      );
      setError(appointmentError ? "Appointment requests could not be loaded." : null);
      setLoading(false);
    };

    void load();
    const channel = supabase
      .channel(`accountant-inbox:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `accountant_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointment_requests",
          filter: `accountant_id=eq.${user.id}`,
        },
        () => void load(),
      )
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
  }, [role, user?.id, locale]);

  const openApprovedClient = async (client: ApprovedClient) => {
    if (!user?.id) return;
    try {
      const conversationId =
        client.conversationId ?? (await ensureHumanConversation(user.id, client.taxpayerId));
      setApprovedClients((previous) =>
        previous.map((item) =>
          item.taxpayerId === client.taxpayerId ? { ...item, conversationId } : item,
        ),
      );
      sfx("open");
      void navigate({ to: "/chat", search: { thread: conversationId } });
    } catch {
      setError("This client conversation could not be opened.");
    }
  };

  const visible = useMemo(
    () =>
      rows.filter((row) =>
        tab === "To review"
          ? row.status === "sent"
          : tab === "Accepted"
            ? row.status === "ready"
            : row.status === "returned",
      ),
    [rows, tab],
  );

  const act = async (id: string, next: "ready" | "returned") => {
    if (!user?.id) return;
    sfx(next === "ready" ? "confirm" : "swipe");
    const { error: updateError } = await supabase
      .from("documents" as never)
      .update({ status: next } as never)
      .eq("id", id)
      .eq("accountant_id", user.id);
    if (updateError) {
      setError("That document could not be updated.");
      return;
    }
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, status: next } : row)));
  };

  const respondToAppointment = async (id: string, next: "accepted" | "rejected") => {
    if (!user?.id) return;
    const { error: updateError } = await supabase
      .from("appointment_requests" as never)
      .update({ status: next } as never)
      .eq("id", id)
      .eq("accountant_id", user.id);
    if (updateError) {
      setError("That appointment request could not be updated.");
      return;
    }
    setAppointmentRequests((previous) =>
      previous.map((request) => (request.id === id ? { ...request, status: next } : request)),
    );
    sfx(next === "accepted" ? "confirm" : "close");
  };

  return (
    <div>
      <PageHeader title="Client inbox" back backTo="/" />
      <div className="mx-auto w-full max-w-[900px] px-4 pt-4 pb-32">
        {role !== "accountant" ? (
          <Card className="p-6 text-center text-[13px] font-semibold text-muted-foreground">
            {t("Shared client documents are available in accountant mode.")}
          </Card>
        ) : (
          <>
            <BlurFade>
              <Card tone="ink" className="grid grid-cols-3 gap-3 p-5">
                {[
                  { k: "To review", v: rows.filter((row) => row.status === "sent").length },
                  { k: "Accepted", v: rows.filter((row) => row.status === "ready").length },
                  { k: "Approved clients", v: accountantClientCount },
                ].map((stat) => (
                  <div key={stat.k}>
                    <div className="num text-[26px] leading-none">{stat.v}</div>
                    <div className="mt-1.5 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-foreground/45">
                      {t(stat.k)}
                    </div>
                  </div>
                ))}
              </Card>
            </BlurFade>

            {approvedClients.length > 0 && (
              <section className="mt-4" aria-labelledby="approved-clients-heading">
                <div className="mb-2 flex items-center justify-between">
                  <h2 id="approved-clients-heading" className="text-[15px] font-extrabold">
                    {t("Approved clients")}
                  </h2>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {approvedClients.length}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {approvedClients.map((client) => (
                    <Card key={client.taxpayerId} className="flex items-center gap-3 p-3">
                      <Avatar
                        src={client.photo ?? undefined}
                        initials={client.name.slice(0, 2).toUpperCase()}
                        size={40}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold">
                        {client.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => void openApprovedClient(client)}
                        className="press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 text-[11px] font-bold"
                      >
                        {t("Message client")}
                      </button>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {appointmentRequests.length > 0 && (
              <section className="mt-4" aria-labelledby="appointment-requests-heading">
                <div className="mb-2 flex items-center justify-between">
                  <h2 id="appointment-requests-heading" className="text-[15px] font-extrabold">
                    {t("Appointment requests")}
                  </h2>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {appointmentRequests.filter((request) => request.status === "pending").length}{" "}
                    {t("pending")}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {appointmentRequests.map((request) => (
                    <Card key={request.id} className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={request.photo ?? undefined}
                          initials={request.clientName.slice(0, 2).toUpperCase()}
                          size={38}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-extrabold">
                            {request.clientName}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {new Date(request.starts_at).toLocaleString(locale, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}{" "}
                            · {request.duration_minutes} {t("min")} ·{" "}
                            {t(request.meeting_type.replace("_", " "))}
                          </div>
                        </div>
                        <Chip
                          tone={
                            request.status === "pending"
                              ? "accent"
                              : request.status === "accepted"
                                ? "positive"
                                : "light"
                          }
                        >
                          {t(request.status)}
                        </Chip>
                      </div>
                      {request.status === "pending" && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Btn
                            variant="ghost"
                            size="sm"
                            onClick={() => void respondToAppointment(request.id, "rejected")}
                          >
                            {t("Decline")}
                          </Btn>
                          <Btn
                            variant="accent"
                            size="sm"
                            onClick={() => void respondToAppointment(request.id, "accepted")}
                          >
                            <Check className="size-4" /> {t("Accept time")}
                          </Btn>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </section>
            )}

            <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto">
              {TABS.map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    sfx("pop");
                    setTab(item);
                  }}
                  className={`press relative shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold ${
                    item === tab ? "text-primary-foreground" : "bg-secondary/70 text-foreground/70"
                  }`}
                >
                  {item === tab && (
                    <motion.span
                      layoutId="inbox-tab"
                      className="absolute inset-0 rounded-full bg-primary"
                      transition={{ type: "spring", stiffness: 440, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{t(item)}</span>
                </button>
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
                {t("Loading shared documents…")}
              </Card>
            ) : (
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <AnimatePresence mode="popLayout">
                  {visible.map((row, index) => (
                    <motion.div
                      key={row.id}
                      layout
                      initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.96, filter: "blur(10px)" }}
                      transition={{ delay: 0.03 * index, duration: 0.45, ease: EASE }}
                    >
                      <Card className="h-full p-4">
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={row.photo ?? undefined}
                            initials={row.clientName.slice(0, 2).toUpperCase()}
                            size={38}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13.5px] font-extrabold">
                              {row.clientName}
                            </div>
                            <div className="truncate text-[11.5px] text-muted-foreground">
                              {row.name} · {row.date}
                            </div>
                          </div>
                          <span className="num text-[13.5px] font-bold">
                            {row.amount === 0 ? "—" : eur(row.amount)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <Chip>
                            <FileText className="size-3" /> {row.pages} {t("pages")}
                          </Chip>
                          <Chip tone={row.status === "sent" ? "accent" : "light"}>
                            {t(row.category)}
                          </Chip>
                        </div>
                        {row.status === "sent" ? (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <Btn
                              variant="ghost"
                              size="sm"
                              onClick={() => void act(row.id, "returned")}
                            >
                              {t("Return")}
                            </Btn>
                            <Btn
                              variant="accent"
                              size="sm"
                              onClick={() => void act(row.id, "ready")}
                            >
                              <Check className="size-4" /> {t("Accept")}
                            </Btn>
                          </div>
                        ) : (
                          <div className="mt-3 flex items-center gap-2 text-[12px] font-bold text-muted-foreground">
                            <Clock3 className="size-3.5" />
                            {row.status === "ready"
                              ? t("Accepted for filing")
                              : t("Returned to taxpayer")}
                          </div>
                        )}
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {!loading && visible.length === 0 && (
              <Card className="mt-3 grid place-items-center gap-2 p-10 text-center">
                <InboxIcon className="size-6 opacity-40" />
                <Label>{t("Nothing here")}</Label>
                <Link to="/clients" className="text-[12.5px] font-bold text-primary">
                  {t("Open clients")}
                </Link>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
