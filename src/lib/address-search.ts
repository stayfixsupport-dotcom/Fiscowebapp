export type AddressSuggestion = {
  address: string;
  lat: number;
  lng: number;
  city: string;
  countryCode: string;
};

type PhotonProperties = {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  locality?: string;
  town?: string;
  village?: string;
  municipality?: string;
  country?: string;
  countrycode?: string;
};

type PhotonFeature = {
  properties?: PhotonProperties;
  geometry?: { coordinates?: unknown };
};

type PhotonResponse = { features?: PhotonFeature[] };

type NominatimAddress = {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  residential?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
};

type NominatimPlace = {
  lat?: string;
  lon?: string;
  address?: NominatimAddress;
};

const exactSearchCache = new Map<string, AddressSuggestion[]>();
let nextExactSearchAt = 0;

function toAddressSuggestion(feature: PhotonFeature): AddressSuggestion | null {
  const properties = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  if (!properties || !Array.isArray(coordinates) || coordinates.length < 2) return null;

  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const city =
    properties.city ??
    properties.locality ??
    properties.town ??
    properties.village ??
    properties.municipality ??
    "";
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const name = properties.name?.trim();
  const primary =
    street ||
    (name && name !== city && name !== properties.postcode && name !== properties.country
      ? name
      : "");
  const locality = [properties.postcode, city].filter(Boolean).join(" ");
  const parts = [primary, locality, properties.country].filter((part, index, all) => {
    if (!part) return false;
    return all.findIndex((candidate) => candidate?.toLowerCase() === part.toLowerCase()) === index;
  });
  const countryCode = properties.countrycode?.toUpperCase() ?? "";
  const address = parts.join(", ");
  if (!address || !countryCode) return null;

  return { address, lat, lng, city, countryCode };
}

async function readFeatures(url: URL, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Address search is unavailable.");
  const data = (await response.json()) as PhotonResponse;
  return (data.features ?? [])
    .map(toAddressSuggestion)
    .filter((place): place is AddressSuggestion => place !== null);
}

function matchesStreetIntent(query: string, address: string) {
  if (!/^\s*#?\d/.test(query)) return true;

  const streetQuery = query
    .split(/[;,]/, 1)[0]!
    .replace(/^\s*#?\d+[a-z]?\s*/i, "")
    .replace(
      /^(?:street|st|rue|boulevard|boul|blvd|avenue|ave|av|road|rd|chemin|ch|route|place|pl|drive|dr|lane|ln)\.?\s+/i,
      "",
    )
    .replace(/^(?:de|du|des|la|le|the|of)\s+/i, "")
    .trim();
  const streetTerm = streetQuery.split(/\s+/)[0]?.toLocaleLowerCase();
  if (!streetTerm || streetTerm.length < 3) return true;

  const resultStreet = address
    .split(",")[0]
    ?.replace(/^\s*#?\d+[a-z]?\s*/i, "")
    .toLocaleLowerCase();
  return resultStreet?.includes(streetTerm) ?? false;
}

async function waitForExactSearchSlot(signal?: AbortSignal) {
  const scheduledAt = Math.max(Date.now(), nextExactSearchAt);
  nextExactSearchAt = scheduledAt + 1100;
  const delay = scheduledAt - Date.now();
  if (delay <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      const error = new Error("Address search was canceled.");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  if (signal?.aborted) {
    const error = new Error("Address search was canceled.");
    error.name = "AbortError";
    throw error;
  }
}

export async function searchAddresses(query: string, signal?: AbortSignal, language = "en") {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "7");
  url.searchParams.set("lang", language);
  const places = await readFeatures(url, signal);
  return places.filter((place) => matchesStreetIntent(query, place.address));
}

export async function searchExactAddresses(query: string, signal?: AbortSignal, language = "en") {
  const cacheKey = `${language}:${query.trim().toLocaleLowerCase()}`;
  const cached = exactSearchCache.get(cacheKey);
  if (cached) return cached;

  await waitForExactSearchSlot(signal);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "7");
  url.searchParams.set("accept-language", language);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Detailed address search is unavailable.");

  const places = (await response.json()) as NominatimPlace[];
  const results = places.flatMap((place): AddressSuggestion[] => {
    const details = place.address;
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    const countryCode = details?.country_code?.toUpperCase() ?? "";
    if (!details || !Number.isFinite(lat) || !Number.isFinite(lng) || !countryCode) return [];

    const city =
      details.city ??
      details.town ??
      details.village ??
      details.municipality ??
      details.county ??
      "";
    const street = [details.house_number, details.road ?? details.pedestrian ?? details.residential]
      .filter(Boolean)
      .join(" ");
    const address = [street, details.postcode, city, details.state, details.country]
      .filter(
        (part, index, all) =>
          !!part &&
          all.findIndex((candidate) => candidate?.toLowerCase() === part.toLowerCase()) === index,
      )
      .join(", ");
    return address && matchesStreetIntent(query, address)
      ? [{ address, lat, lng, city, countryCode }]
      : [];
  });
  exactSearchCache.set(cacheKey, results);
  if (exactSearchCache.size > 50) {
    const oldestKey = exactSearchCache.keys().next().value;
    if (oldestKey) exactSearchCache.delete(oldestKey);
  }
  return results;
}

export async function reverseAddress(lat: number, lng: number, signal?: AbortSignal) {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("lang", "en");
  const [place] = await readFeatures(url, signal);
  return place ?? null;
}
