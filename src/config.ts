import type { AppConfig, StopConfig } from "./config-schema";
import { toStops } from "./entur";

export type { Group } from "./config-schema";

/** Injected at build time by vite.config.ts. */
declare const __BGS_CONFIG__: AppConfig;
const config = __BGS_CONFIG__;

export type Stop = StopConfig & {
  /** Identifies the board. */
  key: string;
  /** GraphQL alias. Stops that need the same departures (same stop place and filters) share one. */
  query: string;
  /** How many departures to request from Entur (both directions – we filter ourselves). */
  fetch: number;
};

export const STOPS: Stop[] = toStops(config.stops);

export const PLACES = config.places;
export const PLACE_RADIUS_KM = config.radiusKm ?? 1.5;

/** Rows per board. */
export const ROWS = { metro: 4, rail: 6 } as const;

export const REFRESH_MS = 20_000;

/** A trip picked by hand holds this long, then position and clock decide again. */
export const MANUAL_TRIP_MS = 60 * 60_000;
