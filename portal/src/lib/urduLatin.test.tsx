import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("../portal/components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));

import TeacherPage from "../portal/teacher/TeacherPage";
import { HistoryRow } from "../portal/teacher/ui/HistoryRow";
import { ListRow } from "../portal/teacher/ui/ListRow";
import { Row } from "../portal/newui/List";
import { InnerBar } from "../portal/newui/InnerBar";
import { LRI, PDI } from "../portal/teacher/ui/bidi";

/**
 * bd-fmf24g.62 — the operator: "Even in Urdu mode can we make it so if there is text in english it's font remains the one
 * we use for English? And also it remains LTR like its supposed to."
 *
 * FONT. Urdu mode forced `"Noto Nastaliq Urdu"` on every element, and Google serves Nastaliq with a Latin subset, so a
 * lesson title, a subject, "WhatsApp" or a number was drawn in Nastaliq's own Latin glyphs. The Urdu face is now
 * Arabic-script only (unicode-range), first in the Urdu stack, with the English stack right behind it: every Latin
 * letter, digit and punctuation mark falls through to the font English mode uses, Urdu stays Nastaliq. jsdom cannot pick
 * glyphs, so this guards the RULES; the pixels and `document.fonts` are the render in the bead's report folder.
 *
 * DIRECTION. An English string from data (a title, a subject, a name) inside an Urdu row is its own LTR paragraph: the
 * element that draws it carries dir="ltr" (and data-latin, which keeps it on the row's side), so its words, its "&" and
 * its ellipsis stay in English order at every wrap
 * (bd-fmf24g.48: "Comparing & ordering numbers" showed as "ordering numbers … & Comparing").
 */

const portal = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(portal, p), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const css = noComments(read("src/index.css")).replace(/\s+/g, " ");

/** Every `@font-face { … }` block in index.css, as { family, src, ranges }. */
function fontFaces() {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: /font-family:\s*["']?([^"';]+)["']?\s*;/.exec(body)?.[1]?.trim() ?? "",
    src: /src:\s*([^;]+);/.exec(body)?.[1] ?? "",
    ranges: (/unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? "").split(",").map((r) => r.trim()).filter(Boolean).map((r) => {
      const [a, b] = r.replace(/^U\+/i, "").split("-");
      return [parseInt(a, 16), parseInt(b ?? a, 16)] as const;
    }),
  }));
}
const covers = (ranges: readonly (readonly [number, number])[], cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);
/** The value of a custom property declared on :root. */
const customProp = (name: string) => new RegExp(`:root\\s*\\{[^}]*${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? null;
const firstFamily = (stack: string) => stack.split(",")[0].trim().replace(/^["']|["']$/g, "");

describe("Urdu mode keeps the English font for Latin text (index.css, i18n, tailwind)", () => {
  const urduFace = fontFaces().find((f) => covers(f.ranges, 0x0627 /* ا */));

  it("the Urdu face covers Arabic script only: no Latin letter or digit can be drawn by it", () => {
    expect(urduFace, "an @font-face with an Arabic unicode-range").toBeTruthy();
    const latin = [..."AZaz09&-:()%.,"].map((c) => c.codePointAt(0) as number);
    for (const cp of [...latin, 0x41, 0x5a, 0x61, 0x7a, 0x30, 0x39]) {
      expect(covers(urduFace!.ranges, cp), `U+${cp.toString(16)} must fall through to the English font`).toBe(false);
    }
    // Urdu itself: letters, ے, ۔ and the joiners stay in the face; so does the space, whose metrics set the Urdu line box.
    for (const cp of [0x0627, 0x06d2, 0x06d4, 0x0600, 0x06ff, 0x200c, 0x200d, 0x20]) expect(covers(urduFace!.ranges, cp)).toBe(true);
    expect(urduFace!.src).toMatch(/woff2/);
  });

  it("ONE English stack, used by English mode and behind the Urdu face in Urdu mode", () => {
    const latin = customProp("--font-latin");
    const urdu = customProp("--font-urdu");
    expect(latin).toMatch(/Roboto/);
    expect(latin).not.toMatch(/Nastaliq/);
    expect(urdu).not.toBeNull();
    expect(firstFamily(urdu!)).toBe(urduFace!.family);
    // the Latin stack sits right behind the Urdu face, before any family that carries Latin glyphs of its own
    expect(urdu!.split(",")[1].trim()).toBe("var(--font-latin)");
    expect(css).toMatch(/body \{[^}]*font-family:\s*var\(--font-latin\)/);
    expect(css).toMatch(/html\[lang="ur"\] \* \{\s*font-family:\s*var\(--font-urdu\)\s*!important/);
  });

  it("nothing puts Nastaliq (with its Latin subset) first: not index.css, not the i18n inline style, not tailwind, not a component", () => {
    for (const [, stack] of css.matchAll(/font-family:\s*([^;}]+)/g)) expect(firstFamily(stack)).not.toMatch(/Noto Nastaliq Urdu/);
    const i18nSrc = noComments(read("src/i18n/config.ts"));
    expect(i18nSrc).not.toMatch(/font-family:\s*"Noto Nastaliq Urdu"/);
    expect(i18nSrc).toMatch(/var\(--font-urdu\)/);
    const tw = noComments(read("tailwind.config.ts"));
    expect(tw).toMatch(/['"]?urdu['"]?:\s*\[\s*['"]var\(--font-urdu\)['"]\s*\]/);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
          const src = noComments(readFileSync(p, "utf8"));
          if (/font-\['Noto_Nastaliq_Urdu'\]|fontFamily:\s*['"`]\s*"?Noto Nastaliq Urdu/.test(src)) offenders.push(p);
        }
      }
    };
    walk(resolve(portal, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("an English string from data reads LTR on an Urdu page (the element that draws it carries dir=ltr)", () => {
  const EN = "Comparing & ordering numbers up to 9999";
  const UR = "جمع اور تفریق کے سوالات";

  beforeEach(async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  });
  const lang = (l: "ur" | "en") => act(async () => { await i18n.changeLanguage(l); });
  /** The element whose own text is `s` (isolate controls ignored). */
  const el = (container: HTMLElement, s: string) =>
    [...container.querySelectorAll("*")].find((n) => (n.textContent || "").replace(/[⁦⁩]/g, "") === s && ![...n.children].some((c) => (c.textContent || "").replace(/[⁦⁩]/g, "") === s)) as HTMLElement;

  it("teacher kit rows (HistoryRow, ListRow): English title/extra dir=ltr, Urdu title inherits", async () => {
    await lang("ur");
    const { container } = render(
      <MemoryRouter>
        <HistoryRow subject="Math" grade={3} title={EN} extra="Chapter 4" to="/a" />
        <HistoryRow subject="Math" grade={3} title={UR} to="/b" />
        <ListRow label="Read & write 4-digit numbers" to="/c" />
      </MemoryRouter>,
    );
    expect(el(container, EN).getAttribute("dir")).toBe("ltr");
    expect(el(container, EN).hasAttribute("data-latin")).toBe(true);
    expect(el(container, EN).textContent).toBe(`${LRI}${EN}${PDI}`);
    expect(el(container, "Chapter 4").getAttribute("dir")).toBe("ltr");
    expect(el(container, "Read & write 4-digit numbers").getAttribute("dir")).toBe("ltr");
    expect(el(container, UR).hasAttribute("dir")).toBe(false);
    expect(el(container, UR).hasAttribute("data-latin")).toBe(false);
  });

  it("an English run is set as English and keeps its row's side on an Urdu page (index.css [data-latin])", () => {
    expect(css).toMatch(/html\[lang="ur"\] \[data-latin\] \{\s*font-family:\s*var\(--font-latin\)\s*!important;\s*word-spacing:\s*normal;?\s*\}/);
    const side = /html\[dir="rtl"\] \[data-latin\] \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(side).toMatch(/width:\s*fit-content/);
    expect(side).toMatch(/margin-left:\s*auto/);
    // text stays start-aligned: a right-aligned clamped line loses its ellipsis in Chromium
    expect(side).not.toMatch(/text-align/);
  });

  it("the page header (TeacherPage): an English lesson title and crumb are LTR, an Urdu title inherits", async () => {
    await lang("ur");
    const { unmount } = render(<MemoryRouter><TeacherPage title={EN} crumb="Grade 3 · Math" backTo="/x"><p>body</p></TeacherPage></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("dir")).toBe("ltr");
    expect(screen.getByTestId("page-crumb").getAttribute("dir")).toBe("ltr");
    unmount();
    render(<MemoryRouter><TeacherPage title={UR} backTo="/x"><p>body</p></TeacherPage></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).hasAttribute("dir")).toBe(false);
  });

  it("newui (Row, InnerBar): an English title is LTR", async () => {
    await lang("ur");
    const { container } = render(
      <MemoryRouter>
        <Row title={EN} to="/a" />
        <InnerBar feature="training" crumb="Grade 3 · Math" title="Fractions on a number line" />
      </MemoryRouter>,
    );
    expect(el(container, EN).getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("dir")).toBe("ltr");
  });

  it("an English page is untouched: no dir attributes added", async () => {
    await lang("en");
    const { container } = render(
      <MemoryRouter>
        <HistoryRow subject="Math" grade={3} title={EN} to="/a" />
        <Row title="Fractions" to="/b" />
        <TeacherPage title={EN} backTo="/x"><p>body</p></TeacherPage>
      </MemoryRouter>,
    );
    expect(el(container, EN).hasAttribute("dir")).toBe(false);
    expect(container.querySelector("[data-latin]")).toBeNull();
    expect(el(container, "Fractions").hasAttribute("dir")).toBe(false);
    expect(screen.getByRole("heading", { level: 1 }).hasAttribute("dir")).toBe(false);
  });
});
