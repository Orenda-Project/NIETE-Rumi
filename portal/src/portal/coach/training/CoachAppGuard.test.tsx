import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext, type SharedAuth } from "../../hooks/authContext";

vi.mock("../useCoachV2", async (orig) => ({ ...(await orig<any>()), useCoachV2: vi.fn() }));
import { useCoachV2 } from "../useCoachV2";
vi.mock("../../lib/useChildTestSa", () => ({ useChildTestSa: vi.fn(() => false) }));
import { useChildTestSa } from "../../lib/useChildTestSa";
import CoachAppGuard from "./CoachAppGuard";

/**
 * bd-s42dye.2 — a coach on the coach app v2 reaches the Training Library and her account, and nothing else: every
 * other page sends her to /portal/coach/training before it mounts. Teacher, principal and a coach with the flag off
 * are untouched.
 */
const mounted: string[] = [];
function Page({ name }: { name: string }) {
  mounted.push(name);
  return <p data-testid="page">{name}</p>;
}
function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

const PAGES = [
  "/", "/portal/dashboard", "/portal/curriculum", "/portal/leader", "/portal/leader/teachers", "/portal/leader/observations",
  "/portal/leader/observe/new", "/portal/training", "/portal/training/v2", "/portal/training/provider/X", "/portal/coaching",
  "/portal/coach", "/portal/coach/scheduling", "/portal/coach/observe", "/portal/coach/visit/:id", "/portal/coach/reports", "/portal/coach/people",
  "/portal/coach/analytics", "/portal/coach/training", "/portal/coach/training/:vendorKey", "/portal/coach/more", "/portal/coach/profile",
  "/portal/account", "/portal/login", "/portal/leader/assess", "/portal/coach/disagreements", "/portal/coach/disagreements/:id", "*",
];

function renderAt(entry: string, user: SharedAuth["user"], flag: boolean | null) {
  vi.mocked(useCoachV2).mockReturnValue(flag);
  const value: SharedAuth = { user, loading: false, request: vi.fn() };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[entry]}>
        <CoachAppGuard>
          <Where />
          <Routes>{PAGES.map((p) => <Route key={p} path={p} element={<Page name={p} />} />)}</Routes>
        </CoachAppGuard>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const coach = { firstName: "Noor", lastName: "", phoneNumber: "923000000002", role: "coach" };
const teacher = { firstName: "Ayesha", lastName: "", phoneNumber: "923000000001", role: "teacher" };
const principal = { firstName: "Sana", lastName: "", phoneNumber: "923000000003", role: "principal" };

beforeEach(() => { mounted.length = 0; vi.mocked(useChildTestSa).mockReturnValue(false); });

describe("a coach on the coach app v2", () => {
  it.each([
    "/", "/portal/dashboard", "/portal/curriculum", "/portal/leader", "/portal/leader/teachers", "/portal/leader/observations",
    "/portal/leader/observe/new", "/portal/training", "/portal/training/v2", "/portal/training/provider/X", "/portal/coaching",
    "/portal/coach", "/portal/coach/scheduling", "/portal/coach/observe", "/portal/coach/visit/7", "/portal/coach/reports",
    "/portal/coach/analytics", "/portal/nowhere",
  ])("%s goes to the Training Library, and that page never mounts", (p) => {
    renderAt(p, coach, true);
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/training");
    expect(mounted).toEqual(["/portal/coach/training"]);
  });

  it.each(["/portal/coach/training", "/portal/coach/training/ISAPS", "/portal/coach/more", "/portal/coach/profile", "/portal/account", "/portal/coach/people"])(
    "%s stays", (p) => {
      renderAt(p, coach, true);
      expect(screen.getByTestId("where")).toHaveTextContent(p);
      expect(mounted).toHaveLength(1);
    },
  );

  // bd-tbprit.6 — the /cv link and the card's list open the card; its own coach_disagreement_card gate decides the rest.
  it.each(["/portal/coach/disagreements", "/portal/coach/disagreements/4650f2b9"])("%s opens the disagreement card", (p) => {
    renderAt(p, coach, true);
    expect(screen.getByTestId("where")).toHaveTextContent(p);
    expect(mounted).toHaveLength(1);
  });

  it("while her flag is read, an old page does not mount", () => {
    renderAt("/portal/dashboard", coach, null);
    expect(mounted).toEqual([]);
  });
});

describe("everyone else sees exactly what they saw", () => {
  it.each(["/portal/dashboard", "/portal/leader", "/portal/training", "/portal/coach"])("a coach with the flag off: %s", (p) => {
    renderAt(p, coach, false);
    expect(screen.getByTestId("where")).toHaveTextContent(p);
    expect(mounted).toHaveLength(1);
  });

  it.each([["teacher", teacher], ["principal", principal]] as const)("a %s is never redirected, flag or not", (_n, u) => {
    for (const p of ["/portal/dashboard", "/portal/leader", "/portal/training", "/portal/coach"]) {
      mounted.length = 0;
      const { unmount } = renderAt(p, u, true);
      expect(screen.getByTestId("where")).toHaveTextContent(p);
      expect(mounted).toHaveLength(1);
      unmount();
    }
  });
});

describe("the Learning assessment for a coach on v2 (childTestSa)", () => {
  it("on: /portal/leader/assess opens", () => {
    vi.mocked(useChildTestSa).mockReturnValue(true);
    renderAt("/portal/leader/assess", coach, true);
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/leader/assess");
    expect(mounted).toEqual(["/portal/leader/assess"]);
  });

  it("off: it goes to the Training Library, as before", () => {
    renderAt("/portal/leader/assess", coach, true);
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/training");
    expect(mounted).toEqual(["/portal/coach/training"]);
  });

  it("while the flag is read: the frame's outline, no page", () => {
    vi.mocked(useChildTestSa).mockReturnValue(null);
    const { container } = renderAt("/portal/leader/assess", coach, true);
    expect(mounted).toEqual([]);
    expect(screen.queryByTestId("where")).toBeNull();
    expect(container.firstChild).not.toBeNull();
  });

  it.each(["/portal/leader", "/portal/leader/teachers", "/portal/leader/observations", "/portal/leader/assessment"])(
    "on: %s still goes to the Training Library", (p) => {
      vi.mocked(useChildTestSa).mockReturnValue(true);
      renderAt(p, coach, true);
      expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/training");
    },
  );

  it("the flag is only read on that path", () => {
    vi.mocked(useChildTestSa).mockClear();
    renderAt("/portal/dashboard", coach, true);
    expect(vi.mocked(useChildTestSa).mock.calls.every(([ready]) => ready === false)).toBe(true);
    vi.mocked(useChildTestSa).mockClear();
    renderAt("/portal/leader/assess", coach, true);
    expect(vi.mocked(useChildTestSa).mock.calls.some(([ready]) => ready === true)).toBe(true);
  });
});
