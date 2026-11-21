#!/usr/bin/env node

/**
 * Deploy the web static export to Cloudflare Pages: a fixed *.pages.dev address for the UI.
 * The page still signs in and finds hosts through NEXT_PUBLIC_WORKER_URL (9remote.cc by default).
 * Usage: node scripts/deployPages.mjs [--skip-build]   (PAGES_PROJECT overrides the project name)
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildWebStatic } from "./buildWebStatic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "web", "out");
const PAGES_DIR = path.join(ROOT, "web", ".pagesBuild");
const PROJECT = process.env.PAGES_PROJECT || "hai-9remote";
const PRODUCTION_BRANCH = "main";

// Mirrors the host's static fallback (host/index.js): prerendered file, then the closest
// RSC payload or SPA shell. RSC answers must be text/x-component, or Next hard-reloads.
const WORKER_SRC = `const RSC_TYPE = "text/x-component; charset=utf-8";

const asRsc = (res) => {
  const headers = new Headers(res.headers);
  headers.set("content-type", RSC_TYPE);
  return new Response(res.body, { status: res.status, headers });
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/" || p === "/ui") return Response.redirect(new URL("/workspace", url), 302);

    const isRsc = req.headers.get("rsc") === "1" || p.endsWith(".txt");
    const asset = (to) => env.ASSETS.fetch(new Request(new URL(to, url), req));
    const res = await env.ASSETS.fetch(req);
    if (res.status !== 404) return isRsc && p.endsWith(".txt") ? asRsc(res) : res;

    if (isRsc && p.startsWith("/workspace/terminal/")) {
      const r = await asset("/workspace/terminal/default.txt");
      if (r.ok) return asRsc(r);
    }
    if (isRsc && p.startsWith("/workspace")) return asRsc(await asset("/workspace.txt"));
    if (p.startsWith("/workspace")) return asset("/workspace");
    if (p.startsWith("/login")) return asset("/login");
    return res;
  }
};
`;

function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function projectExists() {
  const list = execSync("npx wrangler pages project list --json", { cwd: ROOT, encoding: "utf8" });
  return JSON.parse(list).some((p) => (p["Project Name"] || p.name) === PROJECT);
}

if (!process.argv.includes("--skip-build")) buildWebStatic();
if (!fs.existsSync(OUT_DIR)) throw new Error(`Static export not found: ${OUT_DIR}`);

fs.rmSync(PAGES_DIR, { recursive: true, force: true });
fs.cpSync(OUT_DIR, PAGES_DIR, { recursive: true });
fs.writeFileSync(path.join(PAGES_DIR, "_worker.js"), WORKER_SRC);

if (!projectExists()) run(`npx wrangler pages project create ${PROJECT} --production-branch ${PRODUCTION_BRANCH} --force`);
run(`npx wrangler pages deploy ${PAGES_DIR} --project-name ${PROJECT} --branch ${PRODUCTION_BRANCH} --commit-dirty=true`);
console.log(`\n✅ https://${PROJECT}.pages.dev/workspace`);
