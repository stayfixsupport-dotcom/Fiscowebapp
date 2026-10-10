import { createFileRoute, Link, ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  LoaderCircle,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { BottomSheet, type SheetState } from "@/components/BottomSheet";
import { BlurFade } from "@/components/motion/BlurFade";
import { Avatar, Btn, Chip, IconBtn, Live, Stars } from "@/components/kit";
import { fmtKm, PRECISE_LOCATION_ACCURACY_METERS } from "@/lib/geo";
import { sfx } from "@/lib/sfx";
import { useStore } from "@/lib/app-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { MapSkeleton } from "@/components/map/MapSkeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/ui-prefs";
import { translateWeekdayLabels } from "@/lib/i18n";
import { fetchAccountantReviews, type AccountantReview } from "@/lib/accountants";

const MapCanvas = lazy(() => import("@/components/map/MapCanvas"));

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Accountants near you — Fisco" },
      {
        name: "description",
        content:
          "A real map of verified accountants around you, ranked by distance and availability.",
      },
      { property: "og:title", content: "Accountants near you — Fisco" },
      {
        property: "og:description",
        content: "Find and pick a verified accountant close to you.",
      },
    ],
  }),
  component: MapScreen,
});

/** Snap heights follow the viewport so the sheet can never swallow the screen. */
function useSnaps() {
  const [snaps, setSnaps] = useState({ collapsed: 128, half: 330, full: 520 });
  useEffect(() => {
    const compute = () => {
      const h = window.innerHeight;
      setSnaps({
        collapsed: 128,
        half: Math.round(Math.min(Math.max(h * 0.42, 260), 380)),
        full: Math.round(Math.min(h * 0.72, h - 132)),
      });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return snaps;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const FILTERS = ["Nearest", "Open now", "Top rated"] as const;
const RADII = [2, 5, 10, 25] as const;
const RATING_FILTERS = [0, 4, 4.5] as const;

function MapScreen() {
  const t = useT();
  const {
    role,
    ranked,
    position,
    located,
    locationAccuracy,
    locationError,
    country,
    choose,
    chosenId,
    chosenRelationshipStatus,
    locating,
    requestLocation,
    accountantsLoadError,
  } = useStore();
  const [selected, setSelected] = useState<string | null>(chosenId);
  const [activeReviews, setActiveReviews] = useState<AccountantReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const autoLocationRequested = useRef(false);
  const [sheet, setSheet] = useState<SheetState>("half");
  const isMobile = useIsMobile();
  const SNAPS = useSnaps();
  const [q, setQ] = useState("");
  const [locateRequest, setLocateRequest] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Nearest");
  const [minimumRating, setMinimumRating] = useState<(typeof RATING_FILTERS)[number]>(0);
  const [radius, setRadius] = useState<(typeof RADII)[number] | null>(null);
  const preciseLocation =
    located && locationAccuracy !== null && locationAccuracy <= PRECISE_LOCATION_ACCURACY_METERS;
  const hasLocation = located && Number.isFinite(position.lat) && Number.isFinite(position.lng);
  const activeFilterCount =
    Number(filter !== "Nearest") + Number(radius !== null) + Number(minimumRating > 0);
  const distanceLabel = (km: number) => `${preciseLocation ? "" : "~"}${fmtKm(km)}`;
  const selectAccountant = (id: string | null) => {
    if (id === selectedRef.current) return;
    selectedRef.current = id;
    sfx(id ? "reveal" : "swipe");
    setSelected(id);
  };

  useEffect(() => {
    if (autoLocationRequested.current) return;
    autoLocationRequested.current = true;
    requestLocation();
  }, [requestLocation]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = ranked.filter((a) => {
      const match = `${a.firm} ${a.name} ${a.specialties.join(" ")}`.toLowerCase().includes(term);
      const byFilter = filter === "Open now" ? a.availableNow : true;
      const byRadius = !hasLocation || radius === null || a.km <= radius;
      const byRating = minimumRating === 0 || (a.reviews > 0 && a.rating >= minimumRating);
      return match && byFilter && byRadius && byRating;
    });
    return filter === "Top rated" || (!hasLocation && filter === "Nearest")
      ? [...filtered].sort((first, second) => second.rating - first.rating)
      : filtered;
  }, [ranked, q, filter, radius, hasLocation, minimumRating]);

  useEffect(() => {
    if (selected && !list.some((accountant) => accountant.id === selected)) {
      setSelected(null);
    }
  }, [list, selected]);

  const active = useMemo(() => {
    return list.find((accountant) => accountant.id === selected) ?? null;
  }, [list, selected]);

  useEffect(() => {
    if (!active) {
      setActiveReviews([]);
      setReviewsLoading(false);
      return;
    }

    let cancelled = false;
    setActiveReviews([]);
    setReviewsLoading(true);
    void fetchAccountantReviews(active.id)
      .then((reviews) => {
        if (cancelled) return;
        setActiveReviews(reviews);
        setReviewsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setActiveReviews([]);
        setReviewsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active?.id]);

  const activeRelationshipStatus = chosenId === active?.id ? chosenRelationshipStatus : null;
  const commentedReviews = activeReviews.filter((review) => review.comment.trim());
  const mapList = list;

  const items = useMemo(
    () =>
      mapList.map((a) => ({
        id: a.id,
        firm: a.firm,
        photo: a.photo,
        initials: a.initials,
        lng: a.lng,
        lat: a.lat,
        km: hasLocation ? a.km : null,
        availableNow: a.availableNow,
      })),
    [mapList, hasLocation],
  );

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden">
      <ClientOnly fallback={<MapSkeleton />}>
        <Suspense fallback={<MapSkeleton />}>
          <MapCanvas
            user={position}
            userLocated={located}
            userPrecise={preciseLocation}
            locateRequest={locateRequest}
            items={items}
            selectedId={selected}
            onSelect={selectAccountant}
            padBottom={isMobile ? SNAPS[sheet] + 40 : 40}
            padLeft={isMobile ? 0 : 440}
            className="absolute inset-0"
          />
        </Suspense>
      </ClientOnly>

      {/* soft vignette so the floating chrome stays readable over the map */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background: "linear-gradient(to bottom, oklch(0.955 0.005 275 / 0.85), transparent)",
        }}
      />

      {/* floating search + controls */}
      <BlurFade className="map-native-search-controls pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-4 md:pl-[440px]">
        <div className="pointer-events-none mx-auto w-full max-w-[720px]">
          <div className="pointer-events-none flex items-center gap-2">
            <div className="glass pointer-events-auto flex h-11 flex-1 items-center gap-2 rounded-full px-4">
              <Search className="size-4 opacity-45" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("Firm, name or specialty")}
                className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-muted-foreground"
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  className="text-[11px] font-bold text-muted-foreground"
                >
                  {t("Clear")}
                </button>
              )}
            </div>
            <IconBtn
              aria-label={t("Center on my location")}
              aria-busy={locating}
              data-map-pan
              onClick={() => {
                setLocateRequest((request) => request + 1);
                requestLocation();
              }}
              className="pointer-events-auto size-11"
            >
              {locating ? (
                <LoaderCircle className="size-[17px] animate-spin" />
              ) : (
                <Crosshair className="size-[17px]" />
              )}
            </IconBtn>
          </div>

          <div className="pointer-events-none mt-2 flex items-center gap-2">
            <Popover
              onOpenChange={(open) => {
                sfx(open ? "open" : "close");
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-map-pan
                  className="press glass pointer-events-auto inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[11px] font-bold"
                  aria-label={`${t("Filters")}${activeFilterCount ? `, ${activeFilterCount} ${t("active")}` : ""}`}
                >
                  <SlidersHorizontal className="size-3.5" />
                  {t("Filters")}
                  {activeFilterCount > 0 && (
                    <span className="grid size-4 place-items-center rounded-full bg-primary text-[9px] text-primary-foreground">
                      {activeFilterCount}
                    </span>
                  )}
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={8}
                backdrop={false}
                className="pointer-events-auto z-50 w-[min(340px,calc(100vw-2rem))] rounded-2xl border border-glass-border bg-background p-3 text-foreground shadow-xl"
              >
                <div className="grid gap-3">
                  <fieldset>
                    <legend className="mb-1.5 text-[10px] font-extrabold text-muted-foreground">
                      {t("SORT BY")}
                    </legend>
                    <div className="grid grid-cols-3 gap-1.5">
                      {FILTERS.map((option) => (
                        <motion.button
                          key={option}
                          type="button"
                          aria-pressed={filter === option}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => {
                            sfx("tap");
                            setFilter(option);
                          }}
                          className={`press relative min-h-9 overflow-hidden rounded-xl px-2 text-[10px] font-bold ${filter === option ? "text-primary-foreground" : "bg-secondary/70"}`}
                        >
                          {filter === option && (
                            <motion.span
                              layoutId="map-sort-selection"
                              className="absolute inset-0 rounded-xl bg-primary"
                              transition={{ type: "spring", stiffness: 500, damping: 36 }}
                            />
                          )}
                          <span className="relative z-10">
                            {t(option === "Nearest" && !hasLocation ? "Top rated" : option)}
                          </span>
                        </motion.button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="mb-1.5 text-[10px] font-extrabold text-muted-foreground">
                      {t("MAX DISTANCE")}
                    </legend>
                    <div className="flex flex-wrap gap-1.5">
                      {[null, ...RADII].map((value) => (
                        <motion.button
                          key={value ?? "any"}
                          type="button"
                          disabled={value !== null && !hasLocation}
                          aria-pressed={radius === value}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => {
                            if (value !== null && !hasLocation) return;
                            sfx("tap");
                            setRadius(value);
                          }}
                          className={`press relative min-h-8 overflow-hidden rounded-full px-3 text-[10px] font-bold disabled:opacity-40 ${radius === value ? "text-ink-foreground" : "bg-secondary/70"}`}
                        >
                          {radius === value && (
                            <motion.span
                              layoutId="map-distance-selection"
                              className="absolute inset-0 rounded-full bg-ink"
                              transition={{ type: "spring", stiffness: 500, damping: 36 }}
                            />
                          )}
                          <span className="relative z-10">
                            {value === null ? t("Any") : `≤ ${value} km`}
                          </span>
                        </motion.button>
                      ))}
                    </div>
                    {!hasLocation && (
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        {t("Allow location access to filter by distance.")}
                      </p>
                    )}
                  </fieldset>
                  <fieldset>
                    <legend className="mb-1.5 text-[10px] font-extrabold text-muted-foreground">
                      {t("MINIMUM RATING")}
                    </legend>
                    <div className="flex flex-wrap gap-1.5">
                      {RATING_FILTERS.map((rating) => (
                        <motion.button
                          key={rating}
                          type="button"
                          aria-pressed={minimumRating === rating}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => {
                            sfx("tap");
                            setMinimumRating(rating);
                          }}
                          className={`press relative min-h-8 overflow-hidden rounded-full px-3 text-[10px] font-bold ${minimumRating === rating ? "text-ink-foreground" : "bg-secondary/70"}`}
                        >
                          {minimumRating === rating && (
                            <motion.span
                              layoutId="map-rating-selection"
                              className="absolute inset-0 rounded-full bg-ink"
                              transition={{ type: "spring", stiffness: 500, damping: 36 }}
                            />
                          )}
                          <span className="relative z-10">
                            {rating === 0 ? t("Any") : `${rating.toFixed(1)}+ ${t("stars")}`}
                          </span>
                        </motion.button>
                      ))}
                    </div>
                  </fieldset>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilter("Nearest");
                        setRadius(null);
                        setMinimumRating(0);
                        sfx("close");
                      }}
                      className="press min-h-8 rounded-xl text-[10px] font-bold text-muted-foreground hover:bg-secondary/60"
                    >
                      {t("Clear filters")}
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {activeFilterCount > 0 && (
              <span className="pointer-events-auto truncate text-[10px] font-semibold text-muted-foreground">
                {filter !== "Nearest" ? t(filter) : ""}
                {radius !== null ? `${filter !== "Nearest" ? " · " : ""}≤ ${radius} km` : ""}
                {minimumRating > 0
                  ? `${filter !== "Nearest" || radius !== null ? " · " : ""}${minimumRating.toFixed(1)}+ ${t("stars")}`
                  : ""}
              </span>
            )}
          </div>

          {locationError && (
            <div
              role="alert"
              className="glass mt-2 rounded-2xl px-3 py-2 text-[11.5px] font-semibold text-destructive"
            >
              {locationError}
            </div>
          )}
        </div>
      </BlurFade>

      {/* sheet (mobile) / side panel (desktop) */}
      {isMobile ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center">
          <div className="w-full max-w-[720px]">
            <BottomSheet
              snaps={SNAPS}
              state={sheet}
              onStateChange={(s) => {
                if (s !== sheet) sfx("whoosh");
                setSheet(s);
              }}
              onToggle={() => {
                sfx("whoosh");
                setSheet(sheet === "collapsed" ? "half" : "collapsed");
              }}
              collapsed={sheet === "collapsed"}
            >
              <AnimatePresence mode="wait" initial={false}>
                {active ? (
                  <motion.div
                    key={active.id}
                    initial={{ opacity: 0, y: 18, filter: "blur(12px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -12, filter: "blur(12px)" }}
                    transition={{ duration: 0.45, ease: EASE }}
                    className="px-4 pb-28"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar
                        src={active.photo}
                        initials={active.initials}
                        size={54}
                        ring={active.id === chosenId}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="truncate text-[18px] leading-tight font-extrabold">
                            {active.firm}
                          </h2>
                          {active.availableNow && <Live />}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                          <Stars rating={active.rating} className="text-foreground" />
                          <span className="opacity-40">·</span>
                          <span className="num">
                            {hasLocation ? distanceLabel(active.km) : t("In your country")}
                          </span>
                          <span className="opacity-40">·</span>
                          <span>{active.name}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {active.specialties.slice(0, 3).map((specialty) => (
                        <Chip key={specialty}>{t(specialty)}</Chip>
                      ))}
                    </div>

                    <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                      {t(active.bio)}
                    </p>

                    <div
                      className={`sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-4 bg-background/75 px-4 py-2 backdrop-blur-xl md:static md:mx-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none ${
                        role === "taxpayer" ? "grid grid-cols-2 gap-2" : ""
                      }`}
                    >
                      {role === "taxpayer" && (
                        <Btn
                          disabled={
                            activeRelationshipStatus === "pending" ||
                            activeRelationshipStatus === "active"
                          }
                          onClick={() => {
                            sfx("select");
                            void choose(active.id);
                          }}
                          variant={
                            activeRelationshipStatus === "active" ||
                            activeRelationshipStatus === "pending"
                              ? "ghost"
                              : "accent"
                          }
                        >
                          {activeRelationshipStatus === "active" ? (
                            <>
                              <Check className="size-4" /> {t("Your accountant")}
                            </>
                          ) : activeRelationshipStatus === "pending" ? (
                            t("Request pending")
                          ) : activeRelationshipStatus === "rejected" ? (
                            t("Request again")
                          ) : (
                            t("Choose")
                          )}
                        </Btn>
                      )}
                      <Link to="/accountants/$id" params={{ id: active.id }} className="block">
                        <Btn variant="ink" className="w-full">
                          {t("Profile")}
                        </Btn>
                      </Link>
                    </div>

                    <section
                      className="mt-3 border-t border-border/70 pt-3"
                      aria-label={t("Reviews")}
                    >
                      <h3 className="text-[13px] font-bold">{t("Reviews")}</h3>
                      {reviewsLoading ? (
                        <p className="mt-2 text-[12px] text-muted-foreground">
                          {t("Loading reviews")}
                        </p>
                      ) : commentedReviews.length === 0 ? (
                        <p className="mt-2 text-[12px] text-muted-foreground">
                          {t("No reviews yet")}
                        </p>
                      ) : (
                        <div className="mt-1 divide-y divide-border/60">
                          {commentedReviews.slice(0, 3).map((review) => (
                            <article key={review.id} className="py-2">
                              <div className="flex items-center gap-2">
                                <Avatar
                                  src={review.reviewerPhoto ?? undefined}
                                  initials={review.reviewerName.slice(0, 1).toUpperCase() || "T"}
                                  size={30}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-[11px] font-semibold">
                                      {review.reviewerName}
                                    </span>
                                    <Stars
                                      rating={review.rating}
                                      className="shrink-0 text-foreground"
                                    />
                                  </div>
                                  {review.comment.trim() && (
                                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                                      {review.comment}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(10px)" }}
                    transition={{ duration: 0.4, ease: EASE }}
                    className="px-4 pb-28"
                  >
                    <div className="flex items-baseline justify-between">
                      <h2 className="text-[17px] font-extrabold">
                        {list.length} {hasLocation ? t("nearby") : t("in your country")}
                      </h2>
                      <span className="text-[11px] font-bold tracking-wide uppercase text-muted-foreground">
                        {t(hasLocation || filter !== "Nearest" ? filter : "Top rated")}
                      </span>
                    </div>
                    <div className="mt-2 divide-y divide-border/70">
                      {list.map((a, i) => (
                        <motion.button
                          key={a.id}
                          onClick={() => {
                            selectAccountant(a.id);
                          }}
                          initial={{ opacity: 0, x: -12, filter: "blur(8px)" }}
                          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                          transition={{ delay: 0.04 * i, duration: 0.5, ease: EASE }}
                          className="flex w-full items-center gap-3 py-3 text-left"
                        >
                          <Avatar src={a.photo} initials={a.initials} size={40} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-bold">{a.firm}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                              <Stars rating={a.rating} className="text-foreground" />
                              <span className="opacity-40">·</span>
                              <span>
                                {a.holiday
                                  ? `${t("On holiday")}${a.holidayUntil ? ` ${t("until")} ${a.holidayUntil}` : ""}`
                                  : a.availableNow
                                    ? t("Open now")
                                    : a.nextSlot
                                      ? translateWeekdayLabels(a.nextSlot, t)
                                      : t("Offline")}
                              </span>
                            </div>
                          </div>
                          <span className="num text-[13px] text-muted-foreground">
                            {hasLocation ? distanceLabel(a.km) : t("Country listing")}
                          </span>
                        </motion.button>
                      ))}
                      {list.length === 0 && (
                        <div className="py-8 px-2 text-center">
                          <p className="text-[14px] font-bold text-foreground">
                            {accountantsLoadError
                              ? t("The accountant directory is not connected yet")
                              : t("No accountants listed in your country yet")}
                          </p>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {accountantsLoadError
                              ? t(
                                  "Complete the Supabase accountant-directory migration to show live practices.",
                                )
                              : t("Accountants appear here after they publish a practice profile.")}
                          </p>
                          {!accountantsLoadError && (
                            <Link
                              to="/practice-profile"
                              className="mt-4 inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground shadow-sm"
                            >
                              {t("Register your practice")}
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </BottomSheet>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-30 hidden w-[400px] p-5 md:block">
          <div className="glass pointer-events-auto no-scrollbar flex h-full flex-col overflow-y-auto rounded-[30px] pt-5">
            <AnimatePresence mode="wait" initial={false}>
              {active ? (
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0, y: 18, filter: "blur(12px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -12, filter: "blur(12px)" }}
                  transition={{ duration: 0.45, ease: EASE }}
                  className="px-4 pb-28"
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={active.photo}
                      initials={active.initials}
                      size={54}
                      ring={active.id === chosenId}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-[18px] leading-tight font-extrabold">
                          {active.firm}
                        </h2>
                        {active.availableNow && <Live />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                        <Stars rating={active.rating} className="text-foreground" />
                        <span className="opacity-40">·</span>
                        <span className="num">
                          {hasLocation ? distanceLabel(active.km) : t("In your country")}
                        </span>
                        <span className="opacity-40">·</span>
                        <span>{active.name}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {active.specialties.slice(0, 3).map((s) => (
                      <Chip key={s}>{t(s)}</Chip>
                    ))}
                  </div>

                  <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    {t(active.bio)}
                  </p>

                  <div className={role === "taxpayer" ? "mt-4 grid grid-cols-2 gap-2" : "mt-4"}>
                    {role === "taxpayer" && (
                      <Btn
                        disabled={
                          activeRelationshipStatus === "pending" ||
                          activeRelationshipStatus === "active"
                        }
                        onClick={() => {
                          sfx("select");
                          void choose(active.id);
                        }}
                        variant={
                          activeRelationshipStatus === "active" ||
                          activeRelationshipStatus === "pending"
                            ? "ghost"
                            : "accent"
                        }
                      >
                        {activeRelationshipStatus === "active" ? (
                          <>
                            <Check className="size-4" /> {t("Your accountant")}
                          </>
                        ) : activeRelationshipStatus === "pending" ? (
                          t("Request pending")
                        ) : activeRelationshipStatus === "rejected" ? (
                          t("Request again")
                        ) : (
                          t("Choose")
                        )}
                      </Btn>
                    )}
                    <Link to="/accountants/$id" params={{ id: active.id }} className="block">
                      <Btn variant="ink" className="w-full">
                        {t("Profile")}
                      </Btn>
                    </Link>
                  </div>

                  <section
                    className="mt-4 border-t border-border/70 pt-3"
                    aria-label={t("Reviews")}
                  >
                    <h3 className="text-[13px] font-bold">{t("Reviews")}</h3>
                    {reviewsLoading ? (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        {t("Loading reviews")}
                      </p>
                    ) : commentedReviews.length === 0 ? (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        {t("No reviews yet")}
                      </p>
                    ) : (
                      <div className="mt-1 divide-y divide-border/60">
                        {commentedReviews.slice(0, 3).map((review) => (
                          <article key={review.id} className="py-2">
                            <div className="flex items-center gap-2">
                              <Avatar
                                src={review.reviewerPhoto ?? undefined}
                                initials={review.reviewerName.slice(0, 1).toUpperCase() || "T"}
                                size={30}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-[11px] font-semibold">
                                    {review.reviewerName}
                                  </span>
                                  <Stars
                                    rating={review.rating}
                                    className="shrink-0 text-foreground"
                                  />
                                </div>
                                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                                  {review.comment}
                                </p>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(10px)" }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="px-4 pb-28"
                >
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-[17px] font-extrabold">
                      {list.length} {hasLocation ? t("nearby") : t("in your country")}
                    </h2>
                    <span className="text-[11px] font-bold tracking-wide uppercase text-muted-foreground">
                      {t(hasLocation || filter !== "Nearest" ? filter : "Top rated")}
                    </span>
                  </div>
                  <div className="mt-2 divide-y divide-border/70">
                    {list.map((a, i) => (
                      <motion.button
                        key={a.id}
                        onClick={() => {
                          selectAccountant(a.id);
                        }}
                        initial={{ opacity: 0, x: -12, filter: "blur(8px)" }}
                        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                        transition={{ delay: 0.04 * i, duration: 0.5, ease: EASE }}
                        className="flex w-full items-center gap-3 py-3 text-left"
                      >
                        <Avatar src={a.photo} initials={a.initials} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-bold">{a.firm}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                            <Stars rating={a.rating} className="text-foreground" />
                            <span className="opacity-40">·</span>
                            <span>
                              {a.holiday
                                ? `${t("On holiday")}${a.holidayUntil ? ` ${t("until")} ${a.holidayUntil}` : ""}`
                                : a.availableNow
                                  ? t("Open now")
                                  : a.nextSlot
                                    ? translateWeekdayLabels(a.nextSlot, t)
                                    : t("Offline")}
                            </span>
                          </div>
                        </div>
                        <span className="num text-[13px] text-muted-foreground">
                          {hasLocation ? distanceLabel(a.km) : t("Country listing")}
                        </span>
                      </motion.button>
                    ))}
                    {list.length === 0 && (
                      <div className="py-6 text-center text-[13px] text-muted-foreground">
                        {accountantsLoadError
                          ? t(
                              "Supabase accountant directory setup is required to show live listings.",
                            )
                          : t("No accountants match these filters yet.")}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
