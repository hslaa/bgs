/**
 * The shape of the stop config. The real config is never committed: it comes from the
 * BGS_CONFIG build variable or a local, git-ignored file (see vite.config.ts and README).
 */
export type Group = "home" | "work";

export type Target = { name: string; stopId: string };

export type StopConfig = {
  /** Shown as the heading. */
  name: string;
  /** Entur stop place id, e.g. "NSR:StopPlace:58404". */
  stopId: string;
  mode: "metro" | "rail";
  /** Which place the stop belongs to – decides the order on screen. */
  group: Group;
  /** Only departures that call here later are shown, with the arrival time here. */
  to: Target;
  /** Operators to leave out, e.g. ["FLT:Authority:FLT"] (Flytoget). */
  excludeAuthorities?: string[];
};

export type AppConfig = {
  stops: StopConfig[];
  /** Approximate centre of each place, used only to pick the order. Never sent anywhere. */
  places: { group: Group; lat: number; lon: number }[];
  /** How close (km) you must be to a place for it to go first. Default 1.5. */
  radiusKm?: number;
};

const STOP_ID = /^NSR:StopPlace:\d+$/;
const GROUPS = ["home", "work"];

/** Throws a readable error if the config is malformed. */
export function validateConfig(value: unknown): AppConfig {
  const fail = (msg: string): never => {
    throw new Error(`Invalid bgs config: ${msg}`);
  };
  const c = value as AppConfig;
  if (!c || typeof c !== "object") fail("expected an object");
  if (!Array.isArray(c.stops) || c.stops.length === 0) fail("stops must be a non-empty list");
  c.stops.forEach((s, i) => {
    if (!s.name) fail(`stops[${i}].name is missing`);
    if (!STOP_ID.test(s.stopId ?? "")) fail(`stops[${i}].stopId must look like NSR:StopPlace:123`);
    if (s.mode !== "metro" && s.mode !== "rail") fail(`stops[${i}].mode must be "metro" or "rail"`);
    if (!GROUPS.includes(s.group)) fail(`stops[${i}].group must be "home" or "work"`);
    if (!s.to?.name || !STOP_ID.test(s.to?.stopId ?? "")) fail(`stops[${i}].to needs name and stopId`);
  });
  if (!Array.isArray(c.places)) fail("places must be a list");
  c.places.forEach((p, i) => {
    if (!GROUPS.includes(p.group) || typeof p.lat !== "number" || typeof p.lon !== "number") {
      fail(`places[${i}] needs group, lat and lon`);
    }
  });
  return c;
}
