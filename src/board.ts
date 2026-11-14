import type { Group } from "./config";
import type { Departure } from "./entur";

const TZ = "Europe/Oslo";
const timeFormat = new Intl.DateTimeFormat("nb-NO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const secondsFormat = new Intl.DateTimeFormat("nb-NO", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function join(fmt: Intl.DateTimeFormat, ms: number): string {
  return fmt
    .formatToParts(ms)
    .filter((p) => p.type === "hour" || p.type === "minute" || p.type === "second")
    .map((p) => p.value)
    .join(":");
}

export const clock = (ms: number) => join(timeFormat, ms);
export const clockWithSeconds = (ms: number) => join(secondsFormat, ms);

/** The next `count` departures that haven't left. Cancelled ones are shown but don't count. */
export function upcoming(deps: Departure[], now: number, count: number): Departure[] {
  const out: Departure[] = [];
  let shown = 0;
  for (const d of deps) {
    if (d.expected < now) continue;
    out.push(d);
    if (!d.cancelled && ++shown >= count) break;
  }
  return out;
}

export function countdown(expected: number, now: number): string {
  const min = Math.floor((expected - now) / 60_000);
  return min < 1 ? "nå" : `${min} min`;
}

/**
 * Delay in displayed clock minutes (0 if on time or early), so we never show
 * "11:07 ~~11:07~~" when a train is only seconds late. Norwegian time is whole hours from UTC.
 */
export function delayMinutes(d: Departure): number {
  return Math.max(0, Math.floor(d.expected / 60_000) - Math.floor(d.aimed / 60_000));
}

export function groupByClock(ms: number): Group {
  const hour = Number(
    new Intl.DateTimeFormat("nb-NO", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(ms),
  );
  return hour < 12 ? "home" : "work";
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** The nearest place within the radius, otherwise null (then the clock decides). */
export function groupByPosition(
  lat: number,
  lon: number,
  places: { group: Group; lat: number; lon: number }[],
  radiusKm: number,
): Group | null {
  let best: { group: Group; km: number } | null = null;
  for (const a of places) {
    const km = distanceKm(lat, lon, a.lat, a.lon);
    if (km <= radiusKm && (!best || km < best.km)) best = { group: a.group, km };
  }
  return best?.group ?? null;
}
