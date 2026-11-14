import { clock, clockWithSeconds, countdown, delayMinutes, upcoming } from "./board";
import { ROWS, STOPS, type Group, type Stop } from "./config";
import type { Departure } from "./entur";

export type ViewState = {
  data: Record<string, Departure[]> | null;
  updatedAt: number | null;
  loading: boolean;
  failing: boolean;
  group: Group;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Fixed line colours. Metro: the colours from the network map (Entur only gives Ruter orange for all).
 * Rail: Vy's colours as Entur provides them (L green, R red, RE blue).
 * Dark text on the light colours, otherwise the number is hard to read.
 */
const METRO_COLORS: Record<string, string> = {
  "1": "bg-[#00a9ee] text-stone-950",
  "2": "bg-[#e74d14] text-white",
  "3": "bg-[#b800f1] text-white",
  "4": "bg-[#004296] text-white",
  "5": "bg-[#4aac30] text-stone-950",
};
const NEUTRAL = "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300";

export function lineClass(mode: Stop["mode"], code: string): string {
  if (mode === "metro") return METRO_COLORS[code] ?? NEUTRAL;
  if (code.startsWith("RE")) return "bg-[#44c8f5] text-stone-950";
  if (code.startsWith("R")) return "bg-[#df2027] text-white";
  if (code.startsWith("L")) return "bg-[#8dc63f] text-stone-950";
  return NEUTRAL;
}

function badge(d: Departure, stop: Stop, extra = ""): string {
  return `<span class="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold ${lineClass(stop.mode, d.line)}${extra}">${esc(d.line)}</span>`;
}

function row(d: Departure, stop: Stop, now: number, primary: boolean): string {
  const delay = delayMinutes(d);
  const time =
    delay > 0
      ? `<span class="text-amber-600 dark:text-amber-400">${clock(d.expected)}</span> <s class="text-xs text-stone-400 dark:text-stone-500">${clock(d.aimed)}</s>`
      : clock(d.expected);
  const left = d.cancelled
    ? `<span class="text-base text-red-600 dark:text-red-400">Innstilt</span>`
    : countdown(d.expected, now);

  // Metro: just the number, next to the time. Rail: badge and sign text on a line of their own.
  const metro = stop.mode === "metro";
  return `<li class="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-2 py-1.5${d.cancelled ? " opacity-60" : ""}">
    <span class="${primary ? "text-2xl" : "text-lg"} font-semibold">${left}</span>
    <span class="whitespace-nowrap"><span class="${d.cancelled ? "line-through" : ""}">${time}</span>${metro ? " " + badge(d, stop, " ml-1 align-[0.1em]") : ""}</span>
    <span class="text-sm whitespace-nowrap text-stone-500">${d.cancelled ? "" : `framme ${clock(d.arrival)}`}</span>
    ${
      metro
        ? ""
        : `<span class="col-span-2 col-start-2 flex min-w-0 items-center gap-1.5 text-sm text-stone-600 dark:text-stone-400">
      ${badge(d, stop)}<span class="truncate">${esc(d.destination)}</span>
    </span>`
    }
  </li>`;
}

function board(stop: Stop, deps: Departure[] | undefined, now: number, primary: boolean): string {
  const count = (primary ? ROWS.primary : ROWS.secondary)[stop.mode];
  const list = deps ? upcoming(deps, now, count) : null;
  const body =
    list === null
      ? `<p class="py-2 text-stone-500">Henter avganger …</p>`
      : list.length === 0
        ? `<p class="py-2 text-stone-500">Ingen avganger</p>`
        : `<ol>${list.map((d) => row(d, stop, now, primary)).join("")}</ol>`;

  return `<section class="${primary ? "" : "text-stone-600 dark:text-stone-400"}">
    <h2 class="flex items-baseline justify-between border-b border-stone-200 pb-1 dark:border-stone-800">
      <span class="${primary ? "text-xl" : "text-base"} font-bold">${esc(stop.name)}</span>
      <span class="text-xs text-stone-500">til ${esc(stop.to.name)}</span>
    </h2>
    ${body}
  </section>`;
}

function status(s: ViewState, now: number): string {
  let text: string;
  let warn = false;
  if (s.updatedAt === null) {
    text = s.failing ? "Får ikke kontakt med Entur – prøver igjen" : "Henter …";
    warn = s.failing;
  } else if (s.failing || now - s.updatedAt > 90_000) {
    text = s.loading ? "Oppdaterer …" : `Ikke oppdatert siden ${clock(s.updatedAt)}`;
    warn = !s.loading;
  } else {
    text = `Oppdatert ${clockWithSeconds(s.updatedAt)}`;
  }
  const dot = warn ? "bg-amber-500" : "bg-emerald-500";
  const color = warn ? "text-amber-700 dark:text-amber-400" : "text-stone-500";
  return `<button type="button" data-action="refresh" class="flex items-center gap-1.5 text-xs ${color}">
    <span class="size-1.5 rounded-full ${dot}"></span>${text}
  </button>`;
}

export function render(s: ViewState, now: number): string {
  const primary = STOPS.filter((x) => x.group === s.group);
  const secondary = STOPS.filter((x) => x.group !== s.group);
  return `<div class="mx-auto max-w-md space-y-6 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
    <header class="flex justify-end">${status(s, now)}</header>
    ${primary.map((st) => board(st, s.data?.[st.key], now, true)).join("")}
    <div class="space-y-5 pt-2">
      ${secondary.map((st) => board(st, s.data?.[st.key], now, false)).join("")}
    </div>
    <footer class="text-center text-xs text-stone-400 dark:text-stone-600">Data fra Entur, under NLOD</footer>
  </div>`;
}
