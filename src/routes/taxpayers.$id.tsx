import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, CalendarDays, FileText, Languages, MapPin, Target } from "lucide-react";
import { Avatar, Label } from "@/components/kit";
import { PageHeader } from "@/components/PageHeader";
import { useStore } from "@/lib/app-store";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/ui-prefs";
import { sfx } from "@/lib/sfx";

export const Route = createFileRoute("/taxpayers/$id")({
  head: () => ({
    meta: [{ title: "Taxpayer profile — Fisco" }, { name: "robots", content: "noindex" }],
  }),
  component: TaxpayerProfile,
});

type TaxpayerDetails = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  country_code: string | null;
  locale: string | null;
  spoken_language: string | null;
  created_at: string | null;
  updated_at: string | null;
  business_type: string | null;
  tax_residency: string | null;
  annual_turnover: string | null;
  goals: string[] | null;
  document_types: string[] | null;
  notes: string | null;
};

function dateLabel(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleDateString();
}

function TaxpayerProfile() {
  const { id } = Route.useParams();
  const { role, user } = useStore();
  const t = useT();
  const [profile, setProfile] = useState<TaxpayerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    if (role !== "accountant" || !user?.id) {
      setProfile(null);
      setLoading(false);
      setError(true);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(false);
      const { data: relationship, error: relationshipError } = await supabase
        .from("accountant_clients" as never)
        .select("id")
        .eq("accountant_id", user.id)
        .eq("taxpayer_id", id)
        .eq("status", "active")
        .maybeSingle();
      if (relationshipError || !relationship) {
        if (active) {
          setProfile(null);
          setError(true);
          setLoading(false);
        }
        return;
      }

      const [profileResult, taxpayerResult] = await Promise.all([
        supabase
          .from("profiles" as never)
          .select(
            "id, display_name, avatar_url, country_code, locale, spoken_language, created_at, updated_at",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("taxpayer_profiles" as never)
          .select(
            "id, display_name, avatar_url, country_code, business_type, tax_residency, spoken_language, annual_turnover, goals, document_types, notes, updated_at",
          )
          .eq("id", id)
          .maybeSingle(),
      ]);
      if (!active) return;
      if (profileResult.error || taxpayerResult.error || !profileResult.data) {
        setProfile(null);
        setError(true);
      } else {
        const base = profileResult.data as unknown as TaxpayerDetails;
        const details = taxpayerResult.data as unknown as Partial<TaxpayerDetails> | null;
        setProfile({ ...base, ...details, id });
      }
      setLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [id, role, user?.id]);

  const value = (item: string | null | undefined) => item?.trim() || t("Not provided");
  const name = profile?.display_name || t("Taxpayer");

  return (
    <main className="min-h-[100dvh] pb-32">
      <PageHeader title={t("Client profile")} back />
      <div className="mx-auto w-full max-w-[680px] px-4 pt-4">
        {loading ? (
          <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
            {t("Loading profile…")}
          </div>
        ) : error || !profile ? (
          <div className="glass rounded-2xl p-6 text-center">
            <p className="text-sm font-semibold">{t("This client profile is unavailable.")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Only an active accountant can view this profile.")}
            </p>
          </div>
        ) : (
          <>
            <section className="glass rounded-2xl p-5">
              <div className="flex items-center gap-3.5">
                <Avatar
                  src={profile.avatar_url ?? undefined}
                  initials={name.slice(0, 2)}
                  size={58}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xl font-extrabold">{name}</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">
                    {value(profile.country_code)} · {t("Taxpayer")}
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-4">
              <Label>{t("Tax profile")}</Label>
              <div className="mt-2 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/50 px-4">
                <ProfileRow
                  icon={Building2}
                  label={t("Business type")}
                  value={value(profile.business_type)}
                />
                <ProfileRow
                  icon={MapPin}
                  label={t("Tax residency")}
                  value={value(profile.tax_residency)}
                />
                <ProfileRow
                  icon={Languages}
                  label={t("Spoken language")}
                  value={value(profile.spoken_language || profile.locale)}
                />
                <ProfileRow
                  icon={FileText}
                  label={t("Annual turnover")}
                  value={value(profile.annual_turnover)}
                />
                <ProfileRow
                  icon={CalendarDays}
                  label={t("Profile created")}
                  value={dateLabel(profile.created_at)}
                />
                <ProfileRow
                  icon={CalendarDays}
                  label={t("Last updated")}
                  value={dateLabel(profile.updated_at)}
                />
              </div>
            </section>

            <ProfileList
              icon={Target}
              label={t("Goals")}
              values={profile.goals ?? []}
              empty={t("No goals added")}
            />
            <ProfileList
              icon={FileText}
              label={t("Document types")}
              values={profile.document_types ?? []}
              empty={t("No document types selected")}
            />

            <section className="mt-4 rounded-2xl border border-border/60 bg-card/50 p-4">
              <Label>{t("Notes")}</Label>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {value(profile.notes)}
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="max-w-[58%] break-words text-right text-sm font-bold">{value}</span>
    </div>
  );
}

function ProfileList({
  icon: Icon,
  label,
  values,
  empty,
}: {
  icon: typeof Target;
  label: string;
  values: string[];
  empty: string;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <Label>{label}</Label>
      </div>
      {values.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {values.map((item) => (
            <li
              key={item}
              className="rounded-full border border-border/60 px-3 py-1.5 text-xs font-semibold"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
