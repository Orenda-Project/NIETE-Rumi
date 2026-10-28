/**
 * bd-sex15q.34 — what a page's first open downloads before it can draw: the app's entry chunk, the chunks of
 * the pages on the way to it, and every chunk those import statically (the browser must have them all before
 * any of them runs). Read from the build's own manifest (vite `build.manifest`), so it measures what ships.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

type ManifestChunk = { file: string; isEntry?: boolean; imports?: string[]; dynamicImports?: string[]; css?: string[] };
export type Manifest = Record<string, ManifestChunk>;

export type InitialJs = { files: string[]; bytes: number; gzip: number };

export function readManifest(distDir: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(distDir, ".vite", "manifest.json"), "utf8"));
}

/** The JS files that must arrive before `steps` (manifest keys: the entry, then each lazy page on the way) can run. */
export function initialJs(distDir: string, manifest: Manifest, steps: string[]): InitialJs {
  const keys = new Set<string>();
  const visit = (key: string) => {
    if (keys.has(key)) return;
    if (!manifest[key]) throw new Error(`not in the build manifest: ${key}`);
    keys.add(key);
    for (const dep of manifest[key].imports ?? []) visit(dep);
  };
  steps.forEach(visit);
  const files = [...keys].map((k) => manifest[k].file).sort();
  let bytes = 0;
  let gzip = 0;
  for (const f of files) {
    const code = fs.readFileSync(path.join(distDir, f));
    bytes += code.length;
    gzip += zlib.gzipSync(code, { level: 9 }).length;
  }
  return { files, bytes, gzip };
}

export const ENTRY = "index.html";
/** A coach's first open of the insight portal: the entry, the COACHIP routes, then This week (S1). */
export const COACH_S1 = [ENTRY, "src/portal/coach/insights/routes.tsx", "src/portal/coach/insights/pages/ThisWeek.tsx"];
