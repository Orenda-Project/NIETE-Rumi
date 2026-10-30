import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadApp, moves, net, renderApp, resetAll } from "./harness.testdata";
import { EMIS, grid, schoolCard, schoolScores } from "./fixtures.testdata";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-ewbzns.1 — a school's School card for one teaching level. The chips (All · Primary · Middle · High, only the levels
 * its teachers teach) sit under the period chips; picking one asks the server for that level's card, so the tiles and
 * the teacher list are both that level's. The level rides in the address and on every link to the school's own pages
 * and back to My schools. Her levels are on her row.
 */
const all = () => {
  const c = schoolCard();
  return {
    ...c,
    level: null,
    levels: { PRIMARY: 7, MIDDLE: 4, HIGH: 0 },
    teachers: c.teachers.map((t, i) => ({ ...t, levels: i < 7 ? ["PRIMARY"] : i < 10 ? ["MIDDLE"] : ["PRIMARY", "MIDDLE"] })),
  };
};
const primaryOnly = () => {
  const c = all();
  return { ...c, level: "PRIMARY", school: { ...c.school, teachers: 9 }, teachers: c.teachers.filter((t) => t.levels.includes("PRIMARY")),
    tiles: c.tiles.map((t) => (t.feature === "lp" ? { ...t, total: 19, makers: 6 } : t)) };
};

function on() {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
  net.answers.set("/coach/people", { success: true, schools: [], teachers: [] });
  net.answers.set(`/coach/school/${EMIS}/card`, all());
  net.answers.set(`/coach/school/${EMIS}/card?period=week&level=primary`, primaryOnly());
  net.answers.set(`/coach/school/${EMIS}/feature/lp?period=week&level=primary`, grid());
  for (const kind of ["dc", "coach"] as const) net.answers.set(`/coach/school/${EMIS}/scores/${kind}?period=week&level=primary`, schoolScores(kind));
}

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe("the School card by teaching level", () => {
  it("the chips name only the levels its teachers teach, All picked", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    const chips = await screen.findByTestId("level-chips");
    const names = within(chips).getAllByRole("radio").map((r) => r.textContent);
    expect(names).toEqual(["All", "Primary", "Middle"]);
    expect(within(chips).getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
  });

  it("Primary asks for the Primary card: its numbers and only its teachers, and the address keeps it", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("level-chips");
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Primary" })); });
    await waitFor(() => expect(net.calls).toContain(`/coach/school/${EMIS}/card?period=week&level=primary`));
    expect(moves[moves.length - 1]).toBe(`/portal/coach/school/${EMIS}?level=primary`);
    await waitFor(() => expect(screen.getByTestId("tile-lp")).toHaveTextContent("19"));
    const shown = [...within(screen.getByTestId("card-teachers")).getAllByTestId("card-teacher")];
    expect(shown.every((r) => /Primary/.test(r.textContent || ""))).toBe(true);
  });

  it("her levels are on her row", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}`);
    const rows = within(await screen.findByTestId("card-teachers")).getAllByTestId("card-teacher");
    expect(rows[0]).toHaveTextContent("Primary");
  });

  it("opened with ?level=primary: the tiles open their pages for Primary, and Back goes to My schools for Primary", async () => {
    on();
    const { container } = await renderApp(`/portal/coach/school/${EMIS}?level=primary`);
    await screen.findByTestId("card-teachers");
    expect(within(screen.getByTestId("level-chips")).getByRole("radio", { name: "Primary" })).toHaveAttribute("aria-checked", "true");
    const tile = container.querySelector(`a[href^="/portal/coach/school/${EMIS}/feature/lp"]`);
    expect(tile?.getAttribute("href")).toBe(`/portal/coach/school/${EMIS}/feature/lp?level=primary`);
    const back = container.querySelector('a[href^="/portal/coach/people"]');
    expect(back?.getAttribute("href")).toBe("/portal/coach/people?level=primary");
  });

  it("a feature page opened for Primary asks for Primary", async () => {
    on();
    await renderApp(`/portal/coach/school/${EMIS}/feature/lp?level=primary`);
    await waitFor(() => expect(net.calls).toContain(`/coach/school/${EMIS}/feature/lp?period=week&level=primary`));
  });

  it("a school whose teachers all teach one level shows no chips", async () => {
    on();
    net.answers.set(`/coach/school/${EMIS}/card`, { ...all(), levels: { PRIMARY: 12, MIDDLE: 0, HIGH: 0 } });
    await renderApp(`/portal/coach/school/${EMIS}`);
    await screen.findByTestId("card-teachers");
    expect(screen.queryByTestId("level-chips")).toBeNull();
  });
});
