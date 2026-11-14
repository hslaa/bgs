import type { AppConfig, StopConfig } from "./config-schema";

export type { Group } from "./config-schema";

/** Injected at build time by vite.config.ts. */
declare const __BGS_CONFIG__: AppConfig;
const config = __BGS_CONFIG__;

export type Stop = StopConfig & {
  /** GraphQL alias. */
  key: string;
  /** How many departures to request from Entur (both directions – we filter ourselves). */
  fetch: number;
};

export const STOPS: Stop[] = config.stops.map((s, i) => ({
  ...s,
  key: `s${i}`,
  fetch: s.mode === "rail" ? 20 : 10,
}));

export const PLACES = config.places;
export const PLACE_RADIUS_KM = config.radiusKm ?? 1.5;

/** Rows per stop: the relevant place gets more. */
export const ROWS = { primary: { metro: 4, rail: 6 }, secondary: { metro: 2, rail: 3 } } as const;

export const REFRESH_MS = 20_000;
