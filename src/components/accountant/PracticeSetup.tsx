import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  type CountryCode,
} from "libphonenumber-js";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Coins,
  Globe,
  Loader2,
  MapPin,
  Palmtree,
  Search,
  Sparkle,
  User,
  Zap,
} from "lucide-react";
import { AVATAR_OPTIONS } from "@/lib/illustrations";
import { LanguagePicker } from "@/components/LanguagePicker";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DAYS,
  SLOTS,
  SPECIALTIES,
  formatMoney,
  type PracticeProfile,
} from "@/lib/practice-profile";
import { sfx } from "@/lib/sfx";
import {
  searchAddresses,
  searchExactAddresses,
  type AddressSuggestion,
} from "@/lib/address-search";
import { useT, useUIPreferences } from "@/lib/ui-prefs";
import { localeCode } from "@/lib/i18n";

const LocationPicker = lazy(() => import("./LocationPicker"));

const EASE = [0.16, 1, 0.3, 1] as const;
const PHONE_COUNTRY_CODES = getCountries();
const FALLBACK_CAD_RATES: Record<string, number> = { CAD: 1, USD: 0.7 };

type CadExchangeRateResponse = {
  result?: string;
  rates?: Record<string, number>;
};

function countryFlag(code: string) {
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function isOptionalHttpUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname.includes(".") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isValidPracticePhone(number: string, countryCode: string) {
  return isValidPhoneNumber(number, countryCode as CountryCode);
}

function mergeAddressSuggestions(preferred: AddressSuggestion[], fallback: AddressSuggestion[]) {
  const addresses = new Set<string>();
  const coordinates = new Set<string>();
  return [...preferred, ...fallback]
    .filter((place) => {
      const address = place.address.trim().toLocaleLowerCase();
      const coordinatesKey = `${place.lat.toFixed(5)}:${place.lng.toFixed(5)}`;
      if (addresses.has(address) || coordinates.has(coordinatesKey)) return false;
      addresses.add(address);
      coordinates.add(coordinatesKey);
      return true;
    })
    .slice(0, 7);
}

const STEPS = [
  {
    key: "avatar",
    title: "Choose your picture",
    hint: "Pick an avatar or upload a photo.",
    icon: User,
  },
  { key: "identity", title: "Who you are", hint: "Name, practice and story", icon: User },
  { key: "place", title: "Where you work", hint: "Drop your anchor", icon: MapPin },
  { key: "price", title: "What you charge", hint: "Rate and intro call", icon: Coins },
  { key: "time", title: "When you're open", hint: "Days and slots", icon: Clock },
  { key: "extras", title: "How you work", hint: "Holiday and options", icon: Zap },
] as const;

/* ------------------------------ primitives ------------------------------- */

export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 ${
        on ? "bg-primary" : "bg-foreground/12"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className="absolute size-5 rounded-full bg-card shadow-soft"
        style={{ left: on ? 22 : 2 }}
      />
    </span>
  );
}

function OptionRow({
  icon: Icon,
  label,
  hint,
  on,
  onToggle,
}: {
  icon: typeof Zap;
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx("pop");
        onToggle();
      }}
      onPointerEnter={() => sfx("hover")}
      aria-pressed={on}
      className="press flex w-full min-w-0 max-w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/50"
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-2xl transition-colors ${
          on ? "bg-primary/12 text-primary" : "bg-secondary/80 text-foreground/55"
        }`}
      >
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <Toggle on={on} />
    </button>
  );
}

function Pill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onPointerEnter={() => sfx("hover")}
      onClick={() => {
        sfx("tick");
        onClick();
      }}
      className={`press relative rounded-full px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
        active ? "text-primary-foreground" : "bg-secondary/70 text-foreground/65"
      }`}
    >
      {active && (
        <motion.span
          layoutId={`pill-${String(children)}`}
          className="absolute inset-0 rounded-full bg-primary"
          transition={{ type: "spring", stiffness: 480, damping: 34 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  area,
  type = "text",
  optionalLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  area?: boolean;
  type?: "text" | "url";
  optionalLabel?: string;
}) {
  const [focus, setFocus] = useState(false);
  const Cmp = area ? "textarea" : "input";
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
        transition={{ duration: 0.22 }}
      />
      <span className="absolute top-2.5 left-4 text-[9.5px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
        {label}
        {optionalLabel && (
          <>
            {" "}
            <span aria-hidden="true" className="text-destructive">
              *
            </span>{" "}
            {optionalLabel}
          </>
        )}
      </span>
      <Cmp
        {...(!area ? { type } : {})}
        value={value}
        placeholder={placeholder}
        rows={area ? 3 : undefined}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        className={`w-full resize-none rounded-2xl bg-card/70 px-4 pt-7 pb-2.5 text-[14px] font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground/60 ${
          area ? "min-h-[104px]" : "h-16"
        }`}
      />
    </label>
  );
}

/* --------------------------------- form ---------------------------------- */

export function PracticeSetup({
  value,
  onSave,
  saveAvatar,
  onClose,
  saveError,
  mode = "onboard",
}: {
  value: PracticeProfile;
  onSave: (p: PracticeProfile) => void | Promise<void | boolean>;
  saveAvatar: (file: File) => Promise<string>;
  onClose?: () => void;
  saveError?: string | null;
  mode?: "onboard" | "edit";
}) {
  const t = useT();
  const { preferences } = useUIPreferences();
  const locale =
    localeCode(preferences.language) === "fr" ? "fr-FR" : localeCode(preferences.language);
  const phoneCountries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return PHONE_COUNTRY_CODES.map((code) => ({
      code,
      name: names.of(code) ?? code,
      callingCode: getCountryCallingCode(code),
    })).sort((first, second) => first.name.localeCompare(second.name, locale));
  }, [locale]);
  const searchLanguage = localeCode(preferences.language);
  const [p, setP] = useState<PracticeProfile>(value);
  const [cadExchangeRates, setCadExchangeRates] = useState(FALLBACK_CAD_RATES);
  const [step, setStep] = useState(0);
  const [completedEditSteps, setCompletedEditSteps] = useState<Set<number>>(() => new Set());
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [streetQuery, setStreetQuery] = useState("");
  const [searchingStreet, setSearchingStreet] = useState(false);
  const [streetResults, setStreetResults] = useState<AddressSuggestion[]>([]);
  const [addressSearchMessage, setAddressSearchMessage] = useState<string | null>(null);
  const [phoneCountryPickerOpen, setPhoneCountryPickerOpen] = useState(false);
  const [priceTouched, setPriceTouched] = useState(value.price > 0);
  const exactSearchController = useRef<AbortController | null>(null);
  const exactSearchQuery = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("https://open.er-api.com/v6/latest/CAD", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load exchange rates");
        const data = (await response.json()) as CadExchangeRateResponse;
        if (data.result !== "success" || !data.rates) return;
        setCadExchangeRates({ ...data.rates, ...FALLBACK_CAD_RATES });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const cadRate = cadExchangeRates[p.currencyCode] ?? 1;
  const minimumPrice = Math.round(cadRate * 10 * 100) / 100;
  const maximumPrice = Math.max(Math.round(cadRate * 3000 * 100) / 100, p.price);
  const priceStep = Math.max(0.01, Math.round(((maximumPrice - minimumPrice) / 118) * 100) / 100);

  useEffect(() => {
    setP((previous) => {
      if (priceTouched && previous.price >= minimumPrice) return previous;
      return { ...previous, price: minimumPrice };
    });
  }, [minimumPrice, priceTouched]);

  useEffect(() => {
    const query = streetQuery.trim();
    if (!query) {
      setStreetResults([]);
      setSearchingStreet(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void searchAddresses(query, controller.signal, searchLanguage)
        .then((results) => {
          if (!controller.signal.aborted) {
            setStreetResults((current) =>
              exactSearchQuery.current === query
                ? mergeAddressSuggestions(current, results)
                : results,
            );
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setStreetResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted && !exactSearchController.current) {
            setSearchingStreet(false);
          }
        });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchLanguage, streetQuery]);

  useEffect(() => () => exactSearchController.current?.abort(), []);

  const searchExactAddress = async () => {
    const query = streetQuery.trim();
    if (query.length < 3) return;

    exactSearchController.current?.abort();
    const controller = new AbortController();
    exactSearchController.current = controller;
    exactSearchQuery.current = query;
    setSearchingStreet(true);
    setAddressSearchMessage(null);
    try {
      const exactResults = await searchExactAddresses(query, controller.signal, searchLanguage);
      if (controller.signal.aborted) return;
      setStreetResults((current) => mergeAddressSuggestions(exactResults, current));
      if (exactResults.length === 0) {
        setAddressSearchMessage("No exact match found. Showing the closest available suggestions.");
      }
    } catch {
      if (!controller.signal.aborted) {
        setAddressSearchMessage(
          "Detailed address search is unavailable. Showing standard suggestions.",
        );
      }
    } finally {
      if (exactSearchController.current === controller) {
        exactSearchController.current = null;
        setSearchingStreet(false);
      }
    }
  };

  const selectStreet = (item: AddressSuggestion) => {
    exactSearchController.current?.abort();
    exactSearchController.current = null;
    exactSearchQuery.current = null;
    setP((prev) => ({
      ...prev,
      address: item.address,
      city: item.city,
      locationSelected: true,
      countryCode: item.countryCode,
      phoneCountryCode: prev.phoneCountryCode || item.countryCode,
      lat: item.lat,
      lng: item.lng,
    }));
    setStreetQuery("");
    setStreetResults([]);
    setSearchingStreet(false);
    setAddressSearchMessage(null);
    sfx("confirm");
  };

  const set = <K extends keyof PracticeProfile>(k: K, v: PracticeProfile[K]) =>
    setP((prev) => ({ ...prev, [k]: v }));

  const toggleIn = (k: "specialties" | "languages" | "days" | "slots", v: string) =>
    setP((prev) => ({
      ...prev,
      [k]: prev[k].includes(v) ? prev[k].filter((x) => x !== v) : [...prev[k], v],
    }));

  const complete = useMemo(() => {
    if (mode === "edit") {
      return Math.round((completedEditSteps.size / STEPS.length) * 100);
    }

    const flags = [
      p.name.trim().length > 1,
      p.firm.trim().length > 1,
      isValidPracticePhone(p.phoneNumber, p.phoneCountryCode || p.countryCode || "US"),
      !!p.photo,
      p.bio.trim().length > 0,
      p.locationSelected && p.address.trim().length > 0,
      p.days.length > 0,
      p.slots.length > 0,
      priceTouched && p.price > 0,
      p.specialties.length > 0,
      publishConfirmed,
    ];
    return Math.round((flags.filter(Boolean).length / flags.length) * 100);
  }, [completedEditSteps, mode, p, priceTouched, publishConfirmed]);

  const last = step === STEPS.length - 1;
  const websiteUrlValid = isOptionalHttpUrl(p.websiteUrl);
  const bookingUrlValid = isOptionalHttpUrl(p.bookingUrl);
  const canNext =
    step === 0
      ? !!p.photo
      : step === 1
        ? p.name.trim().length > 1 &&
          p.firm.trim().length > 1 &&
          p.bio.trim().length > 0 &&
          isValidPracticePhone(p.phoneNumber, p.phoneCountryCode || p.countryCode || "US") &&
          websiteUrlValid &&
          bookingUrlValid
        : step === 2
          ? p.locationSelected && !!p.countryCode && p.address.trim().length > 0
          : step === 3
            ? p.price > 0
            : step === 4
              ? p.days.length > 0 && p.slots.length > 0
              : mode === "edit" || publishConfirmed;

  const next = async () => {
    if (!canNext) return;
    if (last) {
      sfx("confirm");
      setSaving(true);
      setLocalSaveError(null);
      try {
        const result = await onSave({ ...p, onboarded: true });
        if (result === false) {
          sfx("error");
          return;
        }
        sfx("success");
        setSaved(true);
        if (mode === "edit") {
          setCompletedEditSteps((previous) => new Set(previous).add(step));
        }
      } catch {
        sfx("error");
        setLocalSaveError("Your practice could not be saved. Please try again.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (mode === "edit") {
      setCompletedEditSteps((previous) => new Set(previous).add(step));
    }
    if (step === 3) setPriceTouched(true);
    sfx("whoosh");
    setStep((s) => s + 1);
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setUploadingPhoto(true);
    setLocalSaveError(null);
    try {
      const photo = await saveAvatar(f);
      set("photo", photo);
      sfx("reveal");
    } catch (error) {
      sfx("error");
      setLocalSaveError(error instanceof Error ? error.message : "Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-w-0 w-full max-w-full flex-col">
      <header className="relative mb-5 flex shrink-0 flex-col items-center border-b border-border/70 pb-4 text-center sm:mb-7 sm:pb-5">
        <h1 className="text-[24px] font-extrabold text-foreground sm:text-[30px]">
          {t(STEPS[step]!.title)}
        </h1>
        <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground sm:text-[14px]">
          {t(STEPS[step]!.hint)}
        </p>
        <div
          className="mt-3 flex items-center justify-center gap-2"
          role="group"
          aria-label={t("Profile pages")}
        >
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={`${t("Page")} ${i + 1}: ${t(s.title)}`}
              aria-current={step === i ? "step" : undefined}
              onClick={() => {
                sfx("tick");
                setStep(i);
              }}
              className="press grid size-4 place-items-center"
            >
              <motion.span
                className="size-2 rounded-full bg-foreground/20"
                animate={{
                  scale: step === i ? 1.5 : 1,
                  backgroundColor:
                    step === i
                      ? "var(--primary)"
                      : "color-mix(in oklab, var(--foreground) 20%, transparent)",
                }}
                transition={{ duration: 0.2, ease: EASE }}
              />
            </button>
          ))}
        </div>
      </header>

      <div className="relative flex min-w-0 w-full flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={STEPS[step]!.key}
            initial={{ opacity: 0, y: 12, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(12px)" }}
            transition={{ duration: 0.38, ease: EASE }}
            className={
              step === 0 ? "grid min-w-0 min-h-0 grid-rows-[auto_1fr] gap-3" : "grid min-w-0 gap-3"
            }
          >
            {step === 0 && (
              <>
                <div className="flex items-center justify-center gap-3 py-0">
                  <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-background bg-secondary shadow-[0_12px_40px_-18px_rgba(0,0,0,0.35)] ring-2 ring-primary/25 min-[360px]:size-28 sm:size-32">
                    {p.photo ? (
                      <img
                        src={p.photo}
                        alt={t("Profile photo preview")}
                        className="size-full object-cover"
                      />
                    ) : (
                      <Camera className="size-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col items-start gap-2">
                    <p className="max-w-[180px] text-[14px] font-bold leading-snug text-foreground sm:text-[16px]">
                      {t(p.photo ? "Your selected picture" : "Preview your picture")}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        sfx("tap");
                        fileRef.current?.click();
                      }}
                      disabled={uploadingPhoto}
                      className="press inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-secondary/60 px-5 text-[13px] font-bold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                    >
                      {uploadingPhoto ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Camera className="size-4" />
                      )}
                      {uploadingPhoto
                        ? t("Uploading photo")
                        : p.photo
                          ? t("Change photo")
                          : t("Upload photo")}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(event) => {
                        void pickPhoto(event.target.files?.[0]).finally(() => {
                          event.target.value = "";
                        });
                      }}
                    />
                  </div>
                </div>
                <div className="grid min-h-0 content-center grid-cols-4 place-items-center gap-1.5 py-1 min-[320px]:grid-cols-6 min-[320px]:gap-2 sm:gap-3">
                  {AVATAR_OPTIONS.map((avatar, index) => (
                    <button
                      key={avatar}
                      type="button"
                      aria-label={`${t("Choose avatar")} ${index + 1}`}
                      aria-pressed={p.photo === avatar}
                      onClick={() => {
                        sfx("select");
                        set("photo", avatar);
                      }}
                      className={`press grid size-11 place-items-center overflow-hidden rounded-full border bg-secondary transition-transform min-[360px]:size-12 sm:size-14 ${p.photo === avatar ? "scale-105 border-primary ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : "border-border/60 hover:scale-105"}`}
                    >
                      <img src={avatar} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <Field
                  label={t("Full name")}
                  value={p.name}
                  onChange={(v) => set("name", v)}
                  placeholder={t("e.g. Seif El Islam")}
                />
                <Field
                  label={t("Office name")}
                  value={p.firm}
                  onChange={(v) => set("firm", v)}
                  placeholder={t("e.g. Katowice Fiscal Advisory")}
                />
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
                    {t("Phone number")}
                  </label>
                  <div className="flex h-16 items-center gap-2 rounded-2xl bg-card/70 px-3 ring-1 ring-foreground/8 focus-within:ring-2 focus-within:ring-primary/45">
                    <Popover
                      open={phoneCountryPickerOpen}
                      onOpenChange={(open) => {
                        setPhoneCountryPickerOpen(open);
                        sfx(open ? "open" : "close");
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          role="combobox"
                          aria-label={t("Phone country calling code")}
                          aria-expanded={phoneCountryPickerOpen}
                          className="press flex h-11 max-w-[142px] shrink-0 items-center gap-1.5 rounded-xl bg-secondary/60 px-2 text-[12px] font-bold"
                        >
                          <span>{countryFlag(p.phoneCountryCode || p.countryCode || "US")}</span>
                          <span>
                            +
                            {phoneCountries.find(
                              (item) => item.code === (p.phoneCountryCode || p.countryCode || "US"),
                            )?.callingCode ?? "1"}
                          </span>
                          <ChevronDown className="size-3.5 shrink-0 opacity-55" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        sideOffset={8}
                        data-mobile-keyboard-picker=""
                        className="z-[130] overflow-hidden rounded-2xl border-border p-0 shadow-xl"
                        style={{ width: "min(320px, calc(100vw - 2rem))" }}
                      >
                        <Command>
                          <CommandInput placeholder={t("Search country or calling code")} />
                          <CommandList className="max-h-72 scroll-py-1">
                            <CommandEmpty>{t("No country found.")}</CommandEmpty>
                            <CommandGroup>
                              {phoneCountries.map((country) => {
                                const selected =
                                  country.code === (p.phoneCountryCode || p.countryCode || "US");
                                return (
                                  <CommandItem
                                    key={country.code}
                                    value={`${country.name} ${country.code} +${country.callingCode}`}
                                    onSelect={() => {
                                      set("phoneCountryCode", country.code);
                                      setPhoneCountryPickerOpen(false);
                                      sfx("select");
                                    }}
                                    className="min-h-11 gap-3 rounded-xl px-3 text-[13px] data-[selected=true]:bg-secondary"
                                  >
                                    <span>{countryFlag(country.code)}</span>
                                    <span className="min-w-0 flex-1 truncate">{country.name}</span>
                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                      +{country.callingCode}
                                    </span>
                                    {selected && <Check className="size-4 shrink-0 text-primary" />}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <input
                      type="tel"
                      autoComplete="tel-national"
                      value={p.phoneNumber}
                      onChange={(event) =>
                        setP((previous) => ({
                          ...previous,
                          phoneNumber: event.target.value,
                          phoneCountryCode:
                            previous.phoneCountryCode || previous.countryCode || "US",
                        }))
                      }
                      placeholder={t("Phone number")}
                      aria-label={t("Accountant phone number")}
                      aria-invalid={
                        !!p.phoneNumber &&
                        !isValidPracticePhone(
                          p.phoneNumber,
                          p.phoneCountryCode || p.countryCode || "US",
                        )
                      }
                      className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  {!!p.phoneNumber &&
                    !isValidPracticePhone(
                      p.phoneNumber,
                      p.phoneCountryCode || p.countryCode || "US",
                    ) && (
                      <p className="mt-1.5 px-1 text-[11px] font-semibold text-destructive">
                        {t("Enter a valid phone number for the selected country.")}
                      </p>
                    )}
                </div>
                <Field
                  label={t("Website link")}
                  optionalLabel={t("Optional")}
                  value={p.websiteUrl}
                  onChange={(v) => set("websiteUrl", v)}
                  placeholder={t("Practice website URL")}
                  type="url"
                />
                {!websiteUrlValid && (
                  <p className="-mt-2 px-1 text-[11px] font-semibold text-destructive">
                    {t("Enter a valid website URL beginning with https:// or http://.")}
                  </p>
                )}
                <Field
                  label={t("Booking link")}
                  optionalLabel={t("Optional")}
                  value={p.bookingUrl}
                  onChange={(v) => set("bookingUrl", v)}
                  placeholder={t("Booking URL")}
                  type="url"
                />
                {!bookingUrlValid && (
                  <p className="-mt-2 px-1 text-[11px] font-semibold text-destructive">
                    {t("Enter a valid booking URL beginning with https:// or http://.")}
                  </p>
                )}
                <Field
                  label={t("Short bio")}
                  area
                  value={p.bio}
                  onChange={(v) => set("bio", v)}
                  placeholder={t(
                    "Chartered accountant specializing in VAT, CIT, and freelancer taxes…",
                  )}
                />
                <div>
                  <div className="mb-2 text-[10px] font-bold tracking-[0.18em] uppercase opacity-50">
                    {t("Specialties")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SPECIALTIES.map((s) => (
                      <Pill
                        key={s}
                        active={p.specialties.includes(s)}
                        onClick={() => toggleIn("specialties", s)}
                      >
                        {t(s)}
                      </Pill>
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p className="px-1 text-[12px] text-muted-foreground">
                  {t(
                    "Search by street, town, or postal code. Press Enter for exact matches, or move the pin.",
                  )}
                </p>

                <div className="relative">
                  <div className="glass flex h-12 items-center gap-2.5 rounded-2xl px-3.5 border border-primary/20">
                    {searchingStreet ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <Search className="size-4 text-primary" />
                    )}
                    <input
                      type="text"
                      value={streetQuery}
                      aria-label={t("Search for an office address")}
                      autoComplete="off"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void searchExactAddress();
                        }
                      }}
                      onChange={(event) => {
                        const query = event.target.value;
                        exactSearchController.current?.abort();
                        exactSearchController.current = null;
                        exactSearchQuery.current = null;
                        setStreetQuery(query);
                        setStreetResults([]);
                        setSearchingStreet(query.trim().length > 0);
                        setAddressSearchMessage(null);
                        setP((previous) => ({
                          ...previous,
                          address: "",
                          city: "",
                          countryCode: "",
                          locationSelected: false,
                        }));
                      }}
                      placeholder={t("Street, town, or postal code")}
                      className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:text-muted-foreground"
                    />
                    {streetQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          exactSearchController.current?.abort();
                          exactSearchController.current = null;
                          exactSearchQuery.current = null;
                          setStreetQuery("");
                          setStreetResults([]);
                          setSearchingStreet(false);
                          setAddressSearchMessage(null);
                        }}
                        className="text-[11px] font-bold text-muted-foreground hover:text-foreground"
                      >
                        {t("Clear")}
                      </button>
                    )}
                  </div>

                  {streetResults.length > 0 && (
                    <div
                      role="listbox"
                      aria-label={t("Address suggestions")}
                      className="absolute top-full left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-border bg-card p-1.5 shadow-float divide-y divide-border/40"
                    >
                      {streetResults.map((result) => (
                        <button
                          key={`${result.lat}:${result.lng}`}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => selectStreet(result)}
                          className="press flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left text-[12px] hover:bg-secondary/70 transition-colors"
                        >
                          <span className="min-w-0 flex-1 font-medium text-foreground">
                            {result.address}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {streetQuery.trim() && !searchingStreet && streetResults.length === 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-2xl border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground shadow-float">
                      {t(
                        addressSearchMessage ??
                          "No matching addresses. Try a nearby town or postal code.",
                      )}
                    </div>
                  )}
                  {streetResults.length > 0 && addressSearchMessage && (
                    <p role="status" className="mt-2 px-1 text-[11px] text-muted-foreground">
                      {t(addressSearchMessage)}
                    </p>
                  )}
                </div>

                <Suspense
                  fallback={
                    <div className="h-[280px] animate-pulse rounded-[24px] bg-secondary/70" />
                  }
                >
                  <LocationPicker
                    lng={p.lng}
                    lat={p.lat}
                    address={p.address}
                    onChange={(coordinates) => {
                      if (coordinates.address && coordinates.countryCode) {
                        setP((previous) => ({
                          ...previous,
                          ...coordinates,
                          locationSelected: true,
                          phoneCountryCode:
                            previous.phoneCountryCode || coordinates.countryCode || "US",
                        }));
                        exactSearchController.current?.abort();
                        exactSearchController.current = null;
                        exactSearchQuery.current = null;
                        setStreetQuery("");
                        setStreetResults([]);
                        setSearchingStreet(false);
                        setAddressSearchMessage(null);
                      } else {
                        setP((previous) => ({
                          ...previous,
                          lat: coordinates.lat,
                          lng: coordinates.lng,
                          address: "",
                          city: "",
                          countryCode: "",
                          locationSelected: false,
                        }));
                      }
                    }}
                    className="h-[280px] rounded-[24px]"
                  />
                </Suspense>
              </>
            )}

            {step === 3 && (
              <>
                <div className="grid gap-1">
                  <div className="px-1 text-[10px] font-bold tracking-[0.18em] uppercase opacity-50">
                    {t("Rate currency")}
                  </div>
                  <CurrencyPicker
                    value={p.currencyCode}
                    onChange={(currencyCode) => {
                      setPriceTouched(true);
                      const nextMinimum =
                        Math.round((cadExchangeRates[currencyCode] ?? 1) * 10 * 100) / 100;
                      setP((previous) => ({
                        ...previous,
                        currencyCode,
                        price: Math.max(previous.price, nextMinimum),
                      }));
                    }}
                    label={t("Choose rate currency")}
                  />
                </div>
                <div className="rounded-[24px] bg-card/60 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold tracking-[0.18em] uppercase opacity-50">
                      {t("Your rate")}
                    </span>
                    <motion.span
                      key={p.price}
                      initial={{ y: -6, opacity: 0.4 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="num text-[26px] leading-none font-bold"
                    >
                      {formatMoney(p.price, p.currencyCode)}
                    </motion.span>
                  </div>
                  <input
                    type="range"
                    min={minimumPrice}
                    max={maximumPrice}
                    step={priceStep}
                    value={p.price}
                    onChange={(e) => {
                      setPriceTouched(true);
                      set("price", Number(e.target.value));
                    }}
                    onPointerUp={() => sfx("tick")}
                    className="mt-4 w-full accent-[var(--primary)]"
                  />
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(["Per hour", "Per filing", "Monthly retainer"] as const).map((m) => (
                        <Pill
                          key={m}
                          active={p.pricing === m}
                          onClick={() => {
                            setPriceTouched(true);
                            set("pricing", m);
                          }}
                        >
                        {t(m)}
                      </Pill>
                    ))}
                  </div>
                </div>
                <OptionRow
                  icon={Sparkle}
                  label={t("Free 15-min intro call")}
                  hint={t("Shown as a badge on your profile")}
                  on={p.freeIntro}
                  onToggle={() => set("freeIntro", !p.freeIntro)}
                />
                <div className="rounded-[24px] bg-card/60 p-4">
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="font-bold">{t("Reply within")}</span>
                    <span className="num font-bold">{p.responseHours} h</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={48}
                    value={p.responseHours}
                    onChange={(e) => set("responseHours", Number(e.target.value))}
                    className="mt-3 w-full accent-[var(--primary)]"
                  />
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div>
                  <div className="mb-2 text-[10px] font-bold tracking-[0.18em] uppercase opacity-50">
                    {t("Working days")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((d) => (
                      <Pill key={d} active={p.days.includes(d)} onClick={() => toggleIn("days", d)}>
                        {t(d)}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[10px] font-bold tracking-[0.18em] uppercase opacity-50">
                    {t("Bookable slots")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SLOTS.map((s) => (
                      <Pill
                        key={s}
                        active={p.slots.includes(s)}
                        onClick={() => toggleIn("slots", s)}
                      >
                        {s}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div className="rounded-[24px] bg-card/60 p-4">
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="font-bold">{t("Appointment length")}</span>
                    <span className="num font-bold">{p.slotMinutes} min</span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={120}
                    step={15}
                    value={p.slotMinutes}
                    onChange={(e) => set("slotMinutes", Number(e.target.value))}
                    className="mt-3 w-full accent-[var(--primary)]"
                  />
                </div>
                <div className="rounded-[24px] bg-card/60 p-4 text-[12px] text-muted-foreground">
                  <span className="font-bold text-foreground">
                    {p.days.length * p.slots.length}
                  </span>{" "}
                  {t("meeting slots per week")} · {p.slotMinutes} {t("min each")}
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <motion.div
                  animate={{
                    backgroundColor: p.holiday
                      ? "color-mix(in oklab, var(--primary) 12%, transparent)"
                      : "color-mix(in oklab, var(--card) 60%, transparent)",
                  }}
                  className="rounded-[24px] p-1"
                >
                  <OptionRow
                    icon={Palmtree}
                    label={t("Holiday mode")}
                    hint={t(
                      p.holiday ? "Hidden from search, bookings paused" : "You're accepting work",
                    )}
                    on={p.holiday}
                    onToggle={() => set("holiday", !p.holiday)}
                  />
                  <AnimatePresence initial={false}>
                    {p.holiday && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="overflow-hidden px-3 pb-3"
                      >
                        <label className="flex items-center justify-between gap-3 rounded-2xl bg-card/70 px-4 py-3">
                          <span className="text-[12.5px] font-bold">{t("Back on")}</span>
                          <input
                            type="date"
                            value={p.holidayUntil}
                            onChange={(e) => set("holidayUntil", e.target.value)}
                            className="num bg-transparent text-[13px] font-bold outline-none"
                          />
                        </label>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                <div className="grid">
                  <OptionRow
                    icon={Zap}
                    label={t("Auto-accept bookings")}
                    hint={t("Confirm requests without reviewing them")}
                    on={p.autoAccept}
                    onToggle={() => set("autoAccept", !p.autoAccept)}
                  />
                  <OptionRow
                    icon={Globe}
                    label={t("Remote consultations")}
                    hint={t("Video and chat appointments")}
                    on={p.remote}
                    onToggle={() => set("remote", !p.remote)}
                  />
                  <OptionRow
                    icon={MapPin}
                    label={t("Client visits")}
                    hint={t("You travel to the client's office")}
                    on={p.homeVisits}
                    onToggle={() => set("homeVisits", !p.homeVisits)}
                  />
                </div>

                <div className="rounded-[24px] bg-card/60 p-4">
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="font-bold">{t("Client capacity")}</span>
                    <span className="num font-bold">{p.maxClients}</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={p.maxClients}
                    onChange={(e) => set("maxClients", Number(e.target.value))}
                    className="mt-3 w-full accent-[var(--primary)]"
                  />
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-bold tracking-[0.18em] uppercase opacity-50">
                    {t("Languages")}
                  </div>
                  <LanguagePicker
                    label={t("Languages spoken by the accountant")}
                    value={p.languages}
                    multiple
                    onChange={(value) => set("languages", value as string[])}
                  />
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {last && (
          <label className="mt-4 flex items-start gap-3 rounded-[20px] bg-primary/8 px-4 py-3">
            <input
              type="checkbox"
              checked={publishConfirmed}
              onChange={(event) => {
                sfx("tick");
                setPublishConfirmed(event.target.checked);
              }}
              className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span className="text-[12px] leading-5 font-semibold">
              {t("I authorize Fisco to publish this profile in the public accountant directory.")}
            </span>
          </label>
        )}

        {/* footer */}
        {(saveError || localSaveError) && (
          <div
            role="alert"
            className="mt-4 rounded-2xl bg-destructive/10 px-3.5 py-3 text-[12px] font-semibold text-destructive"
          >
            {t(saveError || localSaveError || "")}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          {step > 0 && (
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                sfx("close");
                setStep((s) => s - 1);
              }}
              className="press glass grid size-12 place-items-center rounded-full"
              aria-label={t("Back")}
            >
              <ArrowLeft className="size-4" />
            </motion.button>
          )}
          <motion.button
            whileHover={{ y: canNext ? -2 : 0 }}
            whileTap={{ scale: canNext ? 0.985 : 1 }}
            disabled={!canNext || saved || saving}
            onClick={() => void next()}
            className="press flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-bold text-primary-foreground disabled:opacity-45"
            style={{ boxShadow: "var(--shadow-accent)" }}
          >
            {saving ? (
              t("Saving practice...")
            ) : saved ? (
              <>
                <Check className="size-4" /> {t("Saved")}
              </>
            ) : last ? (
              <>
                {t(mode === "edit" ? "Save profile" : "Publish profile")}{" "}
                <Check className="size-4" />
              </>
            ) : (
              <>
                {t("Continue")} <ArrowRight className="size-4" />
              </>
            )}
          </motion.button>
        </div>

        <div className="mt-3 flex items-center gap-2 px-1">
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase opacity-45">
            {t("Profile")} {complete}%
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <motion.span
              className="block h-full rounded-full bg-positive"
              animate={{ width: `${complete}%` }}
              transition={{ duration: 0.5, ease: EASE }}
            />
          </span>
        </div>

        <AnimatePresence>
          {saved && (
            <motion.span
              className="pointer-events-none absolute inset-0 rounded-[30px] bg-primary/18"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: EASE }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
