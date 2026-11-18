import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { linkPaths, loadApp, net, renderApp, resetAll } from "./harness.testdata";
import { EMIS, schoolCard } from "./fixtures.testdata";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-jjcofw — the per-user full coach app (`features.coachFullApp`, app_settings portal_coach_full_app) on top of the
 * School card. The real guard, flag hooks, pages and menu run; only the network is mocked. On: Schedule and Observe
 * open (scheduling, a visit, recording) and join the menu; the School card Home stays her landing page. Off: exactly
 * the School card app of today (switchOn.test.tsx), and another coach never sees them.
 */
function config(fullApp: unknown) {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: false, coachFullApp: fullApp } });
  net.answers.set("/coach/people", { success: true, schools: [{ emis: EMIS, name: "Model School Nine", teachers: 12, visits: 1, daysSinceVisit: 1, avgHitl: 60 }], teachers: [] });
  net.answers.set(`/coach/school/${EMIS}/card`, schoolCard());
}

const OPEN = ["/portal/coach/scheduling", "/portal/coach/new-visit", "/portal/coach/observe", "/portal/coach/visit/7", "/portal/coach/visit/7/record"];

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe("the switch on (Rifat)", () => {
  it.each(OPEN)("%s opens: the guard lets it through", async (entry) => {
    config(true);
    await renderApp(entry);
    // Give the guard every chance to move her: the config read lands, then the page settles.
    await waitFor(() => expect(net.calls.some((c) => c.includes("/config"))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("where")).toHaveTextContent(entry);
  });

  it("the menu is Home · Schedule · Observe · Lesson Plans · More", async () => {
    config(true);
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("overview");
    const nav = screen.getByTestId("teacher-nav");
    await waitFor(() => expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Schedule", "Observe", "Lesson Plans", "More"]));
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach", "/portal/coach/scheduling", "/portal/coach/observe", "/portal/teacher/lessons", "/portal/coach/more"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
  });

  it("the School card Home is still where a shut page sends her", async () => {
    config(true);
    await renderApp("/portal/coach/analytics");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach$/));
    await waitFor(() => expect(screen.getByTestId("coach-home-slim")).toBeInTheDocument());
  });
});

/** A Home tile's own words (the art, then the words, then any chip). */
const words = (a: Element) => a.children[1]?.textContent ?? "";

describe("the Home with the switch on (Rifat): Schedule and Observe tiles beside My schools", () => {
  // bd-39qx8x — operator, 18 Nov ~16:00: "order would be Schedule, Observe, Learning Assessment, My Schools, Coach Training
  // and Lastly Teacher Training Library". Without the Learning assessment, the other five keep that order.
  it("tiles: Schedule, Observe, My schools, Coach Training, then Training Library last — each opening its page", async () => {
    config(true);
    net.answers.set("/coach/home", { success: true, home: { today: [], next: null, counts: { week: 1, overdue: 3, waiting: 2, inProgress: 0, teachers: 24, schools: 7 } } });
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "/portal/coach/scheduling", "/portal/coach/observe", "/portal/coach/people", "/portal/coach/coach-training", "/portal/coach/training",
    ]));
    const text = tiles.textContent || "";
    expect(text).toContain("Schedule");
    expect(text).toContain("Observe");
    // their numbers, the same chips as the full coach Home, once /coach/home has answered
    await waitFor(() => expect(tiles.textContent).toContain("1 this week"));
    expect(tiles.textContent).toContain("2 waiting");
  });

  // bd-39qx8x — the operator's own Home (full coach app + Learning assessment): her six tiles in her order, her words.
  it("with portal_child_test_sa on: Schedule, Observe, Learning Assessment, My schools, Coach Training, Training Library", async () => {
    config(true);
    net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: false, coachFullApp: true, childTestSa: true } });
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "/portal/coach/scheduling", "/portal/coach/observe", "/portal/leader/assess", "/portal/coach/people",
      "/portal/coach/coach-training", "/portal/coach/training",
    ]));
    expect(Array.from(tiles.querySelectorAll("a")).map(words)).toEqual([
      "Schedule", "Observe", "Learning Assessment", "My schools", "Coach Training", "Training Library",
    ]);
  });

  // bd-39qx8x — operator: "the tiles on the coach home app screen are still huge, like the teacher app was before". The
  // teacher Home's tile since 30 Oct (home/look/FeatureTiles): the kit's FeatureTile compact, three per row.
  it("the six are the teacher Home's compact tile, three per row: 104px, 44px art, 14px words, none wide", async () => {
    config(true);
    net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: false, coachFullApp: true, childTestSa: true } });
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(tiles.querySelectorAll("a")).toHaveLength(6));
    expect(tiles.className.split(" ")).toEqual(expect.arrayContaining(["grid-cols-3", "gap-2.5"]));
    Array.from(tiles.querySelectorAll("a")).forEach((a) => {
      const cls = a.className.split(" ");
      expect(cls, a.getAttribute("href")!).toContain("min-h-[104px]");
      expect(cls).not.toContain("min-h-[176px]");
      expect(cls).not.toContain("col-span-2");
      expect(a.querySelector("svg[data-feature-art]")!.getAttribute("width")).toBe("44");
      expect(a.children[1].className.split(" ")).toContain("text-[14px]");
    });
  });

  it("no number yet (or /coach/home failed): the tiles still show, with no chip and never a 0", async () => {
    config(true);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toContain("/portal/coach/scheduling"));
    expect(tiles.textContent).not.toMatch(/\b0 (this week|waiting)\b/);
  });
});

describe("the switch off, absent or not a literal true (every other coach)", () => {
  it.each([false, undefined, "true"])("%s: scheduling, a visit and recording go to the School card Home", async (v) => {
    for (const entry of ["/portal/coach/scheduling", "/portal/coach/visit/7/record"]) {
      await resetAll();
      config(v);
      const { unmount } = await renderApp(entry);
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach$/));
      unmount();
    }
  });

  it.each([false, undefined, "true"])("%s: the Home is the three tiles (My schools, Coach Training, Training Library), and /coach/home is never asked", async (v) => {
    config(v);
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await new Promise((r) => setTimeout(r, 50));
    expect(Array.from(tiles.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "/portal/coach/people", "/portal/coach/coach-training", "/portal/coach/training",
    ]);
    expect(net.calls.some((c) => c.startsWith("/coach/home"))).toBe(false);
  });

  it("the menu stays Home · Lesson Plans · More, and nothing links into Schedule or Observe", async () => {
    config(false);
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("overview");
    const nav = screen.getByTestId("teacher-nav");
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Lesson Plans", "More"]);
    expect(linkPaths(document.body).filter((p) => /^\/portal\/coach\/(scheduling|schedule|new-visit|observe|visit|observation)(\/|$)/.test(p))).toEqual([]);
  });
});
