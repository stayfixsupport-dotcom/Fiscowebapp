import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { lockScroll } from "@/lib/scroll-lock";
import { useStore } from "@/lib/app-store";
import { sfx } from "@/lib/sfx";
import { AVATAR_OPTIONS } from "@/lib/illustrations";
import type { TaxpayerProfile } from "@/lib/taxpayer-profile";
import { LanguagePicker } from "@/components/LanguagePicker";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode } from "@/lib/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const EASE = [0.16, 1, 0.3, 1] as const;
const STEP_COUNT = 3;
const STEP_COPY = [
  {
    title: "Choose your picture",
    description: "Pick an avatar or upload a photo that accountants will recognize.",
  },
  {
    title: "Set up your taxpayer profile",
    description: "Choose your business type, tax residence, and turnover range.",
  },
  {
    title: "Choose what matters to you",
    description: "Select the topics and documents you want Fisco to focus on.",
  },
] as const;

const COUNTRY_CODES =
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(
    " ",
  );
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: REGION_NAMES.of(code) ?? code })).sort(
  (first, second) => first.name.localeCompare(second.name),
);

function countryCodeFor(value: string, countries = COUNTRIES) {
  const code = value.trim().toUpperCase();
  if (COUNTRY_CODES.includes(code)) return code;
  return (
    countries.find((country) => country.name.toLowerCase() === value.trim().toLowerCase())?.code ??
    ""
  );
}

function countryFlag(code: string) {
  return [...code.toUpperCase()]
    .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
    .join("");
}

type Draft = {
  businessType: string;
  taxResidency: string;
  spokenLanguage: string;
  annualTurnover: string;
  goals: string[];
  documentTypes: string[];
  notes: string;
};

const defaults: Draft = {
  businessType: "",
  taxResidency: "",
  spokenLanguage: "",
  annualTurnover: "",
  goals: [],
  documentTypes: [],
  notes: "",
};

const businessTypes = ["Freelancer", "Small business", "Sole trader", "Employer", "Investor"];
const annualTurnover = ["Under 50k", "50k–200k", "200k–1M", "1M+"];
const goals = [
  "VAT compliance",
  "Document tracking",
  "Tax planning",
  "Filing deadline alerts",
  "Budget overview",
];
const documentTypes = ["Invoices", "Receipts", "Bank statements", "Payroll", "Contracts", "Travel"];

function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx("tick");
        onClick();
      }}
      className={`press flex min-h-14 w-full items-center justify-between gap-2 rounded-2xl border px-3.5 text-left text-[13px] font-bold transition-colors sm:text-[14px] ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-secondary/70 text-foreground/70"
      }`}
    >
      {label}
      <Check
        className={`size-4 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
      />
    </button>
  );
}

export function TaxpayerProfileGate() {
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale =
    localeCode(preferences.language) === "fr" ? "fr-FR" : localeCode(preferences.language);
  const localizedCountries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort(
      (first, second) => first.name.localeCompare(second.name, locale),
    );
  }, [locale]);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const {
    role,
    roleReady,
    user,
    country,
    taxpayerProfile,
    taxpayerSetupOpen,
    skipTaxpayerSetup,
    saveTaxpayerProfile,
    saveAvatar,
  } = useStore();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(defaults);
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const isAiEntryRoute =
    pathname === "/chat" || pathname === "/fisco-ai" || pathname === "/chat/fisco-ai";
  const open = roleReady && role === "taxpayer" && !!user && taxpayerSetupOpen && !isAiEntryRoute;

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDraft({
      businessType: taxpayerProfile.businessType,
      taxResidency: countryCodeFor(taxpayerProfile.taxResidency, [
        ...COUNTRIES,
        ...localizedCountries,
      ]),
      spokenLanguage: taxpayerProfile.spokenLanguage,
      annualTurnover: taxpayerProfile.annualTurnover,
      goals: taxpayerProfile.goals,
      documentTypes: taxpayerProfile.documentTypes,
      notes: taxpayerProfile.notes,
    });
    setPhoto(taxpayerProfile.photo);
    return lockScroll();
  }, [open, taxpayerProfile, localizedCountries]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const toggle = (group: "goals" | "documentTypes", value: string) => {
    const list = draft[group];
    const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    update(group, next);
  };

  const valid =
    !!photo &&
    draft.businessType.trim().length > 0 &&
    draft.taxResidency.trim().length > 0 &&
    !!draft.spokenLanguage;
  const canContinue =
    step === 0
      ? !!photo
      : step === 1
        ? !!draft.taxResidency && !!draft.businessType.trim() && !!draft.spokenLanguage
        : valid;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      sfx("confirm");
      const profile: TaxpayerProfile = {
        ...taxpayerProfile,
        displayName: taxpayerProfile.displayName || user?.name || "",
        photo,
        countryCode: draft.taxResidency || taxpayerProfile.countryCode || country || "",
        ...draft,
      };
      if (!(await saveTaxpayerProfile(profile))) {
        sfx("error");
        setError("Your profile could not be saved. Please try again.");
        setSaving(false);
        return;
      }
      sfx("success");
      setSaved(true);
      window.setTimeout(() => {
        setSaved(false);
        setSaving(false);
      }, 900);
    } catch (cause) {
      sfx("error");
      setError(cause instanceof Error ? cause.message : "Unable to save your profile.");
      setSaving(false);
    }
  };

  const hasSavedProfile =
    !!taxpayerProfile.photo &&
    !!taxpayerProfile.businessType.trim() &&
    !!taxpayerProfile.taxResidency.trim() &&
    !!taxpayerProfile.spokenLanguage.trim();

  const advance = () => {
    if (!canContinue || saving || uploading) return;
    if (step === STEP_COUNT - 1) {
      void submit();
      return;
    }
    sfx("whoosh");
    setStep((current) => current + 1);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] h-[100dvh] w-full overflow-hidden bg-background"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <div className="relative mx-auto flex h-full w-full max-w-[1120px] flex-col px-4 py-4 sm:px-8 sm:py-6">
            <motion.div
              initial={{ opacity: 0, y: 26, filter: "blur(16px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 18, filter: "blur(12px)" }}
              transition={{ duration: 0.45, ease: EASE }}
              className="no-scrollbar relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain"
            >
              <header className="relative mb-5 flex shrink-0 flex-col items-center border-b border-border/70 pb-4 text-center sm:mb-7 sm:pb-5">
                <h1 className="text-[24px] font-extrabold text-foreground sm:text-[30px]">
                  {t(STEP_COPY[step]!.title)}
                </h1>
                <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground sm:text-[14px]">
                  {t(STEP_COPY[step]!.description)}
                </p>
                <div
                  className="mt-3 flex items-center justify-center gap-2"
                  role="group"
                  aria-label={t("Profile pages")}
                >
                  {Array.from({ length: STEP_COUNT }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={`${t("Page")} ${index + 1}`}
                      aria-current={step === index ? "step" : undefined}
                      onClick={() => {
                        sfx("tick");
                        setStep(index);
                      }}
                      className="press grid size-4 place-items-center"
                    >
                      <motion.span
                        className="size-2 rounded-full bg-foreground/20"
                        animate={{
                          scale: step === index ? 1.5 : 1,
                          backgroundColor:
                            step === index
                              ? "var(--primary)"
                              : "color-mix(in oklab, var(--foreground) 20%, transparent)",
                        }}
                        transition={{ duration: 0.2, ease: EASE }}
                      />
                    </button>
                  ))}
                </div>
                {hasSavedProfile && (
                  <button
                    type="button"
                    title={t("Close profile editor")}
                    aria-label={t("Close profile editor")}
                    onClick={() => {
                      sfx("close");
                      skipTaxpayerSetup();
                    }}
                    className="press absolute right-0 top-0 grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/80"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </header>

              <div
                className={step === 0 ? "grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-3" : "hidden"}
              >
                <div className="flex items-center justify-center gap-3 py-0">
                  <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-background bg-secondary shadow-[0_12px_40px_-18px_rgba(0,0,0,0.35)] ring-2 ring-primary/25 min-[360px]:size-28 sm:size-32">
                    {photo ? (
                      <img
                        src={photo}
                        alt={t("Profile photo preview")}
                        className="size-full object-cover"
                      />
                    ) : (
                      <Camera className="size-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col items-start gap-2">
                    <p className="max-w-[180px] text-[14px] font-bold leading-snug text-foreground sm:text-[16px]">
                      {t(photo ? "Your selected picture" : "Preview your picture")}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        sfx("tap");
                        fileRef.current?.click();
                      }}
                      disabled={uploading}
                      className="press inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-secondary/60 px-5 text-[13px] font-bold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                    >
                      {uploading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Camera className="size-4" />
                      )}
                      {uploading
                        ? t("Uploading photo")
                        : photo
                          ? t("Change photo")
                          : t("Upload photo")}
                    </button>
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    setError(null);
                    try {
                      setPhoto(await saveAvatar(file));
                      sfx("reveal");
                    } catch (cause) {
                      sfx("error");
                      setError(cause instanceof Error ? cause.message : "Photo upload failed.");
                    } finally {
                      setUploading(false);
                      event.target.value = "";
                    }
                  }}
                />
                <div className="grid min-h-0 content-center grid-cols-4 place-items-center gap-1.5 py-1 min-[320px]:grid-cols-6 min-[320px]:gap-2 sm:gap-3">
                  {AVATAR_OPTIONS.map((avatar, index) => (
                    <button
                      key={avatar}
                      type="button"
                      aria-label={`${t("Choose avatar")} ${index + 1}`}
                      aria-pressed={photo === avatar}
                      onClick={() => {
                        sfx("select");
                        setPhoto(avatar);
                      }}
                      className={`press grid size-11 place-items-center overflow-hidden rounded-full border bg-secondary transition-transform min-[360px]:size-12 sm:size-14 ${photo === avatar ? "scale-105 border-primary ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : "border-border/60 hover:scale-105"}`}
                    >
                      <img src={avatar} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 18, filter: "blur(8px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: -18, filter: "blur(8px)" }}
                  transition={{ duration: 0.28, ease: EASE }}
                  className={
                    step === 0
                      ? "hidden"
                      : "min-h-0 flex-1 content-start overflow-hidden grid gap-3 sm:grid-cols-2"
                  }
                >
                  <section className={`sm:col-span-2 ${step === 1 ? "" : "hidden"}`}>
                    <h2 className="mb-2 text-[14px] font-bold text-foreground">
                      {t("Business type")}
                    </h2>
                    <div className="grid grid-cols-2 gap-2">
                      {businessTypes.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            sfx("select");
                            update("businessType", option);
                          }}
                          className={`press flex min-h-14 items-center justify-center rounded-2xl border px-3 py-2 text-center text-[14px] font-bold transition-colors ${
                            draft.businessType === option
                              ? "border-primary bg-primary/8 text-primary"
                              : "border-border bg-card/60 text-foreground"
                          }`}
                        >
                          {t(option)}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className={`sm:col-span-1 ${step === 1 ? "" : "hidden"}`}>
                    <h2 className="mb-2 text-[14px] font-bold text-foreground">
                      {t("🌍 Tax residency")}
                    </h2>
                    <Popover open={countryPickerOpen} onOpenChange={setCountryPickerOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          role="combobox"
                          aria-expanded={countryPickerOpen}
                          aria-label={t("Choose tax residency country")}
                          className="press flex h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card/80 px-4 text-left transition-colors hover:border-primary/50"
                        >
                          <span className="text-[26px] leading-none">
                            {COUNTRIES.find((item) => item.code === draft.taxResidency)
                              ? countryFlag(draft.taxResidency)
                              : "🌐"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                            {localizedCountries.find((item) => item.code === draft.taxResidency)
                              ?.name ?? t("Choose a country")}
                          </span>
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        sideOffset={8}
                        data-mobile-keyboard-picker=""
                        className="z-[130] overflow-hidden rounded-2xl border-border p-0 shadow-xl"
                        style={{ width: "var(--radix-popover-trigger-width)" }}
                      >
                        <Command>
                          <CommandInput placeholder={t("Search countries")} />
                          <CommandList className="max-h-72 scroll-py-1">
                            <CommandEmpty>{t("No country found.")}</CommandEmpty>
                            <CommandGroup>
                              {localizedCountries.map((item) => (
                                <CommandItem
                                  key={item.code}
                                  value={`${item.name} ${item.code}`}
                                  onSelect={() => {
                                    sfx("select");
                                    update("taxResidency", item.code);
                                    setCountryPickerOpen(false);
                                  }}
                                  className="min-h-11 gap-3 rounded-xl px-3 text-[14px] data-[selected=true]:bg-secondary"
                                >
                                  <span className="text-[21px] leading-none">
                                    {countryFlag(item.code)}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                  <span className="text-[11px] font-semibold text-muted-foreground">
                                    {item.code}
                                  </span>
                                  {draft.taxResidency === item.code && (
                                    <Check className="size-4 text-primary" />
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </section>

                  <section className={`sm:col-span-2 ${step === 1 ? "" : "hidden"}`}>
                    <h2 className="mb-2 text-[14px] font-bold text-foreground">
                      {t("Language you speak")}
                    </h2>
                    <LanguagePicker
                      label={t("Choose the language you speak")}
                      value={draft.spokenLanguage}
                      onChange={(value) => update("spokenLanguage", value as string)}
                    />
                  </section>

                  <section className={`sm:col-span-1 ${step === 1 ? "" : "hidden"}`}>
                    <h2 className="mb-2 text-[14px] font-bold text-foreground">
                      {t("💶 Annual turnover")}
                    </h2>
                    <div className="grid grid-cols-2 gap-2">
                      {annualTurnover.map((option) => (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={draft.annualTurnover === option}
                          onClick={() => {
                            sfx("tick");
                            update("annualTurnover", option);
                          }}
                          className={`press min-h-12 rounded-xl border px-3 text-[13px] font-bold transition-colors ${
                            draft.annualTurnover === option
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card/70 text-foreground hover:border-primary/40"
                          }`}
                        >
                          {t(option)}
                        </button>
                      ))}
                    </div>
                  </section>

                  <div className={`sm:col-span-2 ${step === 2 ? "" : "hidden"}`}>
                    <h2 className="mb-2 text-[14px] font-bold text-foreground">
                      {t("🎯 Main goals")}
                    </h2>
                    <div
                      role="group"
                      aria-label={t("Profile goals")}
                      className="grid grid-cols-2 gap-2"
                    >
                      {goals.map((goal) => (
                        <Pill
                          key={goal}
                          active={draft.goals.includes(goal)}
                          label={t(goal)}
                          onClick={() => toggle("goals", goal)}
                        />
                      ))}
                    </div>
                  </div>

                  <div className={`sm:col-span-2 ${step === 2 ? "" : "hidden"}`}>
                    <h2 className="mb-2 text-[14px] font-bold text-foreground">
                      {t("📄 Documents you track")}
                    </h2>
                    <div
                      role="group"
                      aria-label={t("Document types")}
                      className="grid grid-cols-2 gap-2"
                    >
                      {documentTypes.map((document) => (
                        <Pill
                          key={document}
                          active={draft.documentTypes.includes(document)}
                          label={t(document)}
                          onClick={() => toggle("documentTypes", document)}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="mt-3 shrink-0 border-t border-border/70 pt-3">
                {error && (
                  <p role="alert" className="mb-2 text-[11.5px] font-semibold text-destructive">
                    {t(error)}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    aria-label={t("Previous page")}
                    title={t("Previous page")}
                    onClick={() => {
                      if (step === 0) return;
                      sfx("close");
                      setStep((current) => current - 1);
                    }}
                    disabled={step === 0 || saving}
                    className="press inline-flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold text-muted-foreground transition-colors hover:bg-secondary/70 disabled:opacity-35"
                  >
                    <ArrowLeft className="size-4" /> {t("Back")}
                  </button>
                  <span className="sr-only">
                    {t("Page")} {step + 1} {t("of")} {STEP_COUNT}
                  </span>
                  <button
                    type="button"
                    onClick={advance}
                    aria-label={t(step === STEP_COUNT - 1 ? "Save profile" : "Next page")}
                    title={t(step === STEP_COUNT - 1 ? "Save profile" : "Next page")}
                    disabled={!canContinue || saving || uploading || saved}
                    className="press inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-[var(--shadow-accent)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45"
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : saved ? (
                      <Check className="size-4" />
                    ) : step === STEP_COUNT - 1 ? (
                      <FileText className="size-4" />
                    ) : (
                      <ArrowRight className="size-4" />
                    )}
                    {saving
                      ? t("Saving…")
                      : saved
                        ? t("Saved")
                        : step === STEP_COUNT - 1
                          ? t("Save profile")
                          : t("Continue")}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
