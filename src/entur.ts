import type { Stop } from "./config";
import type { StopConfig } from "./config-schema";

export type Departure = {
  id: string;
  line: string;
  /** The sign text on the front of the train. */
  destination: string;
  aimed: number;
  expected: number;
  cancelled: boolean;
  /** Expected arrival at the stop's destination (`to`). */
  arrival: number;
};

export type RawNextCall = {
  expectedArrivalTime: string;
  cancellation: boolean;
  forAlighting: boolean;
  quay: { stopPlace: { id: string; parent: { id: string } | null } | null } | null;
};

export type RawCall = {
  aimedDepartureTime: string;
  expectedDepartureTime: string;
  cancellation: boolean;
  date: string;
  destinationDisplay: { frontText: string | null } | null;
  serviceJourney: { id: string; line: { publicCode: string | null } };
  serviceJourneyEstimatedCalls: { next: RawNextCall[] } | null;
};

const ENDPOINT = "https://api.entur.io/journey-planner/v3/graphql";
const CLIENT_NAME = "personal-departure-board";

const FRAGMENT = `fragment Call on EstimatedCall {
  aimedDepartureTime expectedDepartureTime cancellation date
  destinationDisplay { frontText }
  serviceJourney { id line { publicCode } }
  serviceJourneyEstimatedCalls {
    next { expectedArrivalTime cancellation forAlighting quay { stopPlace { id parent { id } } } }
  }
}`;

/**
 * How many departures to ask for. Trains: most departures in each direction stop where we're
 * going, so 20 is plenty. Metro: lines split up after a shared stretch, and at a busy station
 * perhaps one departure in fifteen goes our way. So we ask for up to 100, but at most PER_LINE of
 * each line and destination – far enough ahead even for a line that runs every 15 minutes.
 */
const FETCH = { rail: 20, metro: 100 } as const;
export const PER_LINE = 6;

/** Gives each stop its board key and query alias. Stops that need the same departures share one query. */
export function toStops(stops: StopConfig[]): Stop[] {
  const aliases = new Map<string, string>();
  return stops.map((s, i) => {
    const same = JSON.stringify([s.stopId, s.mode, [...(s.excludeAuthorities ?? [])].sort()]);
    if (!aliases.has(same)) aliases.set(same, `q${aliases.size}`);
    return { ...s, key: `s${i}`, query: aliases.get(same)!, fetch: FETCH[s.mode] };
  });
}

/** One request for all stops, with one alias per distinct query. */
export function buildQuery(stops: Stop[]): string {
  const fields = new Map<string, string>();
  for (const s of stops) {
    if (fields.has(s.query)) continue;
    const not = s.excludeAuthorities?.length
      ? `, not: [{ authorities: ${JSON.stringify(s.excludeAuthorities)} }]`
      : "";
    const filters = `[{ select: [{ transportModes: [{ transportMode: ${s.mode} }] }]${not} }]`;
    const limit = `numberOfDepartures: ${s.fetch}, numberOfDeparturesPerLineAndDestinationDisplay: ${PER_LINE}`;
    fields.set(
      s.query,
      `  ${s.query}: stopPlace(id: "${s.stopId}") { estimatedCalls(${limit}, includeCancelledTrips: true, filters: ${filters}) { ...Call } }`,
    );
  }
  return `${FRAGMENT}\n{\n${[...fields.values()].join("\n")}\n}`;
}

/** True if the call is at the stop place itself or one of its children (metro, rail …). */
function isAt(call: RawNextCall, stopId: string): boolean {
  const sp = call.quay?.stopPlace;
  return sp?.id === stopId || sp?.parent?.id === stopId;
}

/**
 * Keeps only departures from `fromId` that later call at `toId` (= the right direction).
 * A departure that comes back to `fromId` before reaching `toId` (a metro going round the ring)
 * is left out: the same train is listed again for its next pass, and gets there just as soon.
 */
export function parseCalls(calls: RawCall[], fromId: string, toId: string): Departure[] {
  const out: Departure[] = [];
  for (const c of calls) {
    const next = c.serviceJourneyEstimatedCalls?.next ?? [];
    const dest = next.find((n) => isAt(n, toId) || isAt(n, fromId));
    if (!dest || !isAt(dest, toId)) continue;
    // Running, but skips the destination: not relevant.
    if (!c.cancellation && (dest.cancellation || !dest.forAlighting)) continue;
    out.push({
      id: `${c.serviceJourney.id}@${c.date}`,
      line: c.serviceJourney.line.publicCode ?? "",
      destination: c.destinationDisplay?.frontText ?? "",
      aimed: Date.parse(c.aimedDepartureTime),
      expected: Date.parse(c.expectedDepartureTime),
      cancelled: c.cancellation,
      arrival: Date.parse(dest.expectedArrivalTime),
    });
  }
  return out.sort((a, b) => a.expected - b.expected);
}

export async function fetchDepartures(stops: Stop[], signal: AbortSignal): Promise<Record<string, Departure[]>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ET-Client-Name": CLIENT_NAME },
    body: JSON.stringify({ query: buildQuery(stops) }),
    signal,
  });
  if (!res.ok) throw new Error(`Entur responded ${res.status}`);
  const json = (await res.json()) as {
    data?: Record<string, { estimatedCalls: RawCall[] } | null>;
    errors?: { message: string }[];
  };
  if (json.errors?.length || !json.data) throw new Error(json.errors?.[0]?.message ?? "Empty response");
  const out: Record<string, Departure[]> = {};
  for (const s of stops) out[s.key] = parseCalls(json.data[s.query]?.estimatedCalls ?? [], s.stopId, s.to.stopId);
  return out;
}
