export type LngLat = { lng: number; lat: number };

export const PRECISE_LOCATION_ACCURACY_METERS = 50;

export async function lookupCountryCode(lat: number, lng: number): Promise<string | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&lat=${lat}&lon=${lng}`,
    );
    if (!response.ok) return null;
    const result = (await response.json()) as { address?: { country_code?: unknown } };
    const countryCode = result.address?.country_code;
    return typeof countryCode === "string" && countryCode.length === 2
      ? countryCode.toUpperCase()
      : null;
  } catch {
    return null;
  }
}

export function distanceKm(a: LngLat, b: LngLat) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtKm = (km: number) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
