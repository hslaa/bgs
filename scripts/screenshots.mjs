/**
 * Renders the README screenshots: the built app inside a simple phone frame, with live data.
 *
 *   npm run screenshots
 *
 * Builds with config.example.json (never your own stops), serves `dist/` with `vite preview`,
 * opens it in the locally installed Google Chrome (via playwright-core) and writes PNGs to
 * docs/screenshots/. The position is faked so the app picks the view we want; the clock and
 * departures are whatever they are right now.
 */
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { preview } from "vite";

const example = JSON.parse(await readFile(new URL("../config.example.json", import.meta.url), "utf8"));
const view = (group, file, scheme) => {
  const place = example.places.find((p) => p.group === group);
  const first = example.stops.find((s) => s.group === group).name;
  return { file, scheme, first, geo: { latitude: place.lat, longitude: place.lon } };
};
const SHOTS = [view("home", "home-light.png", "light"), view("work", "work-dark.png", "dark")];

// Roughly an iPhone 15 in CSS points.
const SCREEN = { width: 393, height: 852 };
const STATUS_BAR = 59;
const BEZEL = 14;
const MARGIN = 32; // room for side buttons and shadow
const PHONE = { width: SCREEN.width + 2 * BEZEL, height: SCREEN.height + 2 * BEZEL };

const COLORS = {
  light: { bg: "#fafaf9", fg: "#000" },
  dark: { bg: "#0c0a09", fg: "#fff" },
};

function osloTime() {
  return new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(Date.now())
    .filter((p) => p.type === "hour" || p.type === "minute")
    .map((p) => p.value)
    .join(":");
}

function frameHtml(scheme) {
  const c = COLORS[scheme];
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: transparent; }
  .wrap { padding: ${MARGIN}px; width: ${PHONE.width}px; }
  .phone {
    position: relative; width: ${PHONE.width}px; height: ${PHONE.height}px; box-sizing: border-box;
    padding: ${BEZEL}px; border-radius: 64px; background: #0b0b0c;
    box-shadow: inset 0 0 0 3px #3a3a3c, inset 0 0 0 5px #0b0b0c, 0 18px 40px -14px rgba(0, 0, 0, .45);
  }
  .btn { position: absolute; width: 4px; background: #3a3a3c; }
  .btn.l { left: -3px; border-radius: 2px 0 0 2px; }
  .btn.r { right: -3px; border-radius: 0 2px 2px 0; }
  .screen {
    position: relative; width: ${SCREEN.width}px; height: ${SCREEN.height}px; overflow: hidden;
    border-radius: 50px; background: ${c.bg}; color: ${c.fg};
  }
  .status {
    height: ${STATUS_BAR}px; display: flex; align-items: center; justify-content: space-between;
    padding: 4px 30px 0 52px; box-sizing: border-box;
    font: 600 17px -apple-system, system-ui, sans-serif; font-variant-numeric: tabular-nums;
  }
  .island { position: absolute; top: 11px; left: 50%; transform: translateX(-50%); width: 125px; height: 37px; border-radius: 20px; background: #000; }
  .icons { display: flex; align-items: center; gap: 6px; }
  .sig { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
  .sig i { display: block; width: 3px; border-radius: 1px; background: ${c.fg}; }
  .bat { position: relative; width: 25px; height: 12px; box-sizing: border-box; padding: 1.5px; border: 1.5px solid ${c.fg}; border-radius: 4px; opacity: .9; }
  .bat span { display: block; width: 78%; height: 100%; border-radius: 1.5px; background: ${c.fg}; }
  .bat::after { content: ""; position: absolute; right: -4.5px; top: 2.5px; width: 2px; height: 4px; border-radius: 0 1px 1px 0; background: ${c.fg}; }
  iframe { display: block; width: ${SCREEN.width}px; height: ${SCREEN.height - STATUS_BAR}px; border: 0; }
  .home { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); width: 134px; height: 5px; border-radius: 3px; background: ${c.fg}; }
</style></head>
<body><div class="wrap"><div class="phone">
  <div class="btn l" style="top: 150px; height: 32px"></div>
  <div class="btn l" style="top: 210px; height: 62px"></div>
  <div class="btn l" style="top: 285px; height: 62px"></div>
  <div class="btn r" style="top: 240px; height: 100px"></div>
  <div class="screen">
    <div class="island"></div>
    <div class="status">
      <span>${osloTime()}</span>
      <span class="icons">
        <span class="sig"><i style="height: 4px"></i><i style="height: 6px"></i><i style="height: 9px"></i><i style="height: 12px"></i></span>
        <span class="bat"><span></span></span>
      </span>
    </div>
    <iframe src="/" allow="geolocation"></iframe>
    <div class="home"></div>
  </div>
</div></div></body></html>`;
}

const server = await preview({ preview: { port: 4173 } });
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ channel: "chrome" });
const out = new URL("../docs/screenshots/", import.meta.url);
await mkdir(out, { recursive: true });

try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: PHONE.width + 2 * MARGIN, height: PHONE.height + 2 * MARGIN },
      deviceScaleFactor: 2,
      colorScheme: shot.scheme,
      geolocation: shot.geo,
      permissions: ["geolocation"],
      timezoneId: "Europe/Oslo",
      locale: "nb-NO",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    // Serve the frame from the app's own origin so the iframe is same-origin.
    await page.route(`${base}/__frame`, (route) =>
      route.fulfill({ contentType: "text/html", body: frameHtml(shot.scheme) }),
    );
    await page.goto(`${base}/__frame`);
    const app = await (await page.waitForSelector("iframe")).contentFrame();
    await app.waitForSelector("li");
    await app.waitForFunction((name) => document.querySelector("section h2 span")?.textContent === name, shot.first);
    await page.waitForTimeout(300);
    const path = new URL(shot.file, out);
    await (await page.$(".wrap")).screenshot({ path: path.pathname, omitBackground: true });
    console.log("wrote", path.pathname);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
