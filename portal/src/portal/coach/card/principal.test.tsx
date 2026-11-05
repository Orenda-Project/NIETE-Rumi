import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadApp, moves, net, renderApp, resetAll } from "./harness.testdata";
import { EMIS, schoolCard } from "./fixtures.testdata";
import type { SchoolCardData } from "./types";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-17v39c.4.15 (queue #44) — the principal apart from the teachers. A coach shared her school's teacher list in the
 * school's WhatsApp group and the principal asked to come off it (6 Nov). The operator's pick, option A: the principal
 * is not in the teacher table (or any count; the server's job), and the school's header names them in a chip,
 * "Principal: name ›", that opens their own page. No principal recorded: a dashed "Principal: not recorded ›" chip that
 * opens the school's Edit teacher. Two principals: two chips.
 */
const CARD = `/portal/coach/school/${EMIS}`;
const HEAD = { teacherExtId: "900000000777", name: "Tariq Sample" };
const SECOND = { teacherExtId: "900000000778", name: "Amna Sample" };

const withPrincipals = (principals: SchoolCardData["school"]["principals"]): SchoolCardData => {
  const c = schoolCard();
  return { ...c, school: { ...c.school, principals } };
};

function on(card: SchoolCardData) {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
  net.answers.set("/coach/people", { success: true, schools: [], teachers: [] });
  net.answers.set(`/coach/school/${EMIS}/card`, card);
}

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe("the principal in the school's header (option A)", () => {
  it("one principal: a chip with their name beside the EMIS and last visit, never a row of the teacher table", async () => {
    on(withPrincipals([HEAD]));
    await renderApp(CARD);
    const chip = await screen.findByTestId("card-principal");
    expect(chip).toHaveTextContent("Principal: Tariq Sample");
    expect(chip).toHaveAccessibleName("Principal, Tariq Sample. Open their page");
    // it sits with the school's other header chips
    expect(chip.parentElement).toContainElement(screen.getByTestId("card-emis"));
    const table = await screen.findByTestId("teacher-table");
    expect(table).not.toHaveTextContent("Tariq Sample");
    expect(screen.queryByTestId("card-principal-none")).toBeNull();
  });

  it("the chip opens the principal's own page", async () => {
    on(withPrincipals([HEAD]));
    await renderApp(CARD);
    const chip = await screen.findByTestId("card-principal");
    expect(chip).toHaveAttribute("href", `/portal/coach/teacher/${HEAD.teacherExtId}`);
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(moves[moves.length - 1]).toBe(`/portal/coach/teacher/${HEAD.teacherExtId}`));
  });

  it("no principal recorded: a dashed 'not recorded' chip that opens the school's Edit teacher", async () => {
    on(withPrincipals([]));
    await renderApp(CARD);
    const chip = await screen.findByTestId("card-principal-none");
    expect(chip).toHaveTextContent("Principal: not recorded");
    expect(chip.className).toMatch(/border-dashed/);
    expect(chip).toHaveAttribute("href", `/portal/coach/school/${EMIS}/edit-teacher`);
    expect(chip).toHaveAccessibleName("Principal not recorded. Open Edit teacher");
    expect(screen.queryByTestId("card-principal")).toBeNull();
  });

  it("two principals: two chips, each opening their own page", async () => {
    on(withPrincipals([SECOND, HEAD]));
    await renderApp(CARD);
    await screen.findByTestId("teacher-table");
    const chips = screen.getAllByTestId("card-principal");
    expect(chips.map((c) => c.textContent)).toEqual(["Principal: Amna Sample", "Principal: Tariq Sample"]);
    expect(chips.map((c) => c.getAttribute("href"))).toEqual([
      `/portal/coach/teacher/${SECOND.teacherExtId}`, `/portal/coach/teacher/${HEAD.teacherExtId}`,
    ]);
  });

  it("an older server that does not say: no chip at all (never 'not recorded' on a guess)", async () => {
    on(schoolCard());
    await renderApp(CARD);
    await screen.findByTestId("teacher-table");
    expect(screen.queryByTestId("card-principal")).toBeNull();
    expect(screen.queryByTestId("card-principal-none")).toBeNull();
  });

  it("Urdu: ہیڈ ٹیچر, and the name kept in its own direction", async () => {
    on(withPrincipals([HEAD]));
    await renderApp(CARD, "ur");
    const chip = await screen.findByTestId("card-principal");
    expect(chip).toHaveTextContent("ہیڈ ٹیچر: Tariq Sample");
    const name = within(chip).getByText("Tariq Sample");
    expect(name).toHaveAttribute("dir", "auto");
    expect(chip).toHaveAccessibleName("ہیڈ ٹیچر، Tariq Sample۔ ان کا صفحہ کھولیں");
  });

  it("Urdu: 'not recorded' is درج نہیں", async () => {
    on(withPrincipals([]));
    await renderApp(CARD, "ur");
    expect(await screen.findByTestId("card-principal-none")).toHaveTextContent("ہیڈ ٹیچر: درج نہیں");
  });
});

// bd-17v39c.4.16 (queue #47) — Manage on the School card: Remove teachers lists teachers only, so a school whose roster
// is only its principal has no Remove teachers row; Edit teacher (everyone, the principal too) stays. And the slim Home's
// "N schools · N teachers" counts teachers only, as the Teachers tab does.
describe("teachers only, around the card", () => {
  it("a school whose roster is only its principal: Edit teacher stays, Remove teachers goes", async () => {
    const c = schoolCard();
    on({ ...c, school: { ...c.school, teachers: 0, roster: 1, principals: [HEAD] }, teachers: [] });
    await renderApp(CARD);
    const manage = await screen.findByTestId("manage");
    expect(within(manage).getByRole("link", { name: /edit teacher/i })).toBeInTheDocument();
    expect(within(manage).queryByRole("link", { name: /remove teachers/i })).toBeNull();
  });

  it("a school with teachers and its principal keeps Remove teachers", async () => {
    const c = schoolCard();
    on({ ...c, school: { ...c.school, roster: c.school.teachers + 1, principals: [HEAD] } });
    await renderApp(CARD);
    const manage = await screen.findByTestId("manage");
    expect(within(manage).getByRole("link", { name: /remove teachers/i })).toBeInTheDocument();
  });

  it("the slim Home's My schools chip counts teachers only", async () => {
    on(schoolCard());
    net.answers.set("/coach/people", { success: true, schools: [{ emis: EMIS, name: "Model School Nine", teachers: 3 }],
      teachers: [{ teacherExtId: "t1", name: "T1" }, { teacherExtId: "t2", name: "T2" }, { teacherExtId: "t3", name: "T3" },
        { teacherExtId: HEAD.teacherExtId, name: HEAD.name, isPrincipal: true }] });
    await renderApp("/portal/coach");
    const tiles = await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(tiles).toHaveTextContent("1 school · 3 teachers"));
  });
});
