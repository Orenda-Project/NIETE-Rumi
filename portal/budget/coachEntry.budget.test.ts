/**
 * bd-sex15q.34 — a coach's first open on a phone reaches This week (S1) inside ten seconds (ORG §8).
 *
 * design-qa measured 16.9-20.9 s on a phone with an empty cache (Slow 3G, CPU x4): the portal's entry chunk was
 * 1,976,342 bytes (591,875 gzipped) and carried the teacher app, the teacher dashboard's charts and the leader
 * pages before any COACHIP code could load. This builds the portal as it ships and holds the coach's first-open
 * JavaScript to a budget. Run: `npm run test:budget` (it builds, so it is not in the default `vitest run`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { COACH_S1, ENTRY, initialJs, readManifest } from "./initialJs";

/** gzipped bytes; the ceiling the operator's ten seconds allows on Slow 3G (400 kbps) with time left for data. */
const COACH_S1_BUDGET = 250_000;

const portalDir = path.resolve(__dirname, "..");
let distDir = "";

beforeAll(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-budget-"));
  await build({
    root: portalDir,
    configFile: path.join(portalDir, "vite.config.ts"),
    mode: "production",
    logLevel: "error",
    build: { outDir: distDir, emptyOutDir: true, manifest: true },
  });
}, 600_000);

afterAll(() => {
  if (distDir) fs.rmSync(distDir, { recursive: true, force: true });
});

describe("a coach's first open", () => {
  it(`downloads at most ${COACH_S1_BUDGET} gzipped bytes of JavaScript before This week can draw`, () => {
    const m = readManifest(distDir);
    const s1 = initialJs(distDir, m, COACH_S1);
    console.log(`coach S1 initial JS: ${s1.files.length} files, ${s1.bytes} bytes, ${s1.gzip} gzipped`);
    console.log(`entry alone: ${JSON.stringify(initialJs(distDir, m, [ENTRY]))}`);
    expect(s1.gzip).toBeLessThanOrEqual(COACH_S1_BUDGET);
  });
});
