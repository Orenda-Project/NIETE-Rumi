import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../teacher/useLanguageSwitch", () => ({ useLanguageSwitch: () => ({ target: "ur", status: "idle", toggle: vi.fn() }) }));
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  disagreements: { list: vi.fn(), card: vi.fn(), visited: vi.fn(), clipUrl: (id: string, at: number) => `/api/portal/coach/disagreements/${id}/clip?at=${at}` },
  readDisagreementsOn: vi.fn(),
}));
import { disagreements, readDisagreementsOn } from "./api";
import DisagreementsPage from "./DisagreementsPage";

/**
 * bd-tbprit.7 — the coach's list as Rifat's prototype draws it: a navy bar (← back, EN | اردو), "Teachers who sent you
 * their report", To do · N / Done · N tabs, and per teacher her name, "School · EMIS n", a blue dot until the coach
 * opens the card (To do only), and three tags in plain words with numbers. Behind its own flag: off, the page sends
 * her to the coach home.
 */
const D = vi.mocked(disagreements);
const on = vi.mocked(readDisagreementsOn);
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, teacher: "Bushra Ali", school: "IMSG I-9/4", emis: "312", opened: true, reasons: ["score"], status: "sent", done: false,
  createdAt: "2026-10-14T05:00:00Z", visitedAt: null, sessionDate: "2026-10-13T05:00:00Z", pct: 61, hasNote: false, tags: [], ...extra,
});

function renderAt(path: string | { pathname: string; state: unknown } = "/portal/coach/disagreements") {
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
      row("a", {
        teacher: "Uzma Riaz", opened: false,
        tags: [{ kind: "recordingLess", before: 2, now: 0.5 }, { kind: "waiting", days: 4 }, { kind: "repeat", nth: 2 }],
      }),
      row("b", { teacher: null, school: null, emis: null, pct: null }),
    ],
    done: [row("c", { teacher: "Hina Tariq", done: true, status: "visited", opened: false, visitedAt: "2026-10-16T05:00:00Z" })],
  });
});

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("DisagreementsPage, Rifat's list", () => {
  it("the navy bar as hers: N, NIETE Teaching Assistant, Coach · ICT Islamabad, EN | اردو, no back arrow; then her title", async () => {
    renderAt();
    await screen.findByTestId("disagreements-todo");
    const bar = screen.getByTestId("disagreements-appbar");
    expect(within(bar).getByText("N")).toBeInTheDocument();
    expect(within(bar).getByText("NIETE Teaching Assistant")).toBeInTheDocument();
    expect(within(bar).getByText("Coach · ICT Islamabad")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "اردو" })).toBeInTheDocument();
    expect(screen.queryByTestId("appbar-back")).toBeNull();
    expect(screen.getByText("Teachers who sent you their report")).toBeInTheDocument();
  });

  it("To do · 2 open first, in the API's order: name, school · EMIS, her three tags, a link to the card", async () => {
    renderAt();
    const todo = await screen.findByTestId("disagreements-todo");
    expect(tab(/To do · 2/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/Done · 1/)).toHaveAttribute("aria-selected", "false");
    const rows = within(todo).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Uzma Riaz");
    expect(rows[0]).toHaveTextContent("IMSG I-9/4 · EMIS 312");
    expect(rows[0]).toHaveTextContent("📉 Recording less: 2 → 0.5 a week");
    expect(rows[0]).toHaveTextContent("⏳ Sent 4 days ago");
    expect(rows[0]).toHaveTextContent("🔁 2nd time disagreeing");
    expect(rows[0]).toHaveAttribute("href", "/portal/coach/disagreements/a");
  });

  it("the recording tag is the red one", async () => {
    renderAt();
    await screen.findByTestId("disagreements-todo");
    expect(screen.getByText("📉 Recording less: 2 → 0.5 a week")).toHaveAttribute("data-tone", "red");
    expect(screen.getByText("⏳ Sent 4 days ago")).toHaveAttribute("data-tone", "soft");
  });

  it("bd-tbprit.9 — a short recording is its own red tag, first, in minutes", async () => {
    D.list.mockResolvedValue({ success: true, todo: [row("s", { tags: [{ kind: "short", minutes: 12 }, { kind: "waiting", days: 1 }] })], done: [] });
    renderAt();
    await screen.findByTestId("disagreements-todo");
    expect(screen.getByText("🎙 Short recording: 12 min")).toHaveAttribute("data-tone", "red");
  });

  it("a blue dot only on a card she has not opened", async () => {
    renderAt();
    const todo = await screen.findByTestId("disagreements-todo");
    const [first, second] = within(todo).getAllByRole("link");
    expect(within(first).getByTestId("unread-dot")).toBeInTheDocument();
    expect(within(second).queryByTestId("unread-dot")).toBeNull();
  });

  it("data that did not load reads —, never a guess", async () => {
    renderAt();
    const todo = await screen.findByTestId("disagreements-todo");
    const second = within(todo).getAllByRole("link")[1];
    expect(second).toHaveTextContent("—");
    expect(second).not.toHaveTextContent("EMIS");
  });

  it("Done · 1: her row says ✓ Done, and never a dot", async () => {
    renderAt();
    await screen.findByTestId("disagreements-todo");
    fireEvent.click(tab(/Done · 1/));
    const done = screen.getByTestId("disagreements-done");
    const r = within(done).getByRole("link");
    expect(r).toHaveTextContent("Hina Tariq");
    expect(r).toHaveTextContent("✓ Done");
    expect(within(r).queryByTestId("unread-dot")).toBeNull();
    expect(screen.queryByTestId("disagreements-todo")).toBeNull();
  });

  it("nothing to do, nothing done: her empty lines", async () => {
    D.list.mockResolvedValue({ success: true, todo: [], done: [] });
    renderAt();
    expect(await screen.findByText("All done. No teacher is waiting.")).toBeInTheDocument();
    fireEvent.click(tab(/Done · 0/));
    expect(screen.getByText("No card marked done yet.")).toBeInTheDocument();
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

  it("bd-tbprit.12 — back from a card: on To do, '<name> moved to Done.' or '<name> is back in To do.'", async () => {
    renderAt({ pathname: "/portal/coach/disagreements", state: { moved: { who: "Bushra Ali", done: true } } });
    expect(await screen.findByTestId("moved-msg")).toHaveTextContent("Bushra Ali moved to Done.");
    expect(screen.getByTestId("disagreements-todo")).toBeInTheDocument();
  });

  it("bd-tbprit.12 — moved back: the line says so; no state, no line", async () => {
    const { unmount } = renderAt({ pathname: "/portal/coach/disagreements", state: { moved: { who: "Bushra Ali", done: false } } });
    expect(await screen.findByTestId("moved-msg")).toHaveTextContent("Bushra Ali is back in To do.");
    unmount();
    renderAt();
    await screen.findByTestId("disagreements-todo");
    expect(screen.queryByTestId("moved-msg")).toBeNull();
  });
});
