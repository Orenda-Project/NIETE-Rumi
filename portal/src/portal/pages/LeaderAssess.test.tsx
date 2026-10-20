import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The coach's Learning assessment page (/portal/leader/assess): flag gate, the
// school picker, the server's list (no roll number), absent → the promoted
// alternate, present → handover → the engine slot → give back → done, the
// visit bar, the summary, and the saved list when offline. The network is mocked.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn() },
}));

import { portal, childTestSa } from "../services/api";
import LeaderAssess from "./LeaderAssess";

const api = childTestSa as any;
const FIRST = ["Ayan", "Bilal", "Dua", "Esha", "Fiza", "Faraz", "Hira", "Iqra"];
const child = (n: number, extra: any = {}) => ({
  drawId: `d${n}`, name: `${FIRST[n - 1]} Testwala`, nameUr: n === 1 ? "ایان ٹیسٹ والا" : null, firstName: FIRST[n - 1], firstNameUr: n === 1 ? "ایان" : null,
  grade: 3, section: n % 2 ? "A" : "B", classLabel: n % 2 ? "Grade 3 - A" : "Grade 3 - B", classLabelUr: n % 2 ? "جماعت سوم - A" : "جماعت سوم - B",
  teacherName: "Saima Testwala", status: "listed", childNo: n, role: "new", namesake: false, rollNumber: "917", ...extra,
});
const LIST = {
  visit: { visitId: "v2", visitKey: null }, cycleId: "C1", grade: 3, gradeFallback: false, reused: false,
  children: [1, 2, 3, 4, 5].map((n) => child(n)), alternates: [child(6), child(7)],
};
const SCHOOLS = [
  { schoolId: "s1", name: "School Alpha", visitId: null, observedGrade: null, visitToday: false },
  { schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true },
];

function renderPage() {
  return render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
}

async function openList() {
  const r = renderPage();
  fireEvent.click(await screen.findByTestId("assess-school-s2"));
  await screen.findByText("Ayan Testwala");
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSchools.mockResolvedValue({ schools: SCHOOLS });
  api.getList.mockResolvedValue({ list: LIST });
});
afterEach(() => { vi.useRealTimers(); });

describe("LeaderAssess", () => {
  it("is off without the flag and calls nothing", async () => {
    (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: false } });
    renderPage();
    expect(await screen.findByText(/not on for your account/)).toBeInTheDocument();
    expect(api.getSchools).not.toHaveBeenCalled();
  });

  it("the picker lists today's visit first, marked, and one tap opens the list", async () => {
    renderPage();
    const first = await screen.findByTestId("assess-school-s2");
    const buttons = screen.getAllByTestId(/^assess-school-/);
    expect(buttons[0]).toBe(first);
    expect(first).toHaveTextContent("Today's visit");
    expect(buttons[1]).not.toHaveTextContent("Today's visit");
    fireEvent.click(first);
    await screen.findByText("Ayan Testwala");
    expect(api.getList).toHaveBeenCalledWith("s2", "v2");
  });

  it("a single school is still shown for the coach to confirm", async () => {
    api.getSchools.mockResolvedValue({ schools: [SCHOOLS[0]] });
    renderPage();
    expect(await screen.findByTestId("assess-school-s1")).toBeInTheDocument();
    expect(api.getList).not.toHaveBeenCalled();
  });

  it("rows show the name, the class label and the teacher, never a roll number; alternates have no buttons", async () => {
    const { container } = await openList();
    expect(screen.getByText("School Beta")).toBeInTheDocument();
    expect(screen.getAllByText("Grade 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Grade 3 - A · Teacher: Saima Testwala").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Grade 3 - B · Teacher: Saima Testwala").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/roll|917/i);
    expect(screen.getAllByRole("button", { name: "Present" })).toHaveLength(5);
    const alt = screen.getByTestId("assess-alternates");
    expect(alt).toHaveTextContent("If a child is absent");
    expect(alt).toHaveTextContent("Faraz Testwala");
    expect(within(alt).queryAllByRole("button")).toHaveLength(0);
  });

  it("absent sends the outcome and renders the server's list with the alternate moved up", async () => {
    const updated = { ...LIST, children: [child(2), child(3), child(4), child(5), child(6)], alternates: [child(7)] };
    api.markOutcome.mockResolvedValueOnce({ list: updated });
    await openList();
    fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Absent" }));
    const promoted = await screen.findByTestId("assess-child-d6");
    expect(within(promoted).getByRole("button", { name: "Present" })).toBeInTheDocument();
    expect(screen.queryByText("Ayan Testwala")).toBeNull();
    expect(api.markOutcome).toHaveBeenCalledWith({ schoolId: "s2", visitId: "v2", drawId: "d1", outcome: "absent" });
  });

  it("present → handover → engine slot → hold 3 s → give back → the child is done", async () => {
    api.markOutcome.mockResolvedValueOnce({ sessionId: "sess1" });
    await openList();
    fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Present" }));
    expect(await screen.findByText("Put the headphones on Ayan. Hand over the phone.")).toBeInTheDocument();
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("0/5");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const slot = await screen.findByTestId("assess-engine-slot");
    expect(slot).toHaveTextContent("The test opens here");
    const hold = within(slot).getByRole("button", { name: /Child finished/ });

    vi.useFakeTimers();
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerUp(hold);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText("Give the phone back to the coach")).toBeNull();
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(3100); });
    vi.useRealTimers();

    expect(await screen.findByText("Give the phone back to the coach")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    const row = await screen.findByTestId("assess-child-d1");
    await waitFor(() => expect(row).toHaveTextContent("Done"));
    expect(within(row).queryByRole("button", { name: "Present" })).toBeNull();
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("1/5");
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("saved on phone");
  });

  it("a session the server has completed shows Done and counts as sent", async () => {
    api.getList.mockResolvedValue({ list: { ...LIST, children: [child(1, { status: "tested", sessionId: "x", sessionStatus: "completed" }), ...LIST.children.slice(1)] } });
    await openList();
    expect(screen.getByTestId("assess-child-d1")).toHaveTextContent("Done");
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("1/5");
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("sent");
  });

  it("End visit shows the summary: done, absent, refused, time", async () => {
    const updated = { ...LIST, children: [child(2), child(3), child(4), child(5), child(6)], alternates: [child(7)] };
    api.markOutcome.mockResolvedValueOnce({ list: updated });
    await openList();
    fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Absent" }));
    await screen.findByTestId("assess-child-d6");
    fireEvent.click(screen.getByRole("button", { name: "End visit" }));
    const summary = await screen.findByTestId("assess-summary");
    expect(within(summary).getByTestId("summary-absent")).toHaveTextContent("Ayan Testwala");
    expect(within(summary).getByTestId("summary-done")).toHaveTextContent("None");
    expect(summary).toHaveTextContent("Total time 00:00");
    expect(summary).toHaveTextContent("0 not sent yet");
  });

  it("the server's list problems are plain messages", async () => {
    api.getList.mockRejectedValue({ response: { status: 409, data: { reason: "no_class_list" } } });
    renderPage();
    fireEvent.click(await screen.findByTestId("assess-school-s2"));
    expect(await screen.findByText(/no class list/i)).toBeInTheDocument();
  });

  it("offline: the last list for this visit is shown with a note", async () => {
    const first = await openList();
    first.unmount();
    api.getList.mockRejectedValue(new Error("Network Error"));
    renderPage();
    fireEvent.click(await screen.findByTestId("assess-school-s2"));
    expect(await screen.findByText("Ayan Testwala")).toBeInTheDocument();
    expect(screen.getByText(/offline — showing saved list/i)).toBeInTheDocument();
  });

  it("Urdu: right-to-left, the Urdu name when there is one", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    const { container } = renderPage();
    fireEvent.click(await screen.findByTestId("assess-school-s2"));
    expect(await screen.findByText("ایان ٹیسٹ والا")).toBeInTheDocument();
    expect(screen.getByText("Bilal Testwala")).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
