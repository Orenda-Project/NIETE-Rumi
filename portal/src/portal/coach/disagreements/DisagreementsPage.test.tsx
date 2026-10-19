import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  disagreements: { list: vi.fn(), card: vi.fn(), visited: vi.fn(), clipUrl: (id: string, at: number) => `/api/portal/coach/disagreements/${id}/clip?at=${at}` },
  readDisagreementsOn: vi.fn(),
}));
import { disagreements, readDisagreementsOn } from "./api";
import DisagreementsPage from "./DisagreementsPage";

/**
 * bd-tbprit.3 — the coach's list of C/D teachers who answered "Not accurate": To do (most tags first, as the API
 * sorts them) and Done. Behind its own flag: off, the page sends her to the coach home.
 */
const D = vi.mocked(disagreements);
const on = vi.mocked(readDisagreementsOn);
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, teacher: "Bushra Ali", school: "IMSG I-9/4", reasons: ["score"], status: "sent", done: false,
  createdAt: "2026-10-14T05:00:00Z", visitedAt: null, sessionDate: "2026-10-13T05:00:00Z", pct: 61, hasNote: false, tags: [], ...extra,
});

function renderAt(path = "/portal/coach/disagreements") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/disagreements" element={<DisagreementsPage />} />
        <Route path="/portal/coach" element={<div data-testid="coach-home" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  on.mockResolvedValue(true);
  D.list.mockResolvedValue({
    success: true,
    todo: [
      row("a", { teacher: "Uzma Riaz", tags: ["waiting48h", "second"], reasons: ["score", "wont_work"] }),
      row("b", { teacher: null, school: null, pct: null }),
    ],
    done: [row("c", { teacher: "Hina Tariq", done: true, status: "visited", visitedAt: "2026-10-16T05:00:00Z" })],
  });
});

describe("DisagreementsPage", () => {
  it("To do in the API's order, each with her reasons, tags and the AI's score; Done below", async () => {
    renderAt();
    const todo = await screen.findByTestId("disagreements-todo");
    const rows = within(todo).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Uzma Riaz");
    expect(rows[0]).toHaveTextContent("Waiting 2+ days");
    expect(rows[0]).toHaveTextContent("Disagreed before");
    expect(rows[0]).toHaveTextContent("Score doesn't seem right");
    expect(rows[0]).toHaveTextContent("Won't work in class");
    expect(rows[0]).toHaveTextContent("AI score 61%");
    expect(rows[0]).toHaveAttribute("href", "/portal/coach/disagreements/a");
    expect(within(screen.getByTestId("disagreements-done")).getByRole("link")).toHaveTextContent("Hina Tariq");
  });

  it("data that did not load reads —, never a guess", async () => {
    renderAt();
    const todo = await screen.findByTestId("disagreements-todo");
    const second = within(todo).getAllByRole("link")[1];
    expect(second).toHaveTextContent("—");
    expect(second).not.toHaveTextContent("AI score");
  });

  it("nothing to do says so", async () => {
    D.list.mockResolvedValue({ success: true, todo: [], done: [] });
    renderAt();
    expect(await screen.findByText("No one is waiting")).toBeInTheDocument();
  });

  it("flag off: to the coach home, and the list is never read", async () => {
    on.mockResolvedValue(false);
    renderAt();
    expect(await screen.findByTestId("coach-home")).toBeInTheDocument();
    expect(D.list).not.toHaveBeenCalled();
  });

  it("never says HITL", async () => {
    renderAt();
    await screen.findByTestId("disagreements-todo");
    expect(document.body.textContent).not.toMatch(/HITL/);
  });
});
