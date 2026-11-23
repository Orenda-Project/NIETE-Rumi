// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Queue #183 (19 Nov 2026) — with Pakistan's international link degraded (SMW5 cable fault), the app's main script
 * took 30 s to 3 min to arrive, the tablets sat on index.html's boot outline with no sign of life, and closing the
 * app to "fix" it started the download again from zero. The outline now says so after 8 s, in both languages (it
 * cannot know hers yet), and React's first render removes it with the rest of the outline.
 */
const HTML = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

/** index.html's #root contents (the static outline) and the note's inline script, as the browser would run them. */
function boot() {
  const doc = new DOMParser().parseFromString(HTML, "text/html");
  document.body.innerHTML = "";
  const root = doc.getElementById("root");
  if (!root) throw new Error("index.html has no #root");
  document.body.appendChild(document.importNode(root, true));
  const script = doc.getElementById("slow-boot-note");
  if (!script) throw new Error("index.html has no #slow-boot-note script");
  // eslint-disable-next-line no-new-func
  new Function(script.textContent || "")();
}

const note = () => document.querySelector<HTMLElement>("[data-app-shell] [data-slow-boot]");

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the boot outline's slow-line note (#183)", () => {
  it("is part of the outline, hidden at first, in English and Urdu", () => {
    vi.useFakeTimers();
    boot();
    const n = note();
    expect(n).not.toBeNull();
    expect(n!.hasAttribute("hidden")).toBe(true);
    const en = n!.querySelector('[lang="en"]');
    const ur = n!.querySelector('[lang="ur"]');
    expect(en?.textContent?.trim()).toBeTruthy();
    expect(ur?.getAttribute("dir")).toBe("rtl");
    expect(ur?.textContent?.trim()).toBeTruthy();
    // Urdu prose takes Urdu digits; ASCII digits there are a bidi and a reading bug.
    expect(ur!.textContent).not.toMatch(/[0-9]/);
  });

  it("appears after 8 s while the app has still not drawn", () => {
    vi.useFakeTimers();
    boot();
    vi.advanceTimersByTime(7900);
    expect(note()!.hasAttribute("hidden")).toBe(true);
    vi.advanceTimersByTime(200);
    expect(note()!.hasAttribute("hidden")).toBe(false);
  });

  it("does nothing once React has replaced the outline", () => {
    vi.useFakeTimers();
    boot();
    document.getElementById("root")!.innerHTML = "<main>the app</main>";
    expect(() => vi.advanceTimersByTime(9000)).not.toThrow();
    expect(document.querySelector("[data-slow-boot]")).toBeNull();
  });

  it("is a classic inline script, so the app's hashed bundle files are untouched", () => {
    const doc = new DOMParser().parseFromString(HTML, "text/html");
    const script = doc.getElementById("slow-boot-note")!;
    expect(script.getAttribute("src")).toBeNull();
    expect(script.getAttribute("type")).toBeNull();
  });
});
