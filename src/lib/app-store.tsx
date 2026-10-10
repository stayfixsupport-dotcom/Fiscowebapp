import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FALLBACK_CENTER, type Accountant, type Doc } from "./data";
import { distanceKm, PRECISE_LOCATION_ACCURACY_METERS, type LngLat } from "./geo";
import { fetchAccountantDirectory, mapAccountant } from "./accountants";
import { THREADS, type ChatMsg, type ChatThread } from "./chat";
import {
  DEFAULT_PROFILE,
  readProfile,
  writeProfile,
  currencyForCountry,
  type PracticeProfile,
} from "./practice-profile";
import { supabase } from "@/integrations/supabase/client";
import { EMPTY_TAXPAYER_PROFILE, type TaxpayerProfile } from "./taxpayer-profile";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { isValidPhoneNumber } from "libphonenumber-js";
import tzLookup from "tz-lookup";

type Appointment = { accountantId: string; day: string; slot: string } | null;
type SelectedRelationshipRow = {
  accountant_id?: string;
  status?: "pending" | "active" | "rejected";
};

export type Role = "taxpayer" | "accountant";
export type LocationSource = "device" | "network" | null;

export type User = { id: string; name: string; email: string; initials: string; photo?: string };

const ROLE_KEY = "fisco.role.v2";
const ACCOUNTANT_DIRECTORY_KEY = "fisco.accountant-directory.v1";

function readAccountantDirectoryCache(): Accountant[] {
  if (typeof window === "undefined") return [];
  try {
    const cached: unknown = JSON.parse(
      window.localStorage.getItem(ACCOUNTANT_DIRECTORY_KEY) ?? "[]",
    );
    if (!Array.isArray(cached)) return [];
    return cached.filter((item): item is Accountant => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<Accountant>;
      return (
        typeof row.id === "string" &&
        typeof row.name === "string" &&
        typeof row.countryCode === "string" &&
        Number.isFinite(row.lat) &&
        Number.isFinite(row.lng)
      );
    });
  } catch {
    return [];
  }
}

type Store = {
  position: LngLat;
  located: boolean;
  locating: boolean;
  locationAccuracy: number | null;
  locationSource: LocationSource;
  locationError: string | null;
  country: string | null;
  setCountry: (c: string) => void;
  requestLocation: () => void;
  chosenId: string | null;
  choose: (id: string | null) => Promise<boolean>;
  chosenRelationshipStatus: "pending" | "active" | "rejected" | null;
  docs: Doc[];
  documentsStatus: "loading" | "ready" | "error";
  addDoc: (d: Doc, mimeType?: string) => Promise<boolean>;
  removeDoc: (id: string) => void;
  markSent: (ids: string[], accountantId?: string) => Promise<boolean>;
  appointment: Appointment;
  setAppointment: (a: Appointment) => void;
  role: Role | null;
  roleReady: boolean;
  setRole: (r: Role | null) => void;
  user: User | null;
  setUserPhoto: (photo: string | null) => Promise<boolean>;
  saveAvatar: (file: File) => Promise<string>;
  signIn: (
    email: string,
    password: string,
    name?: string,
    currencyCode?: string,
  ) => Promise<"authenticated" | "confirmation-required">;
  signInWithOAuth: (provider: "google" | "apple") => Promise<void>;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  practice: PracticeProfile;
  savePractice: (p: PracticeProfile) => Promise<boolean>;
  practiceSaveError: string | null;
  practiceSetupOpen: boolean;
  skipPracticeSetup: () => void;
  taxpayerSetupOpen: boolean;
  skipTaxpayerSetup: () => void;
  openTaxpayerSetup: () => void;
  taxpayerProfile: TaxpayerProfile;
  saveTaxpayerProfile: (profile: TaxpayerProfile) => Promise<boolean>;
  threads: ChatThread[];
  messages: ChatMsg[];
  sendMessage: (threadId: string, text: string, quick?: boolean) => void;
  broadcast: (text: string) => void;
  ranked: (Accountant & { km: number })[];
  accountants: Accountant[];
  accountantsLoadError: boolean;
  refreshAccountants: () => Promise<void>;
  accountantClientCount: number;
};

type DocumentRow = {
  id: string;
  owner_id: string;
  owner_role?: Role;
  name: string | null;
  extracted_data: Record<string, unknown> | null;
  created_at: string;
  status: string;
  mime_type?: string;
  drive_file_id: string | null;
  preview_url: string | null;
  embed_url: string | null;
};

function mapDocumentRows(rows: DocumentRow[]): Doc[] {
  return rows.map((document) => {
    const extracted = document.extracted_data ?? {};
    const rawLineItems = Array.isArray(extracted["lineItems"]) ? extracted["lineItems"] : [];
    const lineItems = rawLineItems.flatMap((line) => {
      if (typeof line !== "object" || line === null) return [];
      const item = line as Record<string, unknown>;
      if (typeof item["label"] !== "string") return [];
      const amount = Number(item["amount"]);
      return [{ label: item["label"], amount: Number.isFinite(amount) ? amount : 0 }];
    });
    const hasAiDetails = [
      "taxId",
      "vat",
      "invoiceNumber",
      "lineItems",
      "summary",
      "confidence",
      "raw",
    ].some((key) => key in extracted);
    const status =
      document.status === "ready" ? "stored" : document.status === "sent" ? "sent" : "pending";

    return {
      id: document.id,
      ownerId: document.owner_id,
      merchant: document.name || "Invoice",
      amount: Number(extracted["amount"] ?? 0),
      ...(typeof extracted["currency"] === "string" ? { currency: extracted["currency"] } : {}),
      date:
        typeof extracted["date"] === "string"
          ? extracted["date"]
          : new Date(document.created_at).toLocaleDateString(),
      createdAt: document.created_at,
      category:
        typeof extracted["category"] === "string"
          ? (extracted["category"] as Doc["category"])
          : "Invoice",
      status,
      pages:
        typeof extracted["pages"] === "number" && extracted["pages"] > 0 ? extracted["pages"] : 1,
      tint: "from-[#EAF7EE] to-[#D8EEDF]",
      ...(hasAiDetails
        ? {
            aiDetails: {
              taxId: typeof extracted["taxId"] === "string" ? extracted["taxId"] : null,
              vat: typeof extracted["vat"] === "number" ? extracted["vat"] : null,
              invoiceNumber:
                typeof extracted["invoiceNumber"] === "string" ? extracted["invoiceNumber"] : null,
              lineItems,
              summary: typeof extracted["summary"] === "string" ? extracted["summary"] : "",
              confidence:
                typeof extracted["confidence"] === "number" ? extracted["confidence"] : null,
              raw: typeof extracted["raw"] === "string" ? extracted["raw"] : "",
            },
          }
        : {}),
      ...(document.preview_url
        ? { driveUrl: document.preview_url }
        : document.embed_url
          ? { driveUrl: document.embed_url }
          : {}),
      ...(document.drive_file_id ? { driveFileId: document.drive_file_id } : {}),
      ...(document.mime_type ? { mimeType: document.mime_type } : {}),
      ...(document.preview_url ? { previewUrl: document.preview_url } : {}),
      ...(document.embed_url ? { embedUrl: document.embed_url } : {}),
    };
  });
}

const g = globalThis as unknown as { __fiscoStoreCtx?: React.Context<Store | null> };
const Ctx = (g.__fiscoStoreCtx ??= createContext<Store | null>(null));

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<LngLat>(FALLBACK_CENTER);
  const [located, setLocated] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [chosenRelationshipStatus, setChosenRelationshipStatus] = useState<
    Store["chosenRelationshipStatus"]
  >(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [documentsStatus, setDocumentsStatus] = useState<Store["documentsStatus"]>("loading");
  const [country, setCountryState] = useState<string | null>(null);
  const deviceCountryResolved = useRef(false);
  const [accountants, setAccountants] = useState<Accountant[]>([]);
  const [accountantsLoadError, setAccountantsLoadError] = useState(false);
  const [accountantClientCount, setAccountantClientCount] = useState(0);
  const [appointment, setAppointment] = useState<Appointment>(null);
  const [role, setRoleState] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  roleRef.current = role;
  const [roleReady, setRoleReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [preferredCurrency, setPreferredCurrency] = useState("EUR");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const locationRequestId = useRef(0);
  const locationTimeout = useRef<number | null>(null);
  const locationWatchId = useRef<number | null>(null);
  const locationWatchTimeout = useRef<number | null>(null);

  const [practice, setPractice] = useState<PracticeProfile>(DEFAULT_PROFILE);
  const [practiceSaveError, setPracticeSaveError] = useState<string | null>(null);
  const [practiceSetupOpen, setPracticeSetupOpen] = useState(false);
  const [taxpayerSetupOpen, setTaxpayerSetupOpen] = useState(false);
  const [taxpayerProfile, setTaxpayerProfile] = useState<TaxpayerProfile>(EMPTY_TAXPAYER_PROFILE);

  useEffect(() => {
    try {
      const storedRole = window.localStorage.getItem(ROLE_KEY);
      if (storedRole === "taxpayer" || storedRole === "accountant") setRoleState(storedRole);
    } catch {}
  }, []);

  // Restore stored practice profile
  useEffect(() => {
    const restored = readProfile();
    setPractice(restored);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("https://ipwho.is/", { headers: { Accept: "application/json" } })
      .then((response) => response.json())
      .then((result: { success?: unknown; country_code?: unknown }) => {
        if (
          active &&
          result.success !== false &&
          !deviceCountryResolved.current &&
          typeof result.country_code === "string" &&
          result.country_code.length === 2
        ) {
          setCountryState(result.country_code.toUpperCase());
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setRole = useCallback(
    (r: Role | null) => {
      if (user?.id && roleRef.current && r !== roleRef.current) return;
      setDocs([]);
      setDocumentsStatus(user?.id ? "loading" : "ready");
      setRoleState(r);
      try {
        if (r) window.localStorage.setItem(ROLE_KEY, r);
        else window.localStorage.removeItem(ROLE_KEY);
      } catch {}
      if (r && user?.id) {
        void supabase
          .from("user_roles" as never)
          .insert({ user_id: user.id, role: r } as never)
          .then(({ error }) => {
            if (error && (error as { code?: string }).code !== "23505") {
              console.error("Could not persist selected account role.", error.code);
            }
          });
      }
    },
    [user?.id],
  );

  const skipPracticeSetup = useCallback(() => setPracticeSetupOpen(false), []);
  const skipTaxpayerSetup = useCallback(() => setTaxpayerSetupOpen(false), []);
  const openTaxpayerSetup = useCallback(() => setTaxpayerSetupOpen(true), []);
  const saveAvatar = useCallback(
    async (file: File) => {
      if (!user?.id) throw new Error("Sign in before uploading a profile photo.");
      if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
        throw new Error("Choose an image smaller than 5 MB.");
      }
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (error) throw error;
      return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    },
    [user?.id],
  );
  const setUserPhoto = useCallback(
    async (photo: string | null) => {
      if (!user?.id) return false;
      const { error } = await supabase.from("profiles" as never).upsert(
        { id: user.id, display_name: user.name, avatar_url: photo } as never,
        { onConflict: "id" },
      );
      if (error) return false;
      if (role === "accountant") {
        const { error: practiceError } = await supabase
          .from("accountants" as never)
          .update({ avatar_url: photo } as never)
          .eq("id", user.id);
        if (practiceError) return false;
        setPractice((current) => ({ ...current, photo }));
      } else if (role === "taxpayer") {
        const nextProfile = { ...taxpayerProfile, photo, displayName: user.name };
        const { error: taxpayerError } = await supabase
          .from("taxpayer_profiles" as never)
          .upsert(
            {
              id: user.id,
              display_name: nextProfile.displayName,
              avatar_url: photo,
              country_code: nextProfile.countryCode || null,
              business_type: nextProfile.businessType || null,
              tax_residency: nextProfile.taxResidency || null,
              annual_turnover: nextProfile.annualTurnover || null,
              goals: nextProfile.goals,
              document_types: nextProfile.documentTypes,
              notes: nextProfile.notes,
            } as never,
            { onConflict: "id" },
          );
        if (taxpayerError) return false;
        setTaxpayerProfile(nextProfile);
      }
      setUser((current) => (current ? { ...current, photo: photo ?? undefined } : current));
      return true;
    },
    [role, taxpayerProfile, user],
  );

  const refreshDocuments = useCallback(async () => {
    if (!user?.id) {
      setDocs([]);
      setDocumentsStatus("ready");
      return;
    }

    let query = supabase
      .from("documents" as never)
      .select("*")
      .order("created_at", { ascending: false });
    query =
      role === "accountant"
        ? query
            .eq("accountant_id", user.id)
            .eq("owner_role", "taxpayer")
            .in("status", ["sent", "ready", "returned"])
        : query.eq("owner_role", role ?? "taxpayer");
    const { data, error } = await query;
    if (error) {
      setDocumentsStatus("error");
      console.warn("Could not load document analytics from Supabase.", error.code);
      return;
    }
    setDocs(mapDocumentRows((data ?? []) as unknown as DocumentRow[]));
    setDocumentsStatus("ready");
  }, [role, user?.id]);

  const applySessionUser = useCallback(
    async (
      sessionUser: {
        id: string;
        email?: string;
        user_metadata?: Record<string, unknown>;
      } | null,
    ) => {
      if (!sessionUser) {
        setUser(null);
        setDocs([]);
        setDocumentsStatus("ready");
        setRoleReady(true);
        return;
      }

      setRoleReady(false);
      const roleReadinessFallback = window.setTimeout(() => setRoleReady(true), 3500);

      try {
        window.localStorage.setItem("fisco.account.created.v1", "1");
      } catch {}

      setDocs([]);
      setDocumentsStatus("loading");
      const email = sessionUser.email ?? "";
      const metadataName =
        typeof sessionUser.user_metadata?.["full_name"] === "string"
          ? sessionUser.user_metadata["full_name"]
          : typeof sessionUser.user_metadata?.["name"] === "string"
            ? sessionUser.user_metadata["name"]
            : "";
      const label = (metadataName || email.split("@")[0] || "You").replace(/[._-]+/g, " ");
      const initials = label
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .join("");
      const display = label.replace(/\b\w/g, (character) => character.toUpperCase());
      const metadataPhoto =
        sessionUser.user_metadata?.["picture"] ?? sessionUser.user_metadata?.["avatar_url"];
      const fallbackRole = roleRef.current;
      if (fallbackRole) {
        setRoleState(fallbackRole);
        setRoleReady(true);
      }
      setUser({
        id: sessionUser.id,
        name: display,
        email,
        initials,
        ...(typeof metadataPhoto === "string" ? { photo: metadataPhoto } : {}),
      });

      const [identityResult, rolesResult] = await Promise.allSettled([
        supabase
          .from("profiles" as never)
          .select("display_name, avatar_url, country_code, currency_code")
          .eq("id", sessionUser.id)
          .maybeSingle(),
        supabase
          .from("user_roles" as never)
          .select("role")
          .eq("user_id", sessionUser.id),
      ]);
      const savedIdentity =
        identityResult.status === "fulfilled" ? identityResult.value.data : null;
      const roleData = rolesResult.status === "fulfilled" ? rolesResult.value.data : null;
      const savedRoles = ((roleData ?? []) as { role?: Role }[])
        .map((row) => row.role)
        .filter(
          (savedRole): savedRole is Role =>
            savedRole === "taxpayer" || savedRole === "accountant",
        );
      const identity = savedIdentity as
        | {
            display_name?: string | null;
            avatar_url?: string | null;
            country_code?: string | null;
            currency_code?: string | null;
          }
        | null;
      const identityCurrency =
        identity?.currency_code && /^[A-Z]{3}$/.test(identity.currency_code)
          ? identity.currency_code
          : currencyForCountry(identity?.country_code);
      setPreferredCurrency(identityCurrency);
      const photo =
        identity?.avatar_url ?? (typeof metadataPhoto === "string" ? metadataPhoto : undefined);
      const savedName = identity?.display_name?.trim() || display;
      if (identity?.country_code && !deviceCountryResolved.current) {
        setCountryState(identity.country_code.toUpperCase());
      }
      setUser({ id: sessionUser.id, name: savedName, email, initials, ...(photo ? { photo } : {}) });
      void supabase
        .from("profiles" as never)
        .upsert(
          {
            id: sessionUser.id,
            display_name: savedName,
            avatar_url:
              identity?.avatar_url ?? (typeof metadataPhoto === "string" ? metadataPhoto : null),
            country_code: identity?.country_code ?? null,
            currency_code: identity?.currency_code ?? null,
          } as never,
          { onConflict: "id" },
        )
        .then(({ error }) => {
          if (error) console.warn("Could not sync the user profile.", error.code);
        })
        .catch((error: unknown) => console.warn("Could not sync the user profile.", error));

      let restoredRole: Role | null = roleRef.current;
      try {
        const storedRole = window.localStorage.getItem(ROLE_KEY) as Role | null;
        const currentRole = roleRef.current ?? storedRole;
        const savedRole =
          savedRoles.length > 0
            ? currentRole && savedRoles.includes(currentRole)
              ? currentRole
              : savedRoles[0]
            : currentRole;
        if (savedRole) {
          restoredRole = savedRole;
          setRoleState(savedRole);
          window.localStorage.setItem(ROLE_KEY, savedRole);
          if (!savedRoles.includes(savedRole)) {
            const { error } = await supabase
              .from("user_roles" as never)
              .insert({ user_id: sessionUser.id, role: savedRole } as never);
            if (error && (error as { code?: string }).code !== "23505") {
              console.error("Could not sync selected account role.", error.code);
            }
          }
        }
      } catch {}

      if (restoredRole === "accountant") {
        try {
          const { data: savedPractice } = await supabase
            .from("accountants" as never)
            .select("*")
            .eq("id", sessionUser.id)
            .maybeSingle();
          if (savedPractice) {
            const row = savedPractice as Record<string, unknown>;
            const storedPhone =
              typeof row["phone_number"] === "string"
                ? parsePhoneNumberFromString(row["phone_number"])
                : undefined;
            const restored: PracticeProfile = {
              ...DEFAULT_PROFILE,
              name: String(row["name"] ?? ""),
              firm: String(row["firm"] ?? row["name"] ?? ""),
              photo: typeof row["avatar_url"] === "string" ? row["avatar_url"] : null,
              bio: typeof row["bio"] === "string" ? row["bio"] : "",
              specialties: Array.isArray(row["specialties"]) ? (row["specialties"] as string[]) : [],
              languages: Array.isArray(row["languages"]) ? (row["languages"] as string[]) : [],
              phoneNumber: storedPhone?.formatNational() ?? "",
              phoneCountryCode:
                typeof row["phone_country_code"] === "string"
                  ? row["phone_country_code"]
                  : storedPhone?.country ?? "",
              timeZone: String(row["time_zone"] ?? "UTC"),
              address: String(row["address"] ?? [row["city"], row["country_code"]].filter(Boolean).join(", ")),
              city: String(row["city"] ?? ""),
              countryCode: String(row["country_code"] ?? "").toUpperCase(),
              currencyCode: String(row["currency_code"] ?? currencyForCountry(String(row["country_code"] ?? ""))),
              price: Number(row["price"] ?? 0),
              pricing: (row["pricing"] as PracticeProfile["pricing"]) ?? "Per filing",
              freeIntro: Boolean(row["free_intro"]),
              days: Array.isArray(row["days"]) ? (row["days"] as string[]) : [],
              slots: Array.isArray(row["slots"]) ? (row["slots"] as string[]) : [],
              slotMinutes: Number(row["slot_minutes"] ?? 45),
              holiday: Boolean(row["holiday"]),
              holidayUntil: String(row["holiday_until"] ?? ""),
              autoAccept: Boolean(row["auto_accept"]),
              remote: row["remote"] !== false,
              homeVisits: Boolean(row["home_visits"]),
              maxClients: Number(row["max_clients"] ?? 25),
              responseHours: Number(row["response_hours"] ?? 24),
              websiteUrl: String(row["website_url"] ?? ""),
              bookingUrl: String(row["booking_url"] ?? ""),
              lng: Number(row["longitude"] ?? 0),
              lat: Number(row["latitude"] ?? 0),
              locationSelected:
                Number.isFinite(Number(row["latitude"])) &&
                Number.isFinite(Number(row["longitude"])) &&
                Boolean(row["city"] || row["address"]),
              onboarded: Boolean(row["is_listed"]),
            };
            setPractice(restored);
            writeProfile(restored);
            setUser((previous) => previous ? { ...previous, photo: restored.photo ?? undefined } : previous);
            setPracticeSetupOpen(!restored.onboarded);
          } else {
            setPractice({
              ...DEFAULT_PROFILE,
              name: savedName,
              photo: null,
              currencyCode: identityCurrency,
            });
            setPracticeSetupOpen(true);
          }
        } catch {
          setPracticeSetupOpen(true);
        }
      } else if (restoredRole === "taxpayer") {
        try {
          const { data: savedTaxpayer, error: taxpayerProfileError } = await supabase
            .from("taxpayer_profiles" as never)
            .select("*")
            .eq("id", sessionUser.id)
            .maybeSingle();
          if (taxpayerProfileError) {
            console.error("Could not restore taxpayer profile.", taxpayerProfileError.code);
            setTaxpayerSetupOpen(false);
          } else if (savedTaxpayer) {
            const row = savedTaxpayer as Record<string, unknown>;
            const restored: TaxpayerProfile = {
              displayName: String(row["display_name"] ?? savedName),
              photo: typeof row["avatar_url"] === "string" ? row["avatar_url"] : null,
              countryCode: String(row["country_code"] ?? ""),
              businessType: String(row["business_type"] ?? ""),
              taxResidency: String(row["tax_residency"] ?? ""),
              spokenLanguage: String(row["spoken_language"] ?? ""),
              annualTurnover: String(row["annual_turnover"] ?? ""),
              goals: Array.isArray(row["goals"]) ? (row["goals"] as string[]) : [],
              documentTypes: Array.isArray(row["document_types"]) ? (row["document_types"] as string[]) : [],
              notes: String(row["notes"] ?? ""),
            };
            setTaxpayerProfile(restored);
            setUser((previous) => previous ? { ...previous, photo: restored.photo ?? undefined } : previous);
            setTaxpayerSetupOpen(
              !restored.photo ||
                !restored.businessType.trim() ||
                !restored.taxResidency.trim() ||
                !restored.spokenLanguage.trim(),
            );
          } else {
            setTaxpayerProfile({ ...EMPTY_TAXPAYER_PROFILE, displayName: savedName });
            setTaxpayerSetupOpen(true);
          }
        } catch (error) {
          console.error("Could not restore taxpayer profile.", error);
          setTaxpayerSetupOpen(false);
        }
      }

      window.clearTimeout(roleReadinessFallback);
      setRoleReady(true);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    const readinessFallback = window.setTimeout(() => {
      if (!alive) return;
      setDocumentsStatus("error");
      setRoleReady(true);
    }, 4000);
    const resetDeletedAccount = async () => {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      try {
        window.localStorage.removeItem("fisco.account.created.v1");
        window.localStorage.removeItem(ROLE_KEY);
      } catch {}
      setRoleState(null);
      setPractice(DEFAULT_PROFILE);
      setTaxpayerProfile(EMPTY_TAXPAYER_PROFILE);
      setPracticeSetupOpen(false);
      setTaxpayerSetupOpen(false);
      setChosenId(null);
      setAppointment(null);
      await applySessionUser(null);
      window.dispatchEvent(new Event("fisco:reset-role-selection"));
    };
    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!alive) return;
        try {
          const session = data.session;
          if (!session) {
            await applySessionUser(null);
            return;
          }
          const { data: verified, error } = await supabase.auth.getUser(session.access_token);
          if (!alive) return;
          if (error) {
            const errorCode = error.code?.toLowerCase() ?? "";
            const invalidSession =
              error.status === 401 ||
              error.status === 403 ||
              error.status === 404 ||
              ["user_not_found", "session_not_found", "bad_jwt", "invalid_jwt"].includes(
                errorCode,
              ) ||
              /user\b.*\b(?:not found|does not exist|deleted)\b|(?:invalid|malformed|expired).*(?:jwt|token)|(?:jwt|token).*(?:invalid|malformed|expired)/i.test(
                error.message,
              );
            if (invalidSession) {
              await resetDeletedAccount();
              return;
            }
            await applySessionUser(session.user);
            return;
          }
          await applySessionUser(verified.user);
        } catch {
          if (alive) {
            setUser(null);
            setDocumentsStatus("error");
            setRoleReady(true);
          }
        } finally {
          window.clearTimeout(readinessFallback);
        }
      })
      .catch(() => {
        if (!alive) return;
        window.clearTimeout(readinessFallback);
        setUser(null);
        setDocumentsStatus("error");
        setRoleReady(true);
      });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void applySessionUser(session?.user ?? null);
      }
    });
    return () => {
      alive = false;
      window.clearTimeout(readinessFallback);
      listener.subscription.unsubscribe();
    };
  }, [applySessionUser]);

  useEffect(() => {
    if (!user?.id) return;

    const refresh = () => void refreshDocuments();
    const channel = supabase
      .channel(`documents:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, refresh)
      .subscribe();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, refreshDocuments]);

  useEffect(() => {
    if (!user?.id) return;
    setDocs([]);
    setDocumentsStatus("loading");
    void refreshDocuments();
  }, [role, user?.id, refreshDocuments]);

  const signIn = useCallback(
    async (email: string, password: string, name?: string, currencyCode?: string) => {
      const trimmedName = name?.trim();
      const selectedRole =
        role ??
        (typeof window !== "undefined"
          ? (window.localStorage.getItem(ROLE_KEY) as Role | null)
          : null);

      if (trimmedName) {
        if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
          throw new Error("Choose a valid currency before creating your account.");
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: trimmedName, currency_code: currencyCode },
          },
        });
        if (error) throw error;
        if (data.user) {
          try {
            window.localStorage.setItem("fisco.account.created.v1", "1");
          } catch {}
        }
        if (!data.session) return "confirmation-required";

        if (data.user && selectedRole) {
          setRoleState(selectedRole);
          try {
            window.localStorage.setItem(ROLE_KEY, selectedRole);
          } catch (error) {
            console.warn("Could not cache the selected account role.", error);
          }
          void supabase
            .from("user_roles" as never)
            .insert({ user_id: data.user.id, role: selectedRole } as never)
            .then(({ error: roleError }) => {
              if (roleError && (roleError as { code?: string }).code !== "23505") {
                console.warn("Could not persist the selected account role.", roleError.code);
              }
            })
            .catch((error: unknown) => {
              console.warn("Could not persist the selected account role.", error);
            });
        }
        setPreferredCurrency(currencyCode);
        void supabase
          .from("profiles" as never)
          .upsert(
            {
              id: data.user?.id,
              display_name: trimmedName,
              currency_code: currencyCode,
            } as never,
            { onConflict: "id" },
          )
          .then(({ error: profileError }) => {
            if (profileError) {
              console.warn("Could not save the new user profile.", profileError.code);
            }
          })
          .catch((error: unknown) => console.warn("Could not save the new user profile.", error));
        void applySessionUser(data.user);
        return "authenticated";
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      void applySessionUser(data.user);
      return "authenticated";
    },
    [applySessionUser, role],
  );

  const signInWithOAuth = useCallback(async (provider: "google" | "apple") => {
    try {
      window.localStorage.setItem("fisco.auth.loading.pending.v1", String(Date.now()));
    } catch (storageError) {
      console.warn("Could not store pending OAuth loader state.", storageError);
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      try {
        window.localStorage.removeItem("fisco.auth.loading.pending.v1");
      } catch (storageError) {
        console.warn("Could not clear pending OAuth loader state.", storageError);
      }
      throw error;
    }
  }, []);

  const signInWithGoogleIdToken = useCallback(
    async (idToken: string) => {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: idToken,
      });
      if (error) throw error;
      if (data.user) void applySessionUser(data.user);
    },
    [applySessionUser],
  );

  const signOut = useCallback(async () => {
    setDocs([]);
    setDocumentsStatus("ready");
    try {
      const rawPushRegistration = window.localStorage.getItem("fisco.native-push-token.v1");
      const pushRegistration = rawPushRegistration
        ? (JSON.parse(rawPushRegistration) as { token?: unknown })
        : null;
      if (user?.id && typeof pushRegistration?.token === "string") {
        await supabase
          .from("push_tokens" as never)
          .delete()
          .eq("user_id", user.id)
          .eq("token", pushRegistration.token);
      }
    } catch (error) {
      console.warn("Could not remove native push token before sign-out.", error);
    }
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn("Could not sign out of Supabase.", error);
    }
    setUser(null);
  }, [user?.id]);

  const deleteAccount = useCallback(async () => {
    if (!user?.id) throw new Error("Sign in before deleting your account.");

    const avatarPaths: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage
        .from("avatars")
        .list(user.id, { limit: 100, offset });
      if (error) throw error;
      avatarPaths.push(...data.map((file) => `${user.id}/${file.name}`));
      if (data.length < 100) break;
    }

    if (avatarPaths.length > 0) {
      const { error } = await supabase.storage.from("avatars").remove(avatarPaths);
      if (error) throw error;
    }

    const { error } = await supabase.rpc("delete_my_account" as never);
    if (error) throw error;
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);

    setDocs([]);
    setDocumentsStatus("ready");
    setChosenId(null);
    setAppointment(null);
    setUser(null);
    setRoleState(null);
    setPractice(DEFAULT_PROFILE);
    setTaxpayerProfile(EMPTY_TAXPAYER_PROFILE);
    setPracticeSetupOpen(false);
    setTaxpayerSetupOpen(false);
    try {
      window.localStorage.removeItem(ROLE_KEY);
      window.localStorage.removeItem("fisco.account.created.v1");
      window.localStorage.removeItem(`fisco.threads.v1.${user.id}`);
      writeProfile(DEFAULT_PROFILE);
    } catch {}
    window.dispatchEvent(new Event("fisco:restart-intro"));
  }, [user?.id]);

  const detectCountry = useCallback(async (lat: number, lng: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&lat=${lat}&lon=${lng}`,
      );
      const result = await response.json();
      const countryCode = result?.address?.country_code?.toUpperCase();
      if (countryCode) {
        deviceCountryResolved.current = true;
        setCountryState(countryCode);
      }
    } catch {}
  }, []);

  const requestLocation = useCallback(() => {
    const requestId = ++locationRequestId.current;
    if (locationTimeout.current !== null) window.clearTimeout(locationTimeout.current);
    if (locationWatchTimeout.current !== null) window.clearTimeout(locationWatchTimeout.current);
    if (
      locationWatchId.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(locationWatchId.current);
      locationWatchId.current = null;
    }

    setLocationError(null);
    setLocating(true);
    let deviceFixReceived = false;
    let networkFallbackStarted = false;
    let bestDeviceAccuracy = Number.POSITIVE_INFINITY;
    let networkController: AbortController | null = null;

    const isCurrentRequest = () => locationRequestId.current === requestId;

    const clearLocationTimeout = () => {
      if (locationTimeout.current !== null) {
        window.clearTimeout(locationTimeout.current);
        locationTimeout.current = null;
      }
    };

    const findNetworkLocation = async () => {
      if (!isCurrentRequest() || deviceFixReceived || networkFallbackStarted) return;
      networkFallbackStarted = true;
      clearLocationTimeout();
      setLocationError(null);

      networkController = new AbortController();
      const timeout = window.setTimeout(() => networkController?.abort(), 4500);
      try {
        const response = await fetch("https://ipwho.is/", {
          headers: { Accept: "application/json" },
          signal: networkController.signal,
        });
        if (!response.ok) throw new Error("Network location lookup failed");
        const result = (await response.json()) as {
          success?: unknown;
          country_code?: unknown;
          latitude?: unknown;
          longitude?: unknown;
        };
        if (result.success === false) throw new Error("Network location lookup failed");

        if (!isCurrentRequest() || deviceFixReceived) return;
        if (typeof result.country_code === "string" && result.country_code.length === 2) {
          setCountryState(result.country_code.toUpperCase());
        }
        if (!located) {
          const lat = Number(result.latitude);
          const lng = Number(result.longitude);
          if (
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lng) <= 180
          ) {
            setPosition({ lat, lng });
            setLocationAccuracy(50_000);
            setLocationSource("network");
            setLocated(true);
            setLocationError(
              "Showing an approximate location from your internet connection. Allow device location for a more precise position.",
            );
          } else {
            setLocationError(
              "An approximate location could not be determined. Allow device location, then tap to try again.",
            );
          }
        }
        setLocating(false);
      } catch {
        if (!isCurrentRequest()) return;
        setLocating(false);
        if (!located) {
          setLocationError(
            "Device location was unavailable and an approximate network location could not be found. Check your connection and try again.",
          );
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const acceptPosition = (positionResult: GeolocationPosition) => {
      if (!isCurrentRequest()) return;
      const accuracy = positionResult.coords.accuracy;
      if (!deviceFixReceived) {
        deviceFixReceived = true;
        clearLocationTimeout();
        networkController?.abort();
        setLocating(false);
        setLocationError(null);
      }
      if (accuracy >= bestDeviceAccuracy) return;
      bestDeviceAccuracy = accuracy;
      const next = {
        lng: positionResult.coords.longitude,
        lat: positionResult.coords.latitude,
      };
      setPosition(next);
      setLocationAccuracy(accuracy);
      setLocationSource("device");
      setLocated(true);
      if (accuracy <= PRECISE_LOCATION_ACCURACY_METERS) {
        if (locationWatchTimeout.current !== null) {
          window.clearTimeout(locationWatchTimeout.current);
          locationWatchTimeout.current = null;
        }
        if (locationWatchId.current !== null) {
          navigator.geolocation.clearWatch(locationWatchId.current);
          locationWatchId.current = null;
        }
        void detectCountry(next.lat, next.lng);
      }
    };
    const reportFailure = (error: GeolocationPositionError) => {
      if (!isCurrentRequest() || deviceFixReceived) return;
      if (error.code === error.PERMISSION_DENIED) {
        locationRequestId.current += 1;
        clearLocationTimeout();
        if (locationWatchTimeout.current !== null) {
          window.clearTimeout(locationWatchTimeout.current);
          locationWatchTimeout.current = null;
        }
        if (locationWatchId.current !== null) {
          navigator.geolocation.clearWatch(locationWatchId.current);
          locationWatchId.current = null;
        }
        setLocating(false);
        void findNetworkLocation();
      } else {
        void findNetworkLocation();
      }
    };

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      void findNetworkLocation();
      return;
    }

    navigator.geolocation.getCurrentPosition(acceptPosition, reportFailure, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60000,
    });
    locationWatchId.current = navigator.geolocation.watchPosition(acceptPosition, reportFailure, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
    locationWatchTimeout.current = window.setTimeout(() => {
      if (locationWatchId.current !== null) {
        navigator.geolocation.clearWatch(locationWatchId.current);
        locationWatchId.current = null;
      }
      locationWatchTimeout.current = null;
    }, 45000);

    locationTimeout.current = window.setTimeout(() => {
      void findNetworkLocation();
    }, 9000);
  }, [detectCountry, located]);

  useEffect(
    () => () => {
      locationRequestId.current += 1;
      if (locationTimeout.current !== null) window.clearTimeout(locationTimeout.current);
      if (locationWatchTimeout.current !== null) window.clearTimeout(locationWatchTimeout.current);
      if (
        locationWatchId.current !== null &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(locationWatchId.current);
        locationWatchId.current = null;
      }
    },
    [],
  );

  // Save practice profile locally & to Supabase accountants table
  const savePractice = useCallback(
    async (p: PracticeProfile): Promise<boolean> => {
      if (
        !user?.id ||
        !p.onboarded ||
        !p.name.trim() ||
        !p.firm.trim() ||
        !isValidPhoneNumber(p.phoneNumber, p.phoneCountryCode || p.countryCode || "US") ||
        !p.photo ||
        !p.bio.trim() ||
        p.specialties.length === 0 ||
        p.languages.length === 0 ||
        p.days.length === 0 ||
        p.slots.length === 0 ||
        p.price <= 0 ||
        !p.address.trim() ||
        !p.locationSelected ||
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lng) ||
        !(p.countryCode || country)
      ) {
        setPracticeSaveError(
          "Add a photo, bio, specialties, location, rate, and availability before publishing.",
        );
        return false;
      }

      setPracticeSaveError(null);
      const wasAlreadyPublished = practice.onboarded;

      const practiceCountryCode = (p.countryCode || country)!.toUpperCase();
      const currencyCode = p.currencyCode || currencyForCountry(practiceCountryCode);
      const pendingPractice = {
        ...p,
        countryCode: practiceCountryCode,
        onboarded: wasAlreadyPublished,
      };
      setPractice(pendingPractice);
      writeProfile(pendingPractice);

      const { error: roleError } = await supabase
        .from("user_roles" as never)
        .insert({ user_id: user.id, role: "accountant" } as never);
      if (roleError && (roleError as { code?: string }).code !== "23505") {
        console.error(
          "Could not enable the accountant role.",
          (roleError as { code?: string }).code,
        );
        setPracticeSaveError(
          "Your accountant role could not be saved. Apply the latest Supabase role migration, then try again.",
        );
        return false;
      }

      const { data, error } = await supabase
        .from("accountants" as never)
        .upsert(
          {
            id: user.id,
            name: p.name.trim(),
            firm: p.firm.trim(),
            avatar_url: p.photo,
            country_code: practiceCountryCode,
            city: p.city?.trim() || null,
            address: p.address.trim(),
            latitude: p.lat,
            longitude: p.lng,
            specialties: p.specialties,
            languages: p.languages,
            phone_number: parsePhoneNumberFromString(
              p.phoneNumber,
              p.phoneCountryCode || practiceCountryCode,
            )?.number,
            phone_country_code: p.phoneCountryCode || practiceCountryCode,
            time_zone: tzLookup(p.lat, p.lng),
            bio: p.bio || null,
            is_listed: true,
            currency_code: currencyCode,
            price: p.price,
            pricing: p.pricing,
            free_intro: p.freeIntro,
            days: p.days,
            slots: p.slots,
            slot_minutes: p.slotMinutes,
            holiday: p.holiday,
            holiday_until: p.holidayUntil || null,
            auto_accept: p.autoAccept,
            remote: p.remote,
            home_visits: p.homeVisits,
            max_clients: p.maxClients,
            response_hours: p.responseHours,
            website_url: p.websiteUrl || null,
            booking_url: p.bookingUrl || null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "id" },
        )
        .select("*")
        .single();

      if (error || !data) {
        console.error("Could not publish accountant profile to Supabase.", error?.code);
        setPracticeSaveError(
          "Your practice could not be saved to the database. Check your connection and try again.",
        );
        return false;
      }
      await supabase.from("profiles" as never).upsert(
        {
          id: user.id,
          display_name: p.name.trim(),
          avatar_url: p.photo,
          country_code: practiceCountryCode,
          currency_code: currencyCode,
        } as never,
        { onConflict: "id" },
      );

      const listing = mapAccountant(data);
      setAccountants((previous) => [
        listing,
        ...previous.filter((accountant) => accountant.id !== listing.id),
      ]);
      const publishedPractice = { ...pendingPractice, onboarded: true };
      publishedPractice.currencyCode = currencyCode;
      setPractice(publishedPractice);
      writeProfile(publishedPractice);
      setPracticeSetupOpen(false);
      setCountryState(practiceCountryCode);
      setPracticeSaveError(null);
      return true;
    },
    [user, country, practice.onboarded],
  );

  const saveTaxpayerProfile = useCallback(
    async (profile: TaxpayerProfile): Promise<boolean> => {
      if (
        !user?.id ||
        !profile.photo ||
        !profile.businessType.trim() ||
        !profile.taxResidency.trim() ||
        !profile.spokenLanguage.trim()
      ) {
        return false;
      }
      const countryCode = (profile.countryCode || country || "").toUpperCase();
      const nextProfile = {
        ...profile,
        displayName: profile.displayName.trim() || user.name,
        countryCode,
      };
      const { error } = await supabase.from("taxpayer_profiles" as never).upsert(
        {
          id: user.id,
          display_name: nextProfile.displayName,
          avatar_url: nextProfile.photo,
          country_code: countryCode || null,
          spoken_language: nextProfile.spokenLanguage,
          business_type: nextProfile.businessType.trim(),
          tax_residency: nextProfile.taxResidency.trim(),
          annual_turnover: nextProfile.annualTurnover || null,
          goals: nextProfile.goals,
          document_types: nextProfile.documentTypes,
          notes: nextProfile.notes,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "id" },
      );
      if (error) return false;
      const { error: identityError } = await supabase.from("profiles" as never).upsert(
        {
          id: user.id,
          display_name: nextProfile.displayName,
          avatar_url: nextProfile.photo,
          country_code: countryCode || null,
        } as never,
        { onConflict: "id" },
      );
      if (identityError) return false;
      setTaxpayerProfile(nextProfile);
      setUser((current) => current ? { ...current, photo: nextProfile.photo ?? undefined } : current);
      setTaxpayerSetupOpen(false);
      return true;
    },
    [user, country],
  );

  const addDoc = useCallback(
    async (d: Doc, mimeType = "application/octet-stream") => {
      if (!user?.id || !role) return false;

      const createdAt = d.createdAt ?? new Date().toISOString();
      let row: DocumentRow;
      try {
        const { data, error } = await supabase
          .from("documents" as never)
          .insert({
            owner_id: user.id,
            owner_role: role,
            name: d.merchant,
            mime_type: mimeType,
            drive_file_id: d.driveFileId || null,
            preview_url: d.previewUrl || d.driveUrl || null,
            embed_url: d.embedUrl || null,
            status: "ready",
            extracted_data: {
              merchant: d.merchant,
              amount: d.amount,
              currency: d.currency ?? null,
              category: d.category,
              date: d.date,
              createdAt,
              pages: d.pages,
              ...(d.aiDetails
                ? {
                    taxId: d.aiDetails.taxId,
                    vat: d.aiDetails.vat,
                    invoiceNumber: d.aiDetails.invoiceNumber,
                    lineItems: d.aiDetails.lineItems,
                    summary: d.aiDetails.summary,
                    confidence: d.aiDetails.confidence,
                    raw: d.aiDetails.raw,
                  }
                : {}),
            },
          } as never)
          .select("*")
          .single();

        if (error || !data) {
          console.warn("Could not persist scanned document metadata.", error?.code);
          return false;
        }
        row = data as unknown as DocumentRow;
      } catch (error) {
        console.warn(
          "Could not persist scanned document metadata.",
          error instanceof Error ? error.message : "unknown error",
        );
        return false;
      }

      const [savedDoc] = mapDocumentRows([row]);
      if (!savedDoc) return false;
      setDocs((previous) => [
        savedDoc,
        ...previous.filter((document) => document.id !== savedDoc.id),
      ]);
      return true;
    },
    [user, role],
  );

  const removeDoc = useCallback((id: string) => {
    setDocs((previous) => previous.filter((document) => document.id !== id));
  }, []);

  useEffect(() => {
    if (!user?.id || role !== "accountant") {
      setAccountantClientCount(0);
      return;
    }

    let alive = true;
    const refresh = async () => {
      const { count, error } = await supabase
        .from("accountant_clients" as never)
        .select("id", { count: "exact", head: true })
        .eq("accountant_id", user.id)
        .eq("status", "active");
      if (alive && !error) setAccountantClientCount(count ?? 0);
    };
    const channel = supabase
      .channel(`accountant-clients:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accountant_clients",
          filter: `accountant_id=eq.${user.id}`,
        },
        () => void refresh(),
      )
      .subscribe();
    void refresh();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id, role]);

  const markSent = useCallback(
    async (ids: string[], accountantId?: string) => {
      const uniqueIds = [...new Set(ids)];
      if (!user?.id || uniqueIds.length === 0) return false;

      const update = {
        status: "sent",
        ...(accountantId ? { accountant_id: accountantId } : {}),
      };
      const { error } = await supabase
        .from("documents" as never)
        .update(update as never)
        .in("id", uniqueIds)
        .eq("owner_id", user.id)
        .eq("owner_role", role ?? "taxpayer");
      if (error) {
        console.warn("Could not persist document handoff.", error.code);
        await refreshDocuments();
        return false;
      }
      setDocs((previous) =>
        previous.map((document) =>
          uniqueIds.includes(document.id) ? { ...document, status: "sent" } : document,
        ),
      );
      return true;
    },
    [refreshDocuments, user?.id, role],
  );

  const mergeAccountantDirectory = useCallback((remoteList: Accountant[]) => {
    setAccountants((previous) => {
      const remoteIds = new Set(remoteList.map((accountant) => accountant.id));
      const locals = previous.filter((accountant) => !remoteIds.has(accountant.id));
      const merged = [...remoteList, ...locals];
      try {
        window.localStorage.setItem(ACCOUNTANT_DIRECTORY_KEY, JSON.stringify(merged));
      } catch {
        return merged;
      }
      return merged;
    });
  }, []);

  useEffect(() => {
    const cached = readAccountantDirectoryCache();
    if (cached.length) {
      setAccountants((previous) => (previous.length ? previous : cached));
    }
  }, []);

  const refreshAccountants = useCallback(async () => {
    if (!country) return;
    const { data, error } = await fetchAccountantDirectory(country, user?.id);
    if (error) {
      setAccountantsLoadError(true);
      return;
    }
    setAccountantsLoadError(false);
    if (data) mergeAccountantDirectory(data);
  }, [country, user?.id, mergeAccountantDirectory]);

  useEffect(() => {
    if (!user?.id || role !== "taxpayer") {
      setChosenId(null);
      setChosenRelationshipStatus(null);
      return;
    }

    let alive = true;
    const refreshRelationship = async () => {
      const { data, error } = await supabase
        .from("accountant_clients" as never)
        .select("accountant_id, status")
        .eq("taxpayer_id", user.id)
        .in("status", ["pending", "active", "rejected"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (!alive || error) return;
      const relationship = (data ?? [])[0] as SelectedRelationshipRow | undefined;
      setChosenId(relationship?.accountant_id ?? null);
      setChosenRelationshipStatus(relationship?.status ?? null);
    };
    void refreshRelationship();
    const channel = supabase
      .channel(`taxpayer-accountant-status:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accountant_clients",
          filter: `taxpayer_id=eq.${user.id}`,
        },
        () => void refreshRelationship(),
      )
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [role, user?.id]);

  const choose = useCallback(
    async (id: string | null) => {
      if (!id) {
        setChosenId(null);
        setChosenRelationshipStatus(null);
        return true;
      }
      if (role !== "taxpayer" || !user?.id) return false;

      const { data: existing, error: lookupError } = await supabase
        .from("accountant_clients" as never)
        .select("status")
        .eq("accountant_id", id)
        .eq("taxpayer_id", user.id)
        .maybeSingle();
      if (lookupError) {
        console.warn("Could not check accountant relationship.", lookupError.code);
        return false;
      }
      if (existing) {
        const status = (existing as { status?: string }).status;
        if (status === "ended" || status === "rejected") {
          const { error } = await supabase
            .from("accountant_clients" as never)
            .update({ status: "pending" } as never)
            .eq("accountant_id", id)
            .eq("taxpayer_id", user.id);
          if (error) {
            console.warn("Could not renew accountant request.", error.code);
            return false;
          }
          setChosenId(id);
          setChosenRelationshipStatus("pending");
          return true;
        }
        setChosenId(id);
        setChosenRelationshipStatus(status === "active" ? "active" : "pending");
        return true;
      }

      const { error } = await supabase.from("accountant_clients" as never).insert({
        accountant_id: id,
        taxpayer_id: user.id,
        status: "pending",
      } as never);
      if (error && (error as { code?: string }).code !== "23505") {
        console.warn("Could not request accountant relationship.", error.code);
        return false;
      }
      setChosenId(id);
      setChosenRelationshipStatus("pending");
      return true;
    },
    [role, user?.id],
  );

  // Refresh the public directory when the detected country or signed-in user changes.
  useEffect(() => {
    if (!country) return;
    let alive = true;
    let timer: number | undefined;

    const load = async (attempt = 0) => {
      try {
        const { data: remoteList, error } = await fetchAccountantDirectory(country, user?.id);

        if (!alive) return;
        if (error) {
          const errorCode = (error as { code?: string }).code;
          if (errorCode === "PGRST205" || errorCode === "42P01") {
            setAccountantsLoadError(true);
            console.error(
              "Supabase accountants table is missing. Apply the latest Supabase migration and reload the schema cache.",
            );
            return;
          }
          timer = window.setTimeout(() => load(attempt + 1), Math.min(30000, 2000 * 2 ** attempt));
          return;
        }

        setAccountantsLoadError(false);
        if (remoteList) mergeAccountantDirectory(remoteList);
      } catch {
        if (!alive) return;
      }
    };

    void load();
    const refreshInterval = window.setInterval(() => void load(), 60_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      alive = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (timer) window.clearTimeout(timer);
    };
  }, [country, user?.id, mergeAccountantDirectory]);

  const pushMsg = useCallback((m: ChatMsg) => setMsgs((prev) => [...prev, m]), []);

  const sendMessage = useCallback(
    (threadId: string, text: string, quick?: boolean) => {
      const id = `${threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      pushMsg({
        id,
        threadId,
        from: "me",
        text,
        at: Date.now(),
        status: "sent",
        ...(quick ? { quick: true } : {}),
      });
      window.setTimeout(() => {
        setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, status: "read" } : m)));
      }, 1000);
    },
    [pushMsg],
  );

  const broadcast = useCallback(
    (text: string) => {
      if (!role) return;
      THREADS[role].forEach((t, i) => {
        window.setTimeout(() => sendMessage(t.id, text, true), i * 140);
      });
    },
    [role, sendMessage],
  );

  const value = useMemo<Store>(() => {
    const all = [...accountants];

    const hasLocation =
      located && Number.isFinite(position.lat) && Number.isFinite(position.lng);
    const ranked = all
      .filter(
        (accountant) =>
          accountant.countryCode?.toUpperCase() === country?.toUpperCase() &&
          accountant.id !== user?.id,
      )
      .map((accountant) => ({
        ...accountant,
        km: hasLocation
          ? distanceKm(position, { lng: accountant.lng, lat: accountant.lat })
          : 0,
      }))
      .sort((first, second) =>
        hasLocation ? first.km - second.km : second.rating - first.rating,
      );

    return {
      position,
      located,
      locating,
      locationAccuracy,
      locationSource,
      locationError,
      country,
      setCountry: setCountryState,
      requestLocation,
      chosenId,
      chosenRelationshipStatus,
      choose,
      docs,
      documentsStatus,
      addDoc,
      removeDoc,
      markSent,
      appointment,
      setAppointment,
      role,
      roleReady,
      setRole,
      user,
      setUserPhoto,
      saveAvatar,
      signIn,
      signInWithOAuth,
      signInWithGoogleIdToken,
      signOut,
      deleteAccount,
      practice,
      savePractice,
      practiceSaveError,
      practiceSetupOpen,
      skipPracticeSetup,
      taxpayerSetupOpen,
      skipTaxpayerSetup,
      openTaxpayerSetup,
      taxpayerProfile,
      saveTaxpayerProfile,
      threads: role ? THREADS[role] : [],
      messages: msgs,
      sendMessage,
      broadcast,
      ranked,
      accountants: all,
      accountantsLoadError,
      refreshAccountants,
      accountantClientCount,
    } as Store;
  }, [
    position,
    located,
    locating,
    locationAccuracy,
    locationSource,
    locationError,
    country,
    requestLocation,
    chosenId,
    chosenRelationshipStatus,
    choose,
    docs,
    documentsStatus,
    addDoc,
    removeDoc,
    markSent,
    appointment,
    role,
    roleReady,
    setRole,
    user,
    setUserPhoto,
    saveAvatar,
    signIn,
    signInWithOAuth,
    signInWithGoogleIdToken,
    signOut,
    deleteAccount,
    practice,
    savePractice,
    practiceSaveError,
    practiceSetupOpen,
    skipPracticeSetup,
    taxpayerSetupOpen,
    skipTaxpayerSetup,
    openTaxpayerSetup,
    taxpayerProfile,
    saveTaxpayerProfile,
    msgs,
    accountants,
    accountantsLoadError,
    refreshAccountants,
    accountantClientCount,
    sendMessage,
    broadcast,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used inside AppStoreProvider");
  return ctx;
}
