import { describe, it, expect } from "vitest";

/**
 * bd-fmf24g.13 — the registry (copyRegistry.ts) finds every feature's copy.ts and keeps the ones that export
 * COPY_ENTRY or COPY_ENTRIES; a copy.ts that exports neither is silently left out, and with it the Urdu
 * completeness checks and the review file. So: every teacher v2 copy.ts registers, and every feature (a folder
 * with routes) has one. `pages` (Home, More, Profile) reads the frame's words, teacher/copy.ts.
 */

const copies = import.meta.glob<Record<string, unknown>>("./*/copy.ts", { eager: true });
const features = Object.keys(import.meta.glob("./*/routes.tsx")).map((k) => k.split("/")[1]);
const FRAME_WORDS = ["pages"];

describe("every teacher v2 copy module registers", () => {
  it.each(Object.keys(copies).sort())("%s exports COPY_ENTRY or COPY_ENTRIES", (k) => {
    expect(copies[k].COPY_ENTRY ?? copies[k].COPY_ENTRIES).toBeTruthy();
  });

  it.each(features.filter((f) => !FRAME_WORDS.includes(f)).sort())("the %s feature has a copy.ts", (f) => {
    expect(Object.keys(copies)).toContain(`./${f}/copy.ts`);
  });
});
