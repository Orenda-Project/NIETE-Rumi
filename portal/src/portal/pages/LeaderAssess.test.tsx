import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The coach's Learning assessment page (/portal/leader/assess): flag gate, the
// school picker, the server's list (no roll number), absent → the promoted
// alternate, present → handover (block, whole battery) → the engine frame →
// sa:done → back to the list, the visit bar and its sync states, the summary,
// the saved list and the outcome queue when offline. The network is mocked.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn() },
}));

import { portal, childTestSa } from "../services/api";
import LeaderAssess from "./LeaderAssess";
import { pickBlock } from "../lib/assess/blocks";

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
  api.markOutcome.mockResolvedValue({});
  api.getStatus.mockResolvedValue({ session: { id: "x", status: "started", grade: 3, form: "f" }, block: "B1", lastSeq: 0, tasksDone: [], audio: [] });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NET = () => Object.assign(new Error("Network Error"), { request: {} });
const BLOCK_EN: Record<string, string> = { B1: "Urdu reading", B2: "English reading", B3: "Listening", B4: "Maths: numbers", B5: "Maths: sums" };

function saDone(s: string) {
  act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s, reason: "complete" }, origin: window.location.origin })); });
}

async function startChild(drawId = "d1") {
  fireEvent.click(within(screen.getByTestId(`assess-child-${drawId}`)).getByRole("button", { name: "Present" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start" }));
  const frame = (await screen.findByTestId("assess-engine-frame")) as HTMLIFrameElement;
  return new URL(frame.getAttribute("src") as string, "http://x").searchParams.get("s") as string;
}

function stored() {
  const k = Object.keys(window.localStorage).find((x) => x.startsWith("assess:s2:")) as string;
  return JSON.parse(window.localStorage.getItem(k) as string);
}
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

  it("present → handover (block shown) → Start sends the phone's id and block → the engine frame (Urdu form, name only after #n=)", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    let savedFirst = false;
    api.markOutcome.mockImplementation(async (args: any) => {
      savedFirst = JSON.stringify(window.localStorage).includes(args.clientSessionId);
      return { sessionId: "server-1" };
    });
    renderPage();
    fireEvent.click(await screen.findByTestId("assess-school-s2"));
    await screen.findByText("ایان ٹیسٹ والا");
    fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "حاضر" }));
    const block = pickBlock([]);
    expect(await screen.findByTestId("assess-handover")).toBeInTheDocument();
    expect(screen.getByTestId("assess-handover-block")).toHaveTextContent(/./);
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("0/5");
    fireEvent.click(screen.getByRole("button", { name: "شروع" }));
    const frame = (await screen.findByTestId("assess-engine-frame")) as HTMLIFrameElement;
    const call = api.markOutcome.mock.calls[0][0];
    expect(call).toMatchObject({ schoolId: "s2", visitId: "v2", drawId: "d1", outcome: "present", block });
    expect(call.clientSessionId).toMatch(UUID);
    expect(savedFirst).toBe(true);
    const src = frame.getAttribute("src") as string;
    const [path, frag] = src.split("#");
    const q = new URL(path, "http://x").searchParams;
    expect(q.get("s")).toBe(call.clientSessionId);
    expect(q.get("form")).toBe("sa.coach.G3.A.ur");
    expect(q.get("block")).toBe(block);
    expect(q.get("embed")).toBe("1");
    expect(path).not.toMatch(/ایان|Ayan/);
    expect(frag).toBe(`n=${encodeURIComponent("ایان")}`);
  });

  it("each child's block is shown on the row; the next child gets a different block; whole battery gives 'full'", async () => {
    await openList();
    const s1 = await startChild("d1");
    saDone(s1);
    await screen.findByTestId("assess-child-d2");
    const first = pickBlock([]);
    expect(screen.getByTestId("assess-child-d1")).toHaveTextContent(BLOCK_EN[first]);
    fireEvent.click(within(screen.getByTestId("assess-child-d2")).getByRole("button", { name: "Present" }));
    expect(await screen.findByTestId("assess-handover-block")).toHaveTextContent(BLOCK_EN[pickBlock([first])]);
    const toggle = screen.getByRole("checkbox", { name: /Whole battery/ });
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId("assess-handover")).toHaveTextContent("about 29 minutes");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const frame = await screen.findByTestId("assess-engine-frame");
    expect(new URL(frame.getAttribute("src") as string, "http://x").searchParams.get("block")).toBe("full");
    expect(api.markOutcome.mock.calls[1][0]).toMatchObject({ drawId: "d2", block: "full" });
  });

  it("sa:done goes straight back to the list: the child is done, with a toast", async () => {
    await openList();
    const s = await startChild();
    saDone("someone-else");
    expect(screen.getByTestId("assess-engine-frame")).toBeInTheDocument();
    saDone(s);
    const row = await screen.findByTestId("assess-child-d1");
    expect(row).toHaveTextContent("Done");
    expect(within(row).queryByRole("button", { name: "Present" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Saved. Next child.");
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("1/5");
    expect(stored().finished.d1).toBe(s);
  });

  it("the coach can end early with the corner hold", async () => {
    await openList();
    await startChild();
    const hold = screen.getByRole("button", { name: /End test/ });
    vi.useFakeTimers();
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerUp(hold);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId("assess-engine-frame")).toBeInTheDocument();
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(3100); });
    vi.useRealTimers();
    expect(await screen.findByTestId("assess-child-d1")).toHaveTextContent("Done");
  });

  it("offline Present still opens the frame; the queued outcome is sent on 'online', in order, once", async () => {
    api.markOutcome.mockRejectedValueOnce(NET());
    await openList();
    const s = await startChild();
    expect(stored().queue).toHaveLength(1);
    expect(stored().queue[0]).toMatchObject({ drawId: "d1", outcome: "present", clientSessionId: s });
    saDone(s);
    await screen.findByTestId("assess-child-d1");
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("on phone");
    api.markOutcome.mockResolvedValue({});
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(stored().queue).toHaveLength(0));
    expect(api.markOutcome).toHaveBeenCalledTimes(2);
    expect(api.markOutcome.mock.calls[1][0]).toMatchObject({ drawId: "d1", outcome: "present", clientSessionId: s });
  });

  it("a queued outcome the server turns down (4xx) is dropped and logged; 409 stays queued", async () => {
    api.markOutcome.mockRejectedValueOnce(NET()).mockRejectedValueOnce(NET());
    await openList();
    fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Absent" }));
    await waitFor(() => expect(screen.queryByTestId("assess-child-d1")).toBeNull());
    fireEvent.click(within(screen.getByTestId("assess-child-d2")).getByRole("button", { name: "Refused" }));
    await waitFor(() => expect(stored().queue).toHaveLength(2));
    api.markOutcome.mockRejectedValueOnce({ response: { status: 409, data: {} } });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(api.markOutcome).toHaveBeenCalledTimes(3));
    expect(stored().queue).toHaveLength(2);
    api.markOutcome.mockRejectedValueOnce({ response: { status: 400, data: { reason: "invalid" } } }).mockResolvedValueOnce({});
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(stored().queue).toHaveLength(0));
    expect(stored().refused).toEqual([expect.objectContaining({ drawId: "d1", outcome: "absent", status: 400 })]);
    expect(api.markOutcome.mock.calls[4][0]).toMatchObject({ drawId: "d2", outcome: "refused" });
  });

  it("queued outcomes are sent when the page loads", async () => {
    window.localStorage.setItem("assess:s9:2026-01-01", JSON.stringify({ queue: [{ qid: "q1", schoolId: "s9", visitId: null, drawId: "d9", outcome: "absent", at: 1 }] }));
    renderPage();
    await waitFor(() => expect(api.markOutcome).toHaveBeenCalledWith({ schoolId: "s9", visitId: null, drawId: "d9", outcome: "absent" }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("assess:s9:2026-01-01") as string).queue).toHaveLength(0));
  });

  it("absent offline moves the first alternate up on the phone", async () => {
    api.markOutcome.mockRejectedValueOnce(NET());
    await openList();
    fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Absent" }));
    const promoted = await screen.findByTestId("assess-child-d6");
    expect(within(promoted).getByRole("button", { name: "Present" })).toBeInTheDocument();
    expect(screen.queryByTestId("assess-child-d1")).toBeNull();
    expect(screen.getByTestId("assess-alternates")).not.toHaveTextContent("Faraz");
    expect(stored().queue[0]).toMatchObject({ drawId: "d1", outcome: "absent" });
  });

  it("status polling: on phone → sending → sent", async () => {
    await openList();
    const s = await startChild();
    api.getStatus.mockResolvedValue({ session: { id: "server-1", status: "started", grade: 3, form: "sa.coach.G3.A.en" }, block: "B1", lastSeq: 3, tasksDone: [], audio: [] });
    saDone(s);
    await screen.findByTestId("assess-child-d1");
    await waitFor(() => expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("sending"));
    expect(api.getStatus).toHaveBeenCalledWith(s);
    api.getStatus.mockResolvedValue({ session: { id: "server-1", status: "completed", grade: 3, form: "sa.coach.G3.A.en" }, block: "B1", lastSeq: 9, tasksDone: ["t1"], audio: [] });
    // the 30 s poll also runs when the phone comes back online
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("sent"));
    expect(screen.getByTestId("assess-visit-bar")).not.toHaveTextContent("sending");
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
