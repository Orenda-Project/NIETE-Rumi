import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The class link card (ClassLinkCard.tsx) is mounted on Home exactly as the evening reminder is: one import and one
 * element right after <RemindCard /> in each Home tree (pages/Home.tsx: the switched tree and today's; the Home look,
 * home/look/LookHome.tsx: one). Comments are stripped first, so a mention in a comment does not count.
 */
describe("Home mounts the card like the evening reminder (one import, one element, after it in each tree)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|^\s*\/\/.*$/gm, "");
  it.each([["../pages/Home.tsx", 2], ["../home/look/LookHome.tsx", 1]])("%s", (file, trees) => {
    const src = read(file);
    expect(src.match(/import \{ ClassLinkCard \} from ["']\.\.\/(\.\.\/)?notices\/ClassLinkCard["'];/g)).toHaveLength(1);
    expect(src.match(/<ClassLinkCard \/>/g)).toHaveLength(trees);
    expect(src.match(/<RemindCard \/>\s*<ClassLinkCard \/>/g)).toHaveLength(trees);
  });
});
