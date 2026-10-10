import { useEffect, useRef, useState } from "react";
import { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { motion } from "motion/react";
import { OSM_RASTER_STYLE } from "@/lib/free-map";
import { sfx } from "@/lib/sfx";
import { reverseAddress } from "@/lib/address-search";
import { useT } from "@/lib/ui-prefs";

type Props = {
  lng: number;
  lat: number;
  address: string;
  onChange: (c: {
    lng: number;
    lat: number;
    address?: string;
    city?: string;
    countryCode?: string;
  }) => void;
  className?: string;
};

/**
 * Drop-anchor picker: the map moves under a fixed pin. The pin lifts while the
 * map is in motion and lands with a ripple when the gesture settles.
 */
export default function LocationPicker({ lng, lat, address, onChange, className }: Props) {
  const t = useT();
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const dragging = useRef(false);
  const [moving, setMoving] = useState(false);
  const [ripple, setRipple] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!holder.current || map.current) return;
    const currentMap = new MLMap({
      container: holder.current,
      style: OSM_RASTER_STYLE,
      center: [lng, lat],
      zoom: 13.8,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    currentMap.touchZoomRotate.disableRotation();
    map.current = currentMap;
    currentMap.on("dragstart", () => {
      dragging.current = true;
      setMoving(true);
    });
    currentMap.on("moveend", async () => {
      if (!dragging.current) return;
      dragging.current = false;
      setMoving(false);
      const center = currentMap.getCenter();
      const nextCoords = { lng: +center.lng.toFixed(5), lat: +center.lat.toFixed(5) };
      try {
        const place = await reverseAddress(nextCoords.lat, nextCoords.lng);
        onChangeRef.current({ ...nextCoords, ...place });
      } catch {
        onChangeRef.current(nextCoords);
      }
      setRipple((r) => r + 1);
      sfx("pop");
    });

    currentMap.on("style.load", () => {
      setMapError(null);
    });
    currentMap.on("error", (event) => {
      if (/abort/i.test(event.error?.message ?? "")) return;
      setMapError("OpenStreetMap tiles could not load. Check your connection and try again.");
    });

    const resizeObserver = new ResizeObserver(() => currentMap.resize());
    resizeObserver.observe(holder.current);
    const raf = requestAnimationFrame(() => currentMap.resize());

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      currentMap.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smoothly fly to newly selected coordinates (e.g. from search or GPS)
  useEffect(() => {
    if (!map.current) return;
    const center = map.current.getCenter();
    const diff = Math.hypot(center.lng - lng, center.lat - lat);
    if (diff > 0.0008) {
      map.current.flyTo({ center: [lng, lat], zoom: 14.5, essential: true });
    }
  }, [lng, lat]);

  return (
    <div className={className} style={{ position: "relative", overflow: "hidden" }}>
      <div ref={holder} style={{ position: "absolute", inset: 0 }} />
      {mapError && (
        <div
          role="alert"
          className="absolute inset-x-3 top-3 rounded-2xl bg-card px-3 py-2 text-xs text-destructive shadow-soft"
        >
          {t(mapError)}
        </div>
      )}

      {/* fixed anchor */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="relative -translate-y-3">
          <motion.div
            animate={{ y: moving ? -16 : 0, scale: moving ? 1.06 : 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            className="relative z-10 grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"
            style={{ boxShadow: "var(--shadow-accent)" }}
          >
            <svg viewBox="0 0 24 24" className="size-5 fill-current">
              <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
            </svg>
          </motion.div>
          <motion.span
            aria-hidden
            className="absolute left-1/2 z-0 h-4 w-px -translate-x-1/2 bg-foreground/45"
            style={{ top: 40 }}
            animate={{ scaleY: moving ? 1.9 : 1, opacity: moving ? 0.9 : 0.5 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          />
          <motion.span
            key={ripple}
            aria-hidden
            className="absolute left-1/2 size-6 -translate-x-1/2 rounded-full border-2 border-primary/70"
            style={{ top: 52 }}
            initial={{ scale: 0.3, opacity: 0.9 }}
            animate={{ scale: 2.4, opacity: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.span
            aria-hidden
            className="absolute left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground/60"
            style={{ top: 56 }}
            animate={{ scale: moving ? 0.6 : 1, opacity: moving ? 0.35 : 0.7 }}
          />
        </div>
      </div>

      {/* coordinate readout */}
      <motion.div
        animate={{ y: moving ? 4 : 0, opacity: moving ? 0.75 : 1 }}
        className="glass-ink pointer-events-none absolute inset-x-3 bottom-3 flex min-w-0 items-center justify-between rounded-full px-4 py-2 text-[11px] font-bold"
      >
        <span className="min-w-0 truncate">
          {moving ? t("Release to place pin") : address || t("Choose an office address")}
        </span>
        <span className="ml-3 shrink-0 opacity-70">{moving ? t("Moving map") : t("Office")}</span>
      </motion.div>
    </div>
  );
}
