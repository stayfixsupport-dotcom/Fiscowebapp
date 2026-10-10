import type { Accountant } from "./data";
import { supabase } from "@/integrations/supabase/client";

function currentScheduleState(row: Record<string, unknown>) {
  const timeZone = typeof row["time_zone"] === "string" ? row["time_zone"] : "UTC";
  let parts: Record<string, string> = {};
  let localDate = new Date().toISOString().slice(0, 10);
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    const dateParts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    localDate = `${dateParts["year"]}-${dateParts["month"]}-${dateParts["day"]}`;
  } catch {
    parts = {};
  }
  const holidayUntil = typeof row["holiday_until"] === "string" ? row["holiday_until"] : "";
  const holiday = row["holiday"] === true && (!holidayUntil || holidayUntil >= localDate);
  const days = Array.isArray(row["days"]) ? (row["days"] as string[]) : [];
  const slots = Array.isArray(row["slots"]) ? (row["slots"] as string[]) : [];
  const currentMinutes = Number(parts["hour"]) * 60 + Number(parts["minute"]);
  const slotMinutes = Number(row["slot_minutes"] ?? 45);
  const inOfficeHours =
    !!parts["weekday"] &&
    days.includes(parts["weekday"]) &&
    slots.some((slot) => {
      const [hours, minutes] = slot.split(":").map(Number);
      const start = hours * 60 + minutes;
      return currentMinutes >= start && currentMinutes < start + slotMinutes;
    });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const currentDayIndex = weekdays.indexOf(parts["weekday"] ?? "");
  let nextSlot = "";
  if (currentDayIndex >= 0) {
    for (let offset = 0; offset < 7 && !nextSlot; offset += 1) {
      const weekday = weekdays[(currentDayIndex + offset) % weekdays.length]!;
      if (!days.includes(weekday)) continue;
      const upcoming = slots
        .slice()
        .sort()
        .find((slot) => {
          if (offset > 0) return true;
          const [hours, minutes] = slot.split(":").map(Number);
          return hours * 60 + minutes > currentMinutes;
        });
      if (upcoming) nextSlot = `${weekday} ${upcoming}`;
    }
  }
  return { holiday, holidayUntil, availableNow: !holiday && inOfficeHours, nextSlot };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mapAccountant = (r: any): Accountant => {
  const availability = currentScheduleState(r);
  return {
    id: r.id,
    countryCode: r.country_code ?? undefined,
    name: r.name,
    firm: r.firm ?? "",
    initials: r.initials ?? "",
    photo: r.avatar_url ?? r.photo ?? "",
    rating: Number(r.rating ?? 0),
    reviews: Number(r.review_count ?? r.reviews ?? 0),
    verified: !!r.verified,
    currencyCode: String(r.currency_code ?? "EUR"),
    price: Number(r.price ?? 0),
    pricing:
      r.pricing === "Per hour" || r.pricing === "Monthly retainer" ? r.pricing : "Per filing",
    freeIntro: Boolean(r.free_intro),
    specialties: r.specialties ?? [],
    languages: r.languages ?? [],
    phone: r.phone_number ?? "",
    phoneCountryCode: typeof r.phone_country_code === "string" ? r.phone_country_code : undefined,
    days: Array.isArray(r.days) ? r.days : [],
    slots: Array.isArray(r.slots) ? r.slots : [],
    slotMinutes: Number(r.slot_minutes ?? 45),
    autoAccept: Boolean(r.auto_accept),
    remote: r.remote !== false,
    homeVisits: Boolean(r.home_visits),
    maxClients: Number(r.max_clients ?? 25),
    responseHours: Number(r.response_hours ?? 24),
    websiteUrl: typeof r.website_url === "string" ? r.website_url : "",
    bookingUrl: typeof r.booking_url === "string" ? r.booking_url : "",
    address: r.address ?? "",
    lng: Number(r.longitude ?? r.lng),
    lat: Number(r.latitude ?? r.lat),
    nextSlot: availability.nextSlot || r.next_slot || "",
    availableNow: availability.availableNow,
    holiday: availability.holiday,
    holidayUntil: availability.holidayUntil,
    hours: r.hours ?? "",
    bio: r.bio ?? "",
  };
};

function isPubliclyListed(row: Record<string, unknown>) {
  const latitude = Number(row["latitude"]);
  const longitude = Number(row["longitude"]);
  return (
    row["is_listed"] === true &&
    typeof row["avatar_url"] === "string" &&
    row["avatar_url"].trim().length > 0 &&
    typeof row["name"] === "string" &&
    row["name"].trim().length > 1 &&
    typeof row["firm"] === "string" &&
    row["firm"].trim().length > 1 &&
    typeof row["bio"] === "string" &&
    row["bio"].trim().length > 0 &&
    Array.isArray(row["specialties"]) &&
    row["specialties"].length > 0 &&
    row["latitude"] !== null &&
    row["latitude"] !== undefined &&
    row["longitude"] !== null &&
    row["longitude"] !== undefined &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  );
}

export async function fetchAccountantDirectory(countryCode: string, excludeId?: string) {
  let query = supabase
    .from("accountants" as never)
    .select("*")
    .eq("country_code", countryCode.toUpperCase())
    .eq("is_listed", true);
  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query;
  if (error) return { data: null, error };

  const accountants = ((data ?? []) as Record<string, unknown>[])
    .filter(isPubliclyListed)
    .map(mapAccountant)
    .filter(
      (accountant) =>
        accountant.countryCode?.toUpperCase() === countryCode.toUpperCase() &&
        Number.isFinite(accountant.lat) &&
        Number.isFinite(accountant.lng),
    );
  return { data: accountants, error: null };
}

export async function fetchAccountant(id: string): Promise<Accountant | null> {
  const { data } = await supabase
    .from("accountants" as never)
    .select("*")
    .eq("id", id)
    .eq("is_listed", true)
    .maybeSingle();
  return data && isPubliclyListed(data as Record<string, unknown>) ? mapAccountant(data) : null;
}

export type AccountantReview = {
  id: string;
  reviewerName: string;
  reviewerPhoto: string | null;
  rating: number;
  comment: string;
  createdAt: string;
};

export async function fetchAccountantReviews(accountantId: string): Promise<AccountantReview[]> {
  const { data, error } = await supabase
    .from("accountant_reviews" as never)
    .select("id, reviewer_name, reviewer_avatar_url, rating, comment, created_at")
    .eq("accountant_id", accountantId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      reviewer_name: string | null;
      reviewer_avatar_url: string | null;
      rating: number;
      comment: string;
      created_at: string;
    }>
  ).map((review) => ({
    id: review.id,
    reviewerName: review.reviewer_name || "Taxpayer",
    reviewerPhoto: review.reviewer_avatar_url,
    rating: Number(review.rating),
    comment: review.comment,
    createdAt: review.created_at,
  }));
}
