export type PracticeProfile = {
  name: string;
  firm: string;
  photo: string | null;
  bio: string;
  specialties: string[];
  languages: string[];
  phoneNumber: string;
  phoneCountryCode: string;
  timeZone: string;
  price: number;
  pricing: "Per hour" | "Per filing" | "Monthly retainer";
  currencyCode: string;
  freeIntro: boolean;
  days: string[];
  slots: string[];
  slotMinutes: number;
  holiday: boolean;
  holidayUntil: string;
  autoAccept: boolean;
  remote: boolean;
  homeVisits: boolean;
  maxClients: number;
  responseHours: number;
  address: string;
  city?: string;
  websiteUrl: string;
  bookingUrl: string;
  countryCode?: string;
  locationSelected: boolean;
  lng: number;
  lat: number;
  onboarded: boolean;
};

export const DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export const SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
] as const;

export const SPECIALTIES = [
  "VAT & CIT",
  "Corporate tax",
  "Payroll",
  "Audit",
  "Freelancers",
  "B2B & Sole Trader",
  "E-commerce",
  "Import/Export",
  "Bookkeeping",
  "Startups",
] as const;

export const LANGUAGES = ["Polish", "English", "French", "German"] as const;

export const DEFAULT_PROFILE: PracticeProfile = {
  name: "",
  firm: "",
  photo: null,
  bio: "",
  specialties: [],
  languages: [],
  phoneNumber: "",
  phoneCountryCode: "",
  timeZone: "UTC",
  price: 0,
  pricing: "Per filing",
  currencyCode: "EUR",
  freeIntro: true,
  days: [],
  slots: [],
  slotMinutes: 45,
  holiday: false,
  holidayUntil: "",
  autoAccept: false,
  remote: true,
  homeVisits: false,
  maxClients: 25,
  responseHours: 4,
  address: "",
  city: "",
  websiteUrl: "",
  bookingUrl: "",
  locationSelected: false,
  lng: 0,
  lat: 20,
  onboarded: false,
};

const ADMINISTRATIVE_AREA =
  /\b(?:avenue|boulevard|county|department|district|generala|generała|gmina|lane|metropolis|municipality|neighborhood|oblast|osiedle|province|provincia|powiat|region|road|rue|state|street|ulica|ul\.?|voivodeship)\b/i;

function isPostalCode(part: string) {
  return /^(?:\d{2,3}-\d{2,3}|\d{4,6}(?:[ -]\d{3,4})?)$/.test(part);
}

export function compactPracticeLocation(address: string, city?: string) {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return parts.join(", ");

  const country = parts[parts.length - 1]!;
  const knownCity = city?.trim();
  if (knownCity && !ADMINISTRATIVE_AREA.test(knownCity) && !isPostalCode(knownCity)) {
    return `${knownCity}, ${country}`;
  }

  const addressParts = parts.slice(0, -1);
  const postalIndex = addressParts.findIndex(isPostalCode);
  const localityParts = postalIndex >= 0 ? addressParts.slice(0, postalIndex) : addressParts;
  let locality: string | undefined;

  for (const part of localityParts) {
    if (!ADMINISTRATIVE_AREA.test(part) && !isPostalCode(part) && !/\d/.test(part)) {
      locality = part;
    }
  }

  return locality ? `${locality}, ${country}` : country;
}

const KEY = "fisco.practice";

export function readProfile(): PracticeProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        !parsed.onboarded &&
        (parsed.address === "Alger Centre" || parsed.address === "Katowice, Poland")
      ) {
        parsed.address = "";
      }
      return { ...DEFAULT_PROFILE, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PROFILE;
}

export function writeProfile(p: PracticeProfile) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  AE: "AED", AR: "ARS", AU: "AUD", BD: "BDT", BH: "BHD", BR: "BRL", CA: "CAD",
  CH: "CHF", CL: "CLP", CN: "CNY", CO: "COP", CZ: "CZK", DK: "DKK", DZ: "DZD",
  EG: "EGP", GB: "GBP", GH: "GHS", HK: "HKD", HU: "HUF", ID: "IDR", IL: "ILS",
  IN: "INR", IS: "ISK", JP: "JPY", KE: "KES", KR: "KRW", KW: "KWD", MA: "MAD",
  MX: "MXN", MY: "MYR", NG: "NGN", NO: "NOK", NP: "NPR", NZ: "NZD", OM: "OMR",
  PE: "PEN", PH: "PHP", PK: "PKR", PL: "PLN", QA: "QAR", RO: "RON", RS: "RSD",
  RU: "RUB", SA: "SAR", SE: "SEK", SG: "SGD", TH: "THB", TN: "TND", TR: "TRY",
  TW: "TWD", UA: "UAH", US: "USD", VN: "VND", ZA: "ZAR",
};

const EURO_COUNTRIES = new Set([
  "AD", "AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE",
  "IT", "LT", "LU", "LV", "MC", "MT", "NL", "PT", "SI", "SK", "SM", "VA",
]);

export function currencyForCountry(countryCode?: string | null) {
  const code = countryCode?.toUpperCase();
  if (!code) return "EUR";
  return CURRENCY_BY_COUNTRY[code] ?? (EURO_COUNTRIES.has(code) ? "EUR" : "USD");
}

export const formatMoney = (n: number, currency = "EUR") => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${currency}`;
  }
};

export const dzd = (n: number, currency = "EUR") => formatMoney(n, currency);
