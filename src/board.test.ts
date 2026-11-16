import { describe, expect, it } from "vitest";
import { clock, countdown, delayMinutes, groupByClock, groupByPosition, pickGroup, upcoming } from "./board";
import { validateConfig } from "./config-schema";
import { buildQuery, parseCalls, PER_LINE, toStops, type Departure, type RawCall, type RawNextCall } from "./entur";
import { lineClass } from "./view";

// Fictional ids and places – tests never depend on a real config.
const HERE = "NSR:StopPlace:900";
const DEST = "NSR:StopPlace:1000";
const DEST_METRO = { id: "NSR:StopPlace:1001", parent: { id: DEST } };
const OTHER = { id: "NSR:StopPlace:2000", parent: null };

function next(stopPlace: { id: string; parent: { id: string } | null }, at: string, extra: Partial<RawNextCall> = {}): RawNextCall {
  return { expectedArrivalTime: at, cancellation: false, forAlighting: true, quay: { stopPlace }, ...extra };
}

function call(dep: string, nexts: RawNextCall[], extra: Partial<RawCall> = {}): RawCall {
  return {
    aimedDepartureTime: dep,
    expectedDepartureTime: dep,
    cancellation: false,
    date: "2026-11-17",
    destinationDisplay: { frontText: "Sentrum" },
    serviceJourney: { id: `sj-${dep}`, line: { publicCode: "5" } },
    serviceJourneyEstimatedCalls: { next: nexts },
    ...extra,
  };
}

describe("parseCalls", () => {
  it("keeps only departures that later call at the destination, with the first arrival", () => {
    const deps = parseCalls(
      [
        call("2026-11-17T07:46:00+01:00", [
          next(OTHER, "2026-11-17T07:48:00+01:00"),
          next(DEST_METRO, "2026-11-17T07:57:00+01:00"),
          next(DEST_METRO, "2026-11-17T08:23:00+01:00"),
        ]),
        call("2026-11-17T07:40:00+01:00", [next(OTHER, "2026-11-17T07:42:00+01:00")]), // wrong direction
      ],
      HERE,
      DEST,
    );
    expect(deps).toHaveLength(1);
    expect(deps[0].destination).toBe("Sentrum");
    expect(clock(deps[0].expected)).toBe("07:46");
    expect(clock(deps[0].arrival)).toBe("07:57");
  });

  it("also matches the stop place itself (no parent)", () => {
    const deps = parseCalls(
      [call("2026-11-17T16:03:00+01:00", [next({ id: DEST, parent: null }, "2026-11-17T16:09:00+01:00")])],
      HERE,
      DEST,
    );
    expect(deps).toHaveLength(1);
  });

  it("drops trains that skip the destination, but keeps cancelled departures", () => {
    const deps = parseCalls(
      [
        call("2026-11-17T16:03:00+01:00", [next(DEST_METRO, "2026-11-17T16:09:00+01:00", { cancellation: true })]),
        call("2026-11-17T16:05:00+01:00", [next(DEST_METRO, "2026-11-17T16:11:00+01:00", { forAlighting: false })]),
        call("2026-11-17T16:07:00+01:00", [next(DEST_METRO, "2026-11-17T16:13:00+01:00", { cancellation: true })], {
          cancellation: true,
        }),
      ],
      HERE,
      DEST,
    );
    expect(deps.map((d) => [clock(d.expected), d.cancelled])).toEqual([["16:07", true]]);
  });

  it("sorts by expected departure", () => {
    const deps = parseCalls(
      [
        call("2026-11-17T07:50:00+01:00", [next(DEST_METRO, "2026-11-17T08:01:00+01:00")]),
        call("2026-11-17T07:46:00+01:00", [next(DEST_METRO, "2026-11-17T07:57:00+01:00")]),
      ],
      HERE,
      DEST,
    );
    expect(deps.map((d) => clock(d.expected))).toEqual(["07:46", "07:50"]);
  });

  it("works for trains too: only those that stop at the destination, with the arrival there", () => {
    const WORK = "NSR:StopPlace:3000";
    const between = { id: "NSR:StopPlace:3001", parent: null };
    const work = { id: WORK, parent: null };
    const deps = parseCalls(
      [
        call("2026-11-17T08:04:00+01:00", [next(between, "2026-11-17T08:07:00+01:00"), next(work, "2026-11-17T08:11:00+01:00")], {
          destinationDisplay: { frontText: "Vestby" },
          serviceJourney: { id: "west", line: { publicCode: "L1" } },
        }),
        call("2026-11-17T08:05:00+01:00", [next(OTHER, "2026-11-17T08:08:00+01:00")]), // other direction
        call("2026-11-17T08:06:00+01:00", [next(between, "2026-11-17T08:09:00+01:00")]), // ends before
      ],
      HERE,
      WORK,
    );
    expect(deps.map((d) => [d.line, d.destination, clock(d.expected), clock(d.arrival)])).toEqual([
      ["L1", "Vestby", "08:04", "08:11"],
    ]);
  });

  it("leaves out a metro that goes round the ring and back here before the destination", () => {
    const here = { id: "NSR:StopPlace:901", parent: { id: HERE } };
    const ring = { serviceJourney: { id: "ring", line: { publicCode: "5" } } };
    const deps = parseCalls(
      [
        // First pass: round the ring, back here 15:15, at the destination 15:40.
        call("2026-11-17T15:03:00+01:00", [next(OTHER, "2026-11-17T15:09:00+01:00"), next(here, "2026-11-17T15:15:00+01:00"), next(DEST_METRO, "2026-11-17T15:40:00+01:00")], ring),
        // Second pass of the same train: straight there.
        call("2026-11-17T15:29:00+01:00", [next(DEST_METRO, "2026-11-17T15:40:00+01:00")], ring),
      ],
      HERE,
      DEST,
    );
    expect(deps.map((d) => [clock(d.expected), clock(d.arrival)])).toEqual([["15:29", "15:40"]]);
  });
});

const t = (hhmm: string) => Date.parse(`2026-11-17T${hhmm}:00+01:00`);
const dep = (hhmm: string, extra: Partial<Departure> = {}): Departure => ({
  id: hhmm,
  line: "5",
  destination: "Sentrum",
  aimed: t(hhmm),
  expected: t(hhmm),
  cancelled: false,
  arrival: t(hhmm) + 11 * 60_000,
  ...extra,
});

describe("upcoming", () => {
  it("skips departures that have left, and cancelled ones don't count", () => {
    const list = upcoming([dep("07:30"), dep("07:46"), dep("07:52", { cancelled: true }), dep("08:01"), dep("08:16")], t("07:40"), 2);
    expect(list.map((d) => d.id)).toEqual(["07:46", "07:52", "08:01"]);
  });
});

describe("countdown and delay", () => {
  it("shows «nå» under one minute, otherwise whole minutes", () => {
    expect(countdown(t("07:46"), t("07:45") + 30_000)).toBe("nå");
    expect(countdown(t("07:46"), t("07:44") + 30_000)).toBe("1 min");
    expect(countdown(t("08:01"), t("07:40"))).toBe("21 min");
  });

  it("computes delay in minutes, never negative", () => {
    expect(delayMinutes(dep("07:46", { expected: t("07:49") }))).toBe(3);
    expect(delayMinutes(dep("07:46", { expected: t("07:45") }))).toBe(0);
    expect(delayMinutes(dep("07:46", { expected: t("07:46") + 40_000 }))).toBe(0); // same displayed minute
    expect(delayMinutes(dep("07:46", { aimed: t("07:46") + 50_000, expected: t("07:47") + 10_000 }))).toBe(1);
  });
});

describe("ordering", () => {
  // Two places 10 km apart along a meridian (0.09° latitude ≈ 10 km).
  const places = [
    { group: "home" as const, lat: 60.0, lon: 10.0 },
    { group: "work" as const, lat: 60.09, lon: 10.0 },
  ];

  it("picks the nearest place within the radius", () => {
    expect(groupByPosition(60.0, 10.0, places, 1.5)).toBe("home");
    expect(groupByPosition(60.009, 10.0, places, 1.5)).toBe("home"); // ~1 km away
    expect(groupByPosition(60.09, 10.0, places, 1.5)).toBe("work");
    expect(groupByPosition(60.045, 10.0, places, 1.5)).toBeNull(); // halfway – neither
  });

  it("falls back to the clock in Norwegian time", () => {
    expect(groupByClock(Date.parse("2026-11-17T07:30:00+01:00"))).toBe("home");
    expect(groupByClock(Date.parse("2026-11-17T11:59:00+01:00"))).toBe("home");
    expect(groupByClock(Date.parse("2026-11-17T12:00:00+01:00"))).toBe("work");
    expect(groupByClock(Date.parse("2026-06-17T11:30:00+02:00"))).toBe("home"); // summer time
  });

  it("lets a trip picked by hand win for a while, then position, then the clock", () => {
    const hour = 60 * 60_000;
    const afternoon = Date.parse("2026-11-17T16:00:00+01:00");
    expect(pickGroup(afternoon, null, null, hour)).toBe("work");
    expect(pickGroup(afternoon, "home", null, hour)).toBe("home");
    expect(pickGroup(afternoon, "work", { group: "home", at: afternoon - 59 * 60_000 }, hour)).toBe("home");
    expect(pickGroup(afternoon, "work", { group: "home", at: afternoon - hour }, hour)).toBe("work");
  });
});

describe("buildQuery", () => {
  const stops = toStops([
    { name: "A", stopId: "NSR:StopPlace:3000", mode: "metro", group: "home", to: { name: "C", stopId: DEST } },
    { name: "B", stopId: "NSR:StopPlace:4000", mode: "rail", group: "home", to: { name: "D", stopId: "NSR:StopPlace:5000" }, excludeAuthorities: ["FLT:Authority:FLT"] },
    { name: "B", stopId: "NSR:StopPlace:4000", mode: "metro", group: "work", to: { name: "E", stopId: "NSR:StopPlace:6000" } },
    { name: "B", stopId: "NSR:StopPlace:4000", mode: "metro", group: "work", to: { name: "F", stopId: "NSR:StopPlace:7000" } },
  ]);

  it("gives each board its own key, but one query per stop place, mode and filter", () => {
    expect(stops.map((s) => [s.key, s.query])).toEqual([
      ["s0", "q0"],
      ["s1", "q1"],
      ["s2", "q2"],
      ["s3", "q2"],
    ]);
    const q = buildQuery(stops);
    expect(q.match(/stopPlace\(id:/g)).toHaveLength(3);
    expect(q).toContain('q2: stopPlace(id: "NSR:StopPlace:4000")');
    expect(q).toContain('not: [{ authorities: ["FLT:Authority:FLT"] }]');
  });

  it("asks for many metro departures, but only a few of each line", () => {
    const q = buildQuery(stops);
    expect(q).toContain(`q0: stopPlace(id: "NSR:StopPlace:3000") { estimatedCalls(numberOfDepartures: 100, numberOfDeparturesPerLineAndDestinationDisplay: ${PER_LINE},`);
    expect(q).toContain(`q1: stopPlace(id: "NSR:StopPlace:4000") { estimatedCalls(numberOfDepartures: 20,`);
  });
});

describe("validateConfig", () => {
  const valid = {
    stops: [{ name: "A", stopId: "NSR:StopPlace:3000", mode: "metro", group: "home", to: { name: "Sentrum", stopId: DEST } }],
    places: [{ group: "home", lat: 60, lon: 10 }],
  };

  it("accepts a valid config", () => {
    expect(validateConfig(valid)).toBe(valid);
  });

  it("explains what is wrong", () => {
    expect(() => validateConfig({ ...valid, stops: [] })).toThrow("stops must be a non-empty list");
    expect(() => validateConfig({ ...valid, stops: [{ ...valid.stops[0], stopId: "123" }] })).toThrow("stops[0].stopId");
    expect(() => validateConfig({ ...valid, stops: [{ ...valid.stops[0], mode: "bus" }] })).toThrow("stops[0].mode");
    expect(() => validateConfig({ ...valid, stops: [{ ...valid.stops[0], to: undefined }] })).toThrow("stops[0].to");
  });
});

describe("line colours", () => {
  it("gives metro lines fixed colours and trains Vy's colours", () => {
    expect(lineClass("metro", "4")).toContain("#004296");
    expect(lineClass("metro", "5")).toContain("#4aac30");
    expect(lineClass("rail", "RE11")).toContain("#44c8f5");
    expect(lineClass("rail", "R21")).toContain("#df2027");
    expect(lineClass("rail", "L2")).toContain("#8dc63f");
    expect(lineClass("metro", "9")).toContain("bg-stone-200");
  });
});
