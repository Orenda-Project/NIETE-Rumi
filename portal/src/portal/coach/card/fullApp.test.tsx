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
    await screen.findByTestId("activity");
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

  it("the menu stays Home · Lesson Plans · More, and nothing links into Schedule or Observe", async () => {
    config(false);
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("activity");
    const nav = screen.getByTestId("teacher-nav");
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Lesson Plans", "More"]);
    expect(linkPaths(document.body).filter((p) => /^\/portal\/coach\/(scheduling|schedule|new-visit|observe|visit|observation)(\/|$)/.test(p))).toEqual([]);
  });
});
