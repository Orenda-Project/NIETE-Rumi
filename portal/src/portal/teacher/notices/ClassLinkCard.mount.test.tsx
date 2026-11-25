import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The class link card (ClassLinkCard.tsx) is mounted on Home once per Home tree: one import and one element in each tree
 * (pages/Home.tsx: the switched tree and today's; the Home look, home/look/LookHome.tsx: one). Where in the tree is the
 * layout's business (beside the evening reminder where the layout has one), so the test counts, it does not place.
 * Comments are stripped first, so a mention in a comment does not count.
 */
describe("Home mounts the card once per tree (one import, one element in each tree)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|^\s*\/\/.*$/gm, "");
  it.each([["../pages/Home.tsx", 2], ["../home/look/LookHome.tsx", 1]])("%s", (file, trees) => {
    const src = read(file);
    expect(src.match(/import \{ ClassLinkCard \} from ["']\.\.\/(\.\.\/)?notices\/ClassLinkCard["'];/g)).toHaveLength(1);
    expect(src.match(/<ClassLinkCard \/>/g)).toHaveLength(trees);
  });
});
