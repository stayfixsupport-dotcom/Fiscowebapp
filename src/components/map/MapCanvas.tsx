import { useEffect, useRef, useState } from "react";
import { Map as MLMap, Marker, LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLat } from "@/lib/geo";
import { fmtKm } from "@/lib/geo";
import { OSM_RASTER_STYLE } from "@/lib/free-map";
import { translateUi } from "@/lib/i18n";
import { useUIPreferences } from "@/lib/ui-prefs";

export type MapItem = {
  id: string;
  firm: string;
  photo: string;
  initials: string;
  lng: number;
  lat: number;
  km: number | null;
  availableNow: boolean;
};

type Props = {
  user: LngLat;
  userLocated: boolean;
  userPrecise: boolean;
  locateRequest?: number;
  items: MapItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  padBottom?: number;
  padLeft?: number;
  className?: string;
};

/** Anchor-style pin: glass plate + stem + ground point. */
function pinEl(item: MapItem, nearest: boolean, language: string) {
  const distanceLabel =
    item.km === null
      ? translateUi("In your country", language)
      : `${fmtKm(item.km)}${nearest ? ` · ${translateUi("Nearest", language)}` : ""}`;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pin";
  el.setAttribute("aria-label", item.firm);
  el.innerHTML = `
    <span class="pin__halo"></span>
    <span class="pin__plate">
      <span class="pin__avatar">
        <img src="${item.photo}" alt="" />
        ${item.availableNow ? '<i class="pin__dot"></i>' : ""}
      </span>
      <span class="pin__meta">
        <b>${item.firm}</b>
        <em>${distanceLabel}</em>
      </span>
    </span>
    <span class="pin__stem"></span>
    <span class="pin__tip"></span>`;
  return el;
}

export default function MapCanvas({
  user,
  userLocated,
  userPrecise,
  locateRequest = 0,
  items,
  selectedId,
  onSelect,
  padBottom = 0,
  padLeft = 0,
  className,
}: Props) {
  const { preferences } = useUIPreferences();
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [mapInstance, setMapInstance] = useState<MLMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const markers = useRef<Record<string, Marker>>({});
  const userMarker = useRef<Marker | null>(null);
  const centeredOnUser = useRef(false);
  const selectedIdRef = useRef(selectedId);
  const userLocationRef = useRef(user);
  const routePaddingRef = useRef({ padBottom, padLeft });
  selectedIdRef.current = selectedId;
  userLocationRef.current = user;
  routePaddingRef.current = { padBottom, padLeft };
  const overlayGesture = useRef<{
    pointerId: number;
    target: Element;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressOverlayClick = useRef<Element | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = new MLMap({
      container: holder.current,
      style: OSM_RASTER_STYLE,
      center: userLocated ? [user.lng, user.lat] : [0, 20],
      zoom: userLocated ? (userPrecise ? 13.5 : 9.5) : 2.5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.on("click", () => onSelectRef.current(null));
    map.current = m;
    setMapInstance(m);

    m.on("style.load", () => {
      if (!m.getSource("route")) {
        m.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [] },
          },
        });
      }
      if (!m.getLayer("route-casing")) {
        m.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-width": 9,
            "line-opacity": 0.9,
            "line-blur": 0.4,
          },
        });
      }
      if (!m.getLayer("route-line")) {
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#c4622d", "line-width": 4 },
        });
      }
      setMapError(null);
    });
    m.on("error", (event) => {
      if (/abort/i.test(event.error?.message ?? "")) return;
      setMapError("OpenStreetMap tiles could not load. Check your connection and try again.");
    });

    const resizeObserver = new ResizeObserver(() => m.resize());
    resizeObserver.observe(holder.current);
    const raf = requestAnimationFrame(() => m.resize());

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      m.remove();
      map.current = null;
      setMapInstance(null);
      markers.current = {};
      userMarker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const startOverlayPan = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest("[data-map-pan]");
      if (!control) return;
      overlayGesture.current = {
        pointerId: event.pointerId,
        target: control,
        lastX: event.clientX,
        lastY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    };

    const moveOverlayPan = (event: PointerEvent) => {
      const gesture = overlayGesture.current;
      const m = map.current;
      if (!gesture || !m || gesture.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - gesture.lastX;
      const deltaY = event.clientY - gesture.lastY;
      if (
        !gesture.moved &&
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 7
      ) {
        return;
      }
      gesture.moved = true;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      m.panBy([-deltaX, -deltaY], { duration: 0 });
      event.preventDefault();
    };

    const finishOverlayPan = (event: PointerEvent) => {
      const gesture = overlayGesture.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (gesture.moved) suppressOverlayClick.current = gesture.target;
      overlayGesture.current = null;
    };

    const suppressDraggedClick = (event: MouseEvent) => {
      const target = event.target;
      const suppressed = suppressOverlayClick.current;
      if (!(target instanceof Element) || !suppressed || !suppressed.contains(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressOverlayClick.current = null;
    };

    window.addEventListener("pointerdown", startOverlayPan, true);
    window.addEventListener("pointermove", moveOverlayPan, { capture: true, passive: false });
    window.addEventListener("pointerup", finishOverlayPan, true);
    window.addEventListener("pointercancel", finishOverlayPan, true);
    window.addEventListener("click", suppressDraggedClick, true);
    return () => {
      window.removeEventListener("pointerdown", startOverlayPan, true);
      window.removeEventListener("pointermove", moveOverlayPan, true);
      window.removeEventListener("pointerup", finishOverlayPan, true);
      window.removeEventListener("pointercancel", finishOverlayPan, true);
      window.removeEventListener("click", suppressDraggedClick, true);
    };
  }, []);

  /* user location puck */
  useEffect(() => {
    const m = mapInstance;
    if (!m) return;
    if (!userLocated) {
      userMarker.current?.remove();
      userMarker.current = null;
      return;
    }
    if (!userMarker.current) {
      const el = document.createElement("div");
      el.className = "puck";
      el.innerHTML = `
        <span class="puck__pulse" style="position: absolute; inset: -14px; border-radius: 9999px; background: rgba(59, 130, 246, 0.28); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        <span class="puck__core" style="position: relative; display: block; width: 16px; height: 16px; border-radius: 9999px; background: #2563eb; border: 3px solid #ffffff; box-shadow: 0 0 10px rgba(37, 99, 235, 0.5);"></span>
      `;
      userMarker.current = new Marker({ element: el }).setLngLat([user.lng, user.lat]).addTo(m);
    } else {
      userMarker.current.setLngLat([user.lng, user.lat]);
    }
    userMarker.current.getElement().classList.toggle("puck--approximate", !userPrecise);
    if (centeredOnUser.current && selectedIdRef.current) return;
    centeredOnUser.current = true;
    m.flyTo({ center: [user.lng, user.lat], zoom: userPrecise ? 14 : 9.5, duration: 650 });
  }, [mapInstance, user.lng, user.lat, userLocated, userPrecise]);

  useEffect(() => {
    const m = mapInstance;
    if (!m || !userLocated || locateRequest === 0) return;
    m.flyTo({ center: [user.lng, user.lat], zoom: userPrecise ? 14 : 9.5, duration: 350 });
  }, [mapInstance, locateRequest, user.lng, user.lat, userLocated, userPrecise]);

  /* accountant pins, diffed against current items */
  useEffect(() => {
    const m = mapInstance;
    if (!m) return;
    const ids = new Set(items.map((i) => i.id));

    Object.entries(markers.current).forEach(([id, mk]) => {
      if (!ids.has(id)) {
        mk.remove();
        delete markers.current[id];
      }
    });

    items.forEach((item, index) => {
      const existing = markers.current[item.id];
      if (existing) {
        existing.setLngLat([item.lng, item.lat]);
        existing.getElement().classList.toggle("is-nearest", index === 0 && userPrecise);
        return;
      }
      const el = pinEl(item, index === 0 && userPrecise, preferences.language);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(item.id);
      });
      if (index === 0 && userPrecise) el.classList.add("is-nearest");
      const mk = new Marker({ element: el, anchor: "bottom", offset: [0, -18] })
        .setLngLat([item.lng, item.lat])
        .addTo(m);
      markers.current[item.id] = mk;
      window.setTimeout(() => el.classList.add("is-in"), 40 + index * 70);
    });
  }, [mapInstance, items, userPrecise, preferences.language]);

  const selectedItem = items.find((item) => item.id === selectedId);
  const selectedLng = selectedItem?.lng;
  const selectedLat = selectedItem?.lat;

  useEffect(() => {
    Object.entries(markers.current).forEach(([id, marker]) =>
      marker.getElement().classList.toggle("is-active", id === selectedId),
    );
  }, [mapInstance, items, selectedId]);

  useEffect(() => {
    const hasSelectedCoordinates = selectedLng !== undefined && selectedLat !== undefined;
    if (!mapInstance) return;
    const routeSource = () =>
      mapInstance.getSource("route") as { setData: (data: unknown) => void } | undefined;
    const setRoute = (coordinates: [number, number][]) => {
      routeSource()?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      });
    };

    if (!selectedId || !hasSelectedCoordinates) {
      setRoute([]);
      return;
    }

    let cancelled = false;
    let animationFrame = 0;
    let styleLoadHandler: (() => void) | undefined;
    const controller = new AbortController();
    const origin = userLocationRef.current;
    const { padBottom: routePadBottom, padLeft: routePadLeft } = routePaddingRef.current;
    setRoute([]);

    const drawRoute = (coordinates: [number, number][]) => {
      const bounds = coordinates.reduce(
        (current, coordinate) => current.extend(coordinate),
        new LngLatBounds(coordinates[0]!, coordinates[0]!),
      );
      const box = mapInstance.getContainer().getBoundingClientRect();
      const side = Math.max(24, Math.min(64, box.width * 0.12));
      const top = Math.min(150, Math.max(24, box.height * 0.2));
      const left = Math.min(
        routePadLeft + side,
        box.width * 0.55,
        Math.max(24, box.width - side - 24),
      );
      const bottom = Math.min(
        routePadBottom + 24,
        Math.max(40, box.height * 0.55),
        Math.max(24, box.height - top - 24),
      );
      mapInstance.stop();
      mapInstance.fitBounds(bounds, {
        padding: { top, bottom, left, right: side },
        maxZoom: 15.2,
        duration: 900,
        essential: true,
      });

      const startedAt = performance.now();
      const duration = 1100;
      const step = (now: number) => {
        if (cancelled) return;
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const count = Math.max(2, Math.round(coordinates.length * eased));
        setRoute(coordinates.slice(0, count));
        if (progress < 1) animationFrame = requestAnimationFrame(step);
      };
      animationFrame = requestAnimationFrame(step);
    };

    const drawWhenReady = (coordinates: [number, number][]) => {
      if (cancelled) return;
      if (mapInstance.isStyleLoaded() && routeSource()) {
        drawRoute(coordinates);
      } else {
        styleLoadHandler = () => drawRoute(coordinates);
        mapInstance.once("style.load", styleLoadHandler);
      }
    };

    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${selectedLng},${selectedLat}?overview=full&geometries=geojson`;
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Route request failed");
        return response.json();
      })
      .then((result) => {
        const coordinates = result?.routes?.[0]?.geometry?.coordinates as [number, number][];
        if (!coordinates?.length) throw new Error("No road route found");
        drawWhenReady(coordinates);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      controller.abort();
      if (styleLoadHandler) mapInstance.off("style.load", styleLoadHandler);
    };
  }, [mapInstance, selectedId, selectedLng, selectedLat]);

  return (
    <div
      ref={holder}
      className={className}
      style={{ position: "absolute", inset: 0, height: "100%", width: "100%" }}
    >
      {mapError && (
        <div
          role="alert"
          className="absolute inset-x-4 top-24 z-20 rounded-2xl bg-white/95 px-4 py-3 text-sm font-semibold text-destructive shadow-lg"
        >
          {translateUi(mapError, preferences.language)}
        </div>
      )}
    </div>
  );
}
