import type { Stop } from "./config";

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

/** One query for all stops, with an alias per stop. */
export function buildQuery(stops: Stop[]): string {
  const fields = stops.map((s) => {
    const not = s.excludeAuthorities?.length
      ? `, not: [{ authorities: ${JSON.stringify(s.excludeAuthorities)} }]`
      : "";
    const filters = `[{ select: [{ transportModes: [{ transportMode: ${s.mode} }] }]${not} }]`;
    return `  ${s.key}: stopPlace(id: "${s.stopId}") { estimatedCalls(numberOfDepartures: ${s.fetch}, includeCancelledTrips: true, filters: ${filters}) { ...Call } }`;
  });
  return `${FRAGMENT}\n{\n${fields.join("\n")}\n}`;
}

/** True if the call is at the stop place itself or one of its children (metro, rail …). */
function isAt(call: RawNextCall, stopId: string): boolean {
  const sp = call.quay?.stopPlace;
  return sp?.id === stopId || sp?.parent?.id === stopId;
}

/** Keeps only departures that later call at `toId` (= the right direction). */
export function parseCalls(calls: RawCall[], toId: string): Departure[] {
  const out: Departure[] = [];
  for (const c of calls) {
    const dest = c.serviceJourneyEstimatedCalls?.next.find((n) => isAt(n, toId));
    if (!dest) continue;
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
  for (const s of stops) out[s.key] = parseCalls(json.data[s.key]?.estimatedCalls ?? [], s.to.stopId);
  return out;
}
