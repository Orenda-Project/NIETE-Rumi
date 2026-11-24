import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr.53 (queue #246; the operator 24 Nov ~06:30: "4 and 6 also go"), behind portal_coach_flow_v2:
 *
 *   (b) The principal's Observe page gets the coach's In progress section (#240) and the coach's order: Needs you, In
 *       progress, Booked for today, History (Schedule an observation stays the first thing). In progress = her
 *       observations started and not finished that are NOT waiting on her: still going up from this phone ("Sending ·
 *       N%", opening its Sending page), analysing, the report sending, waiting for the teacher. One row each, the coach's
 *       card: the teacher, the time it started, the date and class ("Mon 23 Nov · Grade 4 · Urdu"), the stage as a chip,
 *       opening the observation. Never a row Needs you has; no section when there is none. Needs you rows read as the
 *       coach's: "N days waiting · Grade 7 · English".
 *   (a) A debriefed report she has not sent is in Needs you (the server, tests/portal/bd-o15qnr.53-…): its row says
 *       "Send report" and opens the observation, where Send is — on the principal's page and the coach's.
 *
 * English and Urdu.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../coach/CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const coachApi = vi.hoisted(() => ({ getReports: vi.fn(), getSchedule: vi.fn(), getPending: vi.fn(), getHome: vi.fn(() => Promise.resolve({ success: true })) }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
  language: { get: vi.fn(), set: vi.fn() },
  coach: coachApi,
  leader: { cancelSchedule: vi.fn() },
}));
vi.mock("../../coach/flow/track", () => ({ trackFlow: vi.fn() }));
vi.mock("../../coach/ui", async (orig) => ({ ...(await orig<object>()), readPending: vi.fn(() => Promise.resolve({ waiting: 0, ids: [] })) }));
// The background send never finishes in these tests: it stays "Sending" on Observe.
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<object>()), sendObservation: vi.fn(() => new Promise(() => {})) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../../coach/flow/useCoachFlowV2", async (orig) => ({
  ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on, useCoachFlowV2: () => flow.on, coachFlowV2On: () => flow.on === true,
}));

import api, { portal } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { AuthContext } from "../../hooks/authContext";
import { forgetConfig } from "../../lib/useNewUi";
import i18n from "@/i18n/config";
import { PrincipalObserveV6 } from "./ObserveV6";
import { PRINCIPAL_OBSERVE_ROUTES, PRINCIPAL_PICK, principalObservationPath } from "./observe";
import { ObserveRoute } from "../../coach/flow/routes";
import { resetSender, startSend } from "../../coach/observe/sender";

vi.setConfig({ testTimeout: 40_000 });

const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-53", schoolName: "GGPS Sample" };
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
// Mon 23 Nov 2026, 8:13 PM in Pakistan
const AT = "2026-11-23T15:13:00Z";
const row = (id: string, name: string, step: string, stage: string, extra: Record<string, unknown> = {}) => ({
  id, createdAt: AT, teacherName: name, teacherPhone: null, teacherExtId: `ext-${id}`, schoolName: "GGPS Sample", schoolExtId: null,
  status: "x", step, stage, score: null, portal: true, obs612: null, listening: false, grade: null, subject: null, ...extra,
});
const WAITING = [
  row("w1", "Lubna Arif", "report", "feedback", { grade: 7, subject: "english" }),
  row("w2", "Ambreen Gul", "talk", "talk", { grade: 3, subject: "maths" }),
];
const GOING = [
  row("p1", "Rubina Kausar", "analysing", "analysing", { grade: 4, subject: "urdu" }),
  row("p2", "Samina Akhtar", "report", "sending", { grade: 6, subject: "islamiat" }),
  row("p3", "Farah Naz", "sent", "waiting_teacher"),
];
const REPORTS = { success: true, waiting: WAITING, inProgress: GOING, all: { total: 9, page: 1, pageSize: 30, items: [...WAITING, ...GOING] } };
const VISIT = { id: "v1", teacherExtId: "ext-k", teacherName: "Kiran Shahzadi", schoolName: "GGPS Sample", schoolExtId: null, scheduledFor: TODAY, scheduledSlot: "10:30", status: "upcoming" };

function serve(reports: unknown = REPORTS) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features: { teacherV2: true, principalApp: true, principalFlowV2: true } } as never);
  coachApi.getReports.mockResolvedValue(reports);
  coachApi.getSchedule.mockResolvedValue({ success: true, visits: [VISIT], overdue: [] });
  coachApi.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
  vi.mocked(api.get).mockImplementation((() => Promise.resolve({ data: { success: true, items: [] } })) as never);
}

function at(path: string, el: JSX.Element) {
  vi.mocked(useAuth).mockReturnValue({ user: PRINCIPAL, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <AuthContext.Provider value={{ user: PRINCIPAL, loading: false } as never}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={path.split("?")[0]} element={el} /></Routes></MemoryRouter>
    </AuthContext.Provider>,
  );
}
const principalObserve = () => at("/portal/teacher/observations", <PrincipalObserveV6 />);

const order = (container: HTMLElement, ids: string[]) =>
  [...container.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).filter((t) => ids.includes(t as string));
const SECTIONS = ["needs-you", "in-progress", "booked-today", "observe-history"];

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  forgetConfig();
  resetSender();
  flow.on = true;
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("(b) the principal's Observe: Needs you, In progress, Booked for today, History", () => {
  it("the four in that order, Schedule an observation still first", async () => {
    serve();
    const { container } = principalObserve();
    await screen.findByTestId("in-progress");
    expect(order(container, SECTIONS)).toEqual(SECTIONS);
    const go = screen.getByRole("link", { name: /Schedule an observation/ });
    expect(go.getAttribute("href")).toBe(PRINCIPAL_PICK);
    expect(go.compareDocumentPosition(screen.getByTestId("needs-you")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("In progress: one row each, the stage as a chip, the date and class, the time it started; each opens its observation", async () => {
    serve();
    principalObserve();
    const box = await screen.findByTestId("in-progress");
    expect(within(box).getByTestId("section-count")).toHaveTextContent("3");
    const rows = within(box).getAllByRole("link");
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["p1", "p2", "p3"].map((id) => principalObservationPath(id)));
    expect(rows[0]).toHaveTextContent("Rubina Kausar");
    expect(rows[0]).toHaveTextContent("Analysing");
    expect(rows[0]).toHaveTextContent("Mon 23 Nov · Grade 4 · Urdu");
    expect(rows[0]).toHaveTextContent(/8:13/);
    expect(rows[1]).toHaveTextContent("Sending report");
    expect(rows[2]).toHaveTextContent("Waiting for teacher");
    // no class named: the date alone, never a dash
    expect(within(rows[2]).getByText("Mon 23 Nov")).toBeInTheDocument();
  });

  it("an observation still going up from this phone is In progress first, 'Sending · N%', and opens her Sending page", async () => {
    serve();
    startSend({
      visitId: "v-up", teacherExtId: "ext-up", schoolExtId: null, teacherName: "Sadia Noreen", visitDay: TODAY, durationMs: 60_000,
      recordingId: null, audio: { blob: new Blob(["x"]), filename: "a.webm" }, plan: null, photos: [], lesson: { grade: 8, subject: "science" },
      waitHref: PRINCIPAL_OBSERVE_ROUTES.sending("ext-up"),
    });
    principalObserve();
    const box = await screen.findByTestId("in-progress");
    const rows = within(box).getAllByRole("link");
    expect(rows[0]).toHaveTextContent("Sadia Noreen");
    expect(rows[0]).toHaveTextContent(/Sending · \d+%/);
    expect(rows[0]).toHaveTextContent("Grade 8 · Science");
    expect(rows[0]).toHaveAttribute("href", PRINCIPAL_OBSERVE_ROUTES.sending("ext-up"));
    expect(within(box).getByTestId("section-count")).toHaveTextContent("4");
  });

  it("nothing in both lists: a row Needs you has is never also In progress", async () => {
    serve({ ...REPORTS, inProgress: [...GOING, WAITING[0]] });
    principalObserve();
    const box = await screen.findByTestId("in-progress");
    expect(within(box).queryByText("Lubna Arif")).toBeNull();
    expect(within(box).getByTestId("section-count")).toHaveTextContent("3");
  });

  it("no In progress section when nothing is under way", async () => {
    serve({ ...REPORTS, inProgress: [] });
    principalObserve();
    await screen.findByText("Lubna Arif");
    expect(screen.queryByTestId("in-progress")).toBeNull();
  });

  it("Needs you rows read as the coach's: how long it waited, the grade and subject", async () => {
    serve();
    principalObserve();
    const needs = await screen.findByTestId("needs-you");
    const first = (await within(needs).findAllByRole("link"))[0];
    expect(first).toHaveTextContent("Lubna Arif");
    expect(first).toHaveTextContent(/(days waiting|Since yesterday|Since today) · Grade 7 · English/);
  });

  it("in Urdu: the section and its chips in her words", async () => {
    serve();
    await act(async () => { await i18n.changeLanguage("ur"); });
    principalObserve();
    const box = await screen.findByTestId("in-progress");
    expect(within(box).getByText("جاری")).toBeTruthy();
    const rows = within(box).getAllByRole("link");
    expect(rows[0]).toHaveTextContent("تجزیہ جاری");
    expect(rows[1]).toHaveTextContent("رپورٹ جا رہی ہے");
    expect(rows[2]).toHaveTextContent("استاد کا انتظار");
  });
});

describe("(a) a debriefed report she has not sent: Needs you, 'Send report', opening her Send step", () => {
  it("principal: the row says Send report and opens the observation", async () => {
    serve();
    principalObserve();
    const needs = await screen.findByTestId("needs-you");
    const first = (await within(needs).findAllByRole("link"))[0];
    expect(first).toHaveTextContent("Send report");
    expect(first.getAttribute("href")).toBe(principalObservationPath("w1"));
  });

  it("principal, in Urdu: رپورٹ بھیجیں", async () => {
    serve();
    await act(async () => { await i18n.changeLanguage("ur"); });
    principalObserve();
    const needs = await screen.findByTestId("needs-you");
    expect((await within(needs).findAllByRole("link"))[0]).toHaveTextContent("رپورٹ بھیجیں");
  });

  it("coach: the row says Send report and opens the observation", async () => {
    serve();
    vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Hina", role: "coach" }, loading: false } as unknown as ReturnType<typeof useAuth>);
    render(<MemoryRouter initialEntries={["/portal/coach/observe"]}><Routes><Route path="/portal/coach/observe" element={<ObserveRoute />} /></Routes></MemoryRouter>);
    const needs = await screen.findByTestId("needs-you");
    const first = (await within(needs).findAllByRole("link"))[0];
    expect(first).toHaveTextContent("Lubna Arif");
    expect(first).toHaveTextContent("Send report");
    expect(first.getAttribute("href")).toBe("/portal/coach/observation/w1");
  });
});
