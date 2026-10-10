export type Accountant = {
  id: string;
  countryCode?: string;
  name: string;
  firm: string;
  initials: string;
  photo: string;
  rating: number;
  reviews: number;
  verified: boolean;
  currencyCode: string;
  price: number;
  pricing: "Per hour" | "Per filing" | "Monthly retainer";
  freeIntro: boolean;
  specialties: string[];
  languages: string[];
  phone: string;
  phoneCountryCode?: string;
  days: string[];
  slots: string[];
  slotMinutes: number;
  autoAccept: boolean;
  remote: boolean;
  homeVisits: boolean;
  maxClients: number;
  responseHours: number;
  websiteUrl: string;
  bookingUrl: string;
  holiday: boolean;
  holidayUntil: string;
  address: string;
  lng: number;
  lat: number;
  nextSlot: string;
  availableNow: boolean;
  hours: string;
  bio: string;
};

/** Neutral world view used until a country or precise location is known. */
export const FALLBACK_CENTER = { lng: 0, lat: 20 };

export const ACCOUNTANTS: Accountant[] = [];

export type DocCategory =
  | "Invoice"
  | "Receipt"
  | "Payroll"
  | "Tax form"
  | "Contract"
  | "Utilities"
  | "Transport"
  | "Supplies"
  | "Services"
  | "Other";

export type DocAiDetails = {
  taxId: string | null;
  vat: number | null;
  invoiceNumber: string | null;
  lineItems: { label: string; amount: number }[];
  summary: string;
  confidence: number | null;
  raw: string;
};

export type Doc = {
  id: string;
  ownerId?: string;
  merchant: string;
  amount: number;
  currency?: string;
  date: string;
  createdAt?: string;
  category: DocCategory;
  status: "stored" | "sent" | "pending";
  pages: number;
  tint: string;
  driveUrl?: string;
  driveFileId?: string;
  mimeType?: string;
  previewUrl?: string;
  embedUrl?: string;
  aiDetails?: DocAiDetails;
};

export const DOCUMENTS: Doc[] = [];

export type Activity = {
  id: string;
  title: string;
  sub: string;
  amount: number;
  date: string;
  time: string;
  kind: "purchase" | "document" | "appointment" | "refund";
  status: string;
};

export const ACTIVITY: Activity[] = [
  {
    id: "a1",
    title: "Numidis Wholesale",
    sub: "Purchase · Supplies",
    amount: -1289.4,
    date: "Today",
    time: "14:20",
    kind: "purchase",
    status: "Invoice attached",
  },
  {
    id: "a2",
    title: "Sent to Cabinet El Amel",
    sub: "4 documents",
    amount: 0,
    date: "Today",
    time: "11:05",
    kind: "document",
    status: "Delivered",
  },
  {
    id: "a3",
    title: "Appointment confirmed",
    sub: "Nadia Belkacem · 16:30",
    amount: 0,
    date: "Today",
    time: "09:42",
    kind: "appointment",
    status: "Confirmed",
  },
  {
    id: "a4",
    title: "Sonelgaz",
    sub: "Purchase · Utilities",
    amount: -184.2,
    date: "Yesterday",
    time: "18:30",
    kind: "purchase",
    status: "Receipt stored",
  },
  {
    id: "a5",
    title: "VAT credit",
    sub: "Tax office · Q4",
    amount: 2045,
    date: "Yesterday",
    time: "10:12",
    kind: "refund",
    status: "Received",
  },
  {
    id: "a6",
    title: "Atelier Rive",
    sub: "Purchase · Subcontracting",
    amount: -640,
    date: "17 Mar",
    time: "16:55",
    kind: "purchase",
    status: "Pending review",
  },
  {
    id: "a7",
    title: "Café Tantonville",
    sub: "Purchase · Meals",
    amount: -42.5,
    date: "11 Mar",
    time: "13:04",
    kind: "purchase",
    status: "Receipt stored",
  },
];

export const SERIES: Record<string, { label: string; value: number }[]> = {
  "1W": [
    { label: "M", value: 210 },
    { label: "T", value: 380 },
    { label: "W", value: 290 },
    { label: "T", value: 640 },
    { label: "F", value: 420 },
    { label: "S", value: 180 },
    { label: "S", value: 96 },
  ],
  "1M": [
    { label: "W1", value: 1180 },
    { label: "W2", value: 1640 },
    { label: "W3", value: 980 },
    { label: "W4", value: 1020 },
  ],
  "4M": [
    { label: "Dec", value: 3420 },
    { label: "Jan", value: 4180 },
    { label: "Feb", value: 3760 },
    { label: "Mar", value: 4820 },
  ],
  "1Y": [
    { label: "Apr", value: 2980 },
    { label: "May", value: 3240 },
    { label: "Jun", value: 2760 },
    { label: "Jul", value: 3890 },
    { label: "Aug", value: 3120 },
    { label: "Sep", value: 4010 },
    { label: "Oct", value: 3580 },
    { label: "Nov", value: 4290 },
    { label: "Dec", value: 3420 },
    { label: "Jan", value: 4180 },
    { label: "Feb", value: 3760 },
    { label: "Mar", value: 4820 },
  ],
  ALL: [
    { label: "2022", value: 28400 },
    { label: "2023", value: 36900 },
    { label: "2024", value: 41200 },
    { label: "2025", value: 46800 },
  ],
};

export const CATEGORIES = [
  { name: "Supplies", value: 1840, share: 38 },
  { name: "Utilities", value: 920, share: 19 },
  { name: "Subcontracting", value: 780, share: 16 },
  { name: "Meals", value: 540, share: 11 },
  { name: "Transport", value: 430, share: 9 },
  { name: "Other", value: 310, share: 7 },
];

export const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);

/** Documents captured per weekday — used by the cadence bar chart. */
export const CADENCE = [
  { label: "Mon", value: 6 },
  { label: "Tue", value: 11 },
  { label: "Wed", value: 8 },
  { label: "Thu", value: 14 },
  { label: "Fri", value: 9 },
  { label: "Sat", value: 4 },
  { label: "Sun", value: 2 },
];

/** 14 weeks × 7 days of capture intensity for the consistency heatmap. */
export const HEATMAP: number[] = Array.from({ length: 98 }, (_, i) => {
  const wave = Math.sin(i / 6) * 0.5 + 0.5;
  const noise = ((i * 37) % 11) / 11;
  return Math.round((wave * 0.65 + noise * 0.35) * 6);
});

export const KPIS = [
  { label: "Deductible", value: 1840, hint: "+12% vs Feb", trend: 12 },
  { label: "VAT credit", value: 612.4, hint: "3 invoices", trend: 5 },
  { label: "Avg / doc", value: 268.3, hint: "18 documents", trend: -4 },
];
