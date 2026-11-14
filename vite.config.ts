import { existsSync, readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { validateConfig } from "./src/config-schema.ts";

/**
 * Stops and places come from config, never from the code. First match wins:
 *   1. BGS_CONFIG       – the JSON itself (a build variable in Cloudflare Workers Builds)
 *   2. BGS_CONFIG_FILE  – path to a JSON file
 *   3. config.local.json – your own config, ignored by git
 *   4. config.example.json
 */
function loadConfig() {
  if (process.env.BGS_CONFIG) return validateConfig(JSON.parse(process.env.BGS_CONFIG));
  if (process.env.WORKERS_CI) {
    throw new Error("The BGS_CONFIG build variable is missing – refusing to deploy the example config.");
  }
  const file =
    process.env.BGS_CONFIG_FILE ?? (existsSync("config.local.json") ? "config.local.json" : "config.example.json");
  return validateConfig(JSON.parse(readFileSync(file, "utf8")));
}

export default defineConfig({
  plugins: [tailwindcss()],
  define: { __BGS_CONFIG__: JSON.stringify(loadConfig()) },
});
