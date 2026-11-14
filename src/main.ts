import "./style.css";
import { groupByClock, groupByPosition } from "./board";
import { PLACE_RADIUS_KM, PLACES, REFRESH_MS, STOPS, type Group } from "./config";
import { fetchDepartures, type Departure } from "./entur";
import { render } from "./view";

/** Data older than this is not shown (e.g. when the app wakes up after hours). */
const MAX_DATA_AGE_MS = 10 * 60_000;

const app = document.getElementById("app")!;

const state = {
  data: null as Record<string, Departure[]> | null,
  updatedAt: null as number | null,
  failing: false,
  /** Set when the position is near one of the configured places. Otherwise the clock decides. */
  posGroup: null as Group | null,
};

let inflight: AbortController | null = null;
let poll: number | undefined;

function draw() {
  const now = Date.now();
  const fresh = state.updatedAt !== null && now - state.updatedAt < MAX_DATA_AGE_MS;
  app.innerHTML = render(
    {
      data: fresh ? state.data : null,
      updatedAt: state.updatedAt,
      loading: inflight !== null,
      failing: state.failing,
      group: state.posGroup ?? groupByClock(now),
    },
    now,
  );
}

async function refresh() {
  inflight?.abort();
  const ac = new AbortController();
  inflight = ac;
  const timeout = setTimeout(() => ac.abort(), 10_000);
  try {
    state.data = await fetchDepartures(STOPS, ac.signal);
    state.updatedAt = Date.now();
    state.failing = false;
  } catch {
    // Aborted by a newer refresh or by the app being backgrounded: not an error.
    if (inflight === ac) state.failing = true;
  } finally {
    clearTimeout(timeout);
    if (inflight === ac) inflight = null;
    draw();
  }
}

function locate() {
  navigator.geolocation?.getCurrentPosition(
    (p) => {
      state.posGroup = groupByPosition(p.coords.latitude, p.coords.longitude, PLACES, PLACE_RADIUS_KM);
      draw();
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 120_000, timeout: 15_000 },
  );
}

function start() {
  void refresh();
  locate();
  draw();
  clearInterval(poll);
  poll = window.setInterval(refresh, REFRESH_MS);
}

function stop() {
  clearInterval(poll);
  poll = undefined;
  const ac = inflight;
  inflight = null;
  ac?.abort();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") start();
  else stop();
});

app.addEventListener("click", (e) => {
  if ((e.target as Element).closest("[data-action=refresh]")) void refresh();
});

// Keep the countdown ticking.
window.setInterval(draw, 5_000);

start();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}
