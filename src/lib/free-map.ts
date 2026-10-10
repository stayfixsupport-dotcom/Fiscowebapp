import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(mapWorkerUrl);

export const CARTO_MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm-raster", type: "raster", source: "openstreetmap" }],
};
