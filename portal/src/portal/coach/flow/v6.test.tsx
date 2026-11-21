import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.27 (queue #204) — the coach flow v6 (#188's canvas, page v6; the operator 20 Nov ~13:30: "ok v6 looks good.
 * Lets get this built."), behind portal_coach_flow_v2 (fail-closed). Switch off = every screen as on production.
 *
 *   Observe       the app's Observe header (date crumb, no WhatsApp button, no yellow "need you" bar); Schedule an
 *                 observation; Booked for today with Record, then All booked (Late, Coming up) opening in place; Needs you
 *                 (the 2 oldest, See all opening in place); History
 *   Schedule an observation   school → teacher → When? (Schedule for Now / Schedule for Later); Now books quietly and
 *                 records or uploads; Later opens the app's own day-and-time picker; "Observation scheduled"
 *   Recording     the recording keeps going while the coach moves round the app (the operator 20 Nov ~13:32): the record
 *                 screen keeps the menu, the recorder lives above the pages (lib/recordingSession), the Recording bar
 *                 takes her back
 *   Words         never him or her: the teacher's name or "the teacher"
 */

vi.mock("../../components/PortalLayout", () => ({
  default: ({ children, bare }: any) => <div data-testid="layout" data-bare={bare ? "yes" : "no"}>{children}</div>,
}));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: {
    getHome: vi.fn(), getSchedule: vi.fn(), getTeam: vi.fn(), getPeople: vi.fn(), getReports: vi.fn(), getVisit: vi.fn(),
    handoff: vi.fn(() => Promise.resolve({ code: null })),
  },
  leader: { cancelSchedule: vi.fn(), createSchedule: vi.fn(), getObserveLessonQuestion: vi.fn(() => Promise.resolve(null)) },
}));
vi.mock("./track", () => ({ trackFlow: vi.fn() }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), useBotNumber: () => "923000000000" }));
vi.mock("../ui", async (orig) => ({ ...(await orig<object>()), readPending: vi.fn(() => Promise.resolve({ waiting: 4, ids: ["r2"] })) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", () => ({ useFlowV2: () => flow.on, useFlowV6: () => flow.on, useCoachFlowV2: () => flow.on, coachFlowV2On: () => flow.on === true }));

/* The recording session (lib/recordingSession), as the app's provider would give it. */
const rec = vi.hoisted(() => ({
  session: null as any,
  make(over: Record<string, unknown> = {}) {
    const s: any = {
      active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null,
      elapsedMs: () => 42_000,
      start: vi.fn(async ({ returnTo }: { returnTo: string }) => { s.active = true; s.returnTo = returnTo; s.recordingId = "rec-1"; return "recording"; }),
      pause: vi.fn(), resume: vi.fn(),
      finish: vi.fn(async () => ({ id: "rec-1", blob: new Blob(["x"]), type: { ext: ".webm", mime: "audio/webm" }, durationMs: 42_000 })),
      setChunkListener: vi.fn(), askBeforeLogout: vi.fn(),
      ...over,
    };
    return s;
  },
}));
vi.mock("../../lib/recordingSession", () => ({
  useRecordingSession: () => rec.session,
  useRecordingClock: (s: any) => (s ? s.elapsedMs() : 0),
  useLogoutGuard: (f: unknown) => f,
}));
const oldRecorder = vi.hoisted(() => ({ used: 0 }));
vi.mock("../../lib/useCoachRecording", () => ({
  useMicLevel: () => null,
  useCoachRecording: () => {
    oldRecorder.used += 1;
    return { recording: true, paused: false, elapsed: 0, level: null, screenWentOff: false, micBlocked: false, togglePause: vi.fn(), finish: vi.fn(), elapsedNow: () => 0 };
  },
}));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<object>()), rememberRecording: vi.fn() }));

import { coach, leader } from "../../services/api";
import { trackFlow } from "./track";
import { karachiDay, karachiSlotNow } from "../time";
import { addDays } from "../../teacher/ui";
import { ObserveRoute, ScheduleRoute } from "./routes";
import CoachNewVisit from "../pages/CoachNewVisit";
import CoachRecord from "../pages/CoachRecord";
import { getDraft } from "../observeDraft";
import { SCHEDULE } from "../schedule/copy";
import { OBSERVE } from "../observe/copy";
import { FLOW_V6 } from "./copy";

const C = coach as any;
const L = leader as any;

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/portal/coach/observe" element={<ObserveRoute />} />
        <Route path="/portal/coach/schedule" element={<ScheduleRoute />} />
        <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
        <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
        <Route path="*" element={<p data-testid="other">other</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const today = karachiDay();
const v = (id: string, day: string, slot: string, status: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, teacherName: name, schoolName: "IMCB G-8/4", schoolExtId: "S2", teacherExtId: `t-${id}`, scheduledFor: day, scheduledSlot: slot, status, ...extra,
});
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const report = (id: string, name: string, step: string, ago: number) => ({
  id, createdAt: daysAgo(ago), teacherName: name, teacherPhone: null, teacherExtId: null, schoolName: "IMSG G-7/3", schoolExtId: null,
  status: "x", step, score: null, portal: true,
});
const SCHEDULE_ANSWER = {
  success: true, from: today, to: addDays(today, 90),
  overdue: [v("o1", addDays(today, -6), "10:00", "upcoming", "Rabia Nawaz", { overdue: true }), v("o2", addDays(today, -2), "11:30", "upcoming", "Sumaira Akhtar", { overdue: true })],
  visits: [
    v("t1", today, "08:30", "done", "Farah Naz"), v("t2", today, "10:30", "upcoming", "Kiran Shahzadi"), v("t3", today, "12:00", "upcoming", "Asma Batool"),
    v("c1", addDays(today, 1), "09:00", "upcoming", "Nadia Perveen"), v("c2", addDays(today, 4), "09:30", "upcoming", "Shazia Kanwal"),
  ],
};
const REPORTS_ANSWER = {
  success: true,
  waiting: [report("r1", "Saima Riaz", "draft", 1), report("r2", "Lubna Arif", "talk", 17), report("r3", "Huma Ijaz", "talk", 1.2), report("r4", "Ambreen Gul", "report", 3)],
  inProgress: [],
  all: { total: 12, page: 1, pageSize: 20, items: [] },
};

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  rec.session = rec.make();
  oldRecorder.used = 0;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  C.getPeople.mockResolvedValue({ success: true, schools: [], teachers: [] });
  C.getSchedule.mockResolvedValue(SCHEDULE_ANSWER);
  C.getReports.mockResolvedValue(REPORTS_ANSWER);
  C.getVisit.mockImplementation(async (id: string) => ({ success: true, visit: v(id, today, "10:30", "upcoming", "Mehwish Ali") }));
});

/* ── Observe ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

describe("Observe v6: the app's header, no WhatsApp button, no yellow bar", () => {
  it("title Observe under today's date; neither the WhatsApp strip nor the 'need you' banner", async () => {
    renderAt("/portal/coach/observe");
    await screen.findByTestId("observe-v6");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Observe");
    expect(screen.queryByTestId("continue-on-whatsapp")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("pending-banner")).toBeNull();
  });

  it("Schedule an observation (no 'Start an observation'): the full flow, counted", async () => {
    renderAt("/portal/coach/observe");
    const go = await screen.findByRole("link", { name: /Schedule an observation/ });
    expect(go).toHaveAttribute("href", "/portal/coach/new-visit");
    expect(screen.getByText("School, teacher, then now or later")).toBeInTheDocument();
    expect(screen.queryByText(/Start an observation/)).toBeNull();
    fireEvent.click(go);
    expect(trackFlow).toHaveBeenCalledWith("observe.schedule");
  });

  it("reads today and the days ahead (the server adds the late ones) and the first reports page", async () => {
    renderAt("/portal/coach/observe");
    await screen.findByTestId("booked-today");
    expect(C.getSchedule).toHaveBeenCalledWith({ from: today, to: addDays(today, 90) });
    expect(C.getReports).toHaveBeenCalledWith({ page: 1 });
  });
});

describe("Observe v6: Booked for today, then All booked opening in place", () => {
  it("today's visits still to do, each row one link to its visit (record or upload there); no Record button, no Cancel while folded", async () => {
    renderAt("/portal/coach/observe");
    const booked = await screen.findByTestId("booked-today");
    expect(within(booked).getByTestId("section-count")).toHaveTextContent("2");
    const rows = within(booked).getAllByTestId(/^booked-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["booked-row-t2", "booked-row-t3"]);
    expect(within(booked).queryByText("Farah Naz")).toBeNull();
    expect(within(booked).queryByText("Rabia Nawaz")).toBeNull();
    expect(within(booked).queryByText("Nadia Perveen")).toBeNull();
    // bd-o15qnr.29 (the operator 21 Nov ~08:50): "remove the button, instead show a chevron and the whole tile/card is clickable"
    expect(within(booked).queryByRole("link", { name: /^Record/ })).toBeNull();
    expect(rows.map((r) => within(r).getByRole("link").getAttribute("href"))).toEqual(["/portal/coach/visit/t2", "/portal/coach/visit/t3"]);
    expect(within(booked).queryByRole("button", { name: /Cancel/ })).toBeNull();
  });

  it("All booked says how many are late and how many more; opening it shows Late and Coming up with their buttons", async () => {
    renderAt("/portal/coach/observe");
    const toggle = await screen.findByRole("button", { name: /All booked/ });
    expect(toggle).toHaveTextContent("2 late");
    expect(toggle).toHaveTextContent("4 more");
    fireEvent.click(toggle);
    expect(trackFlow).toHaveBeenCalledWith("observe.booked_open");
    const late = screen.getByTestId("booked-late");
    expect(within(late).getByText("Rabia Nawaz")).toBeInTheDocument();
    expect(within(late).getByText("6 days late")).toBeInTheDocument();
    expect(within(late).queryByRole("link", { name: /^Record/ })).toBeNull();
    expect(within(within(late).getByTestId("booked-row-o1")).getAllByRole("link")[0]).toHaveAttribute("href", "/portal/coach/visit/o1");
    const coming = screen.getByTestId("booked-coming");
    expect(within(coming).getByText("Nadia Perveen")).toBeInTheDocument();
    expect(within(coming).getAllByRole("link", { name: /Reschedule/ })[0].getAttribute("href")).toContain("visit=c1");
    // every visit still to do can be cancelled once open, today's too
    expect(screen.getAllByRole("button", { name: /^Cancel/ }).length).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: /Hide/ }));
    expect(screen.queryByTestId("booked-late")).toBeNull();
  });

  it("Cancel asks first; confirmed, the visit leaves the list", async () => {
    L.cancelSchedule.mockResolvedValue({ success: true, cancelled: true });
    renderAt("/portal/coach/observe?booked=open");
    const coming = await screen.findByTestId("booked-coming");
    fireEvent.click(within(within(coming).getByTestId("booked-row-c1")).getByRole("button", { name: /^Cancel/ }));
    expect(L.cancelSchedule).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel visit" }));
    await waitFor(() => expect(L.cancelSchedule).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByTestId("booked-row-c1")).toBeNull());
  });

  it("nothing booked today: one slim row, and All booked still opens the rest", async () => {
    C.getSchedule.mockResolvedValue({ ...SCHEDULE_ANSWER, visits: SCHEDULE_ANSWER.visits.filter((x) => x.scheduledFor !== today) });
    renderAt("/portal/coach/observe");
    const booked = await screen.findByTestId("booked-today");
    expect(within(booked).getByText("No visits booked today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All booked/ })).toBeInTheDocument();
  });

  it("the old Booked visits address opens Observe with All booked open", async () => {
    renderAt("/portal/coach/schedule");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/observe?booked=open"));
    expect(await screen.findByTestId("booked-late")).toBeInTheDocument();
  });
});

describe("Observe v6: Needs you, the 2 oldest, See all opening in place; History", () => {
  it("oldest first, two shown with how long each waited and its step; See all 4 opens the rest here", async () => {
    renderAt("/portal/coach/observe");
    const needs = await screen.findByTestId("needs-you");
    expect(within(needs).getByTestId("section-count")).toHaveTextContent("4");
    const hrefs = () => within(needs).getAllByRole("link").map((a) => a.getAttribute("href")).filter((h) => (h || "").startsWith("/portal/coach/observation/"));
    expect(hrefs()).toEqual(["/portal/coach/observation/r2", "/portal/coach/observation/r4"]);
    expect(within(needs).getByText("17 days waiting")).toBeInTheDocument();
    expect(within(needs).getByText("Debrief")).toBeInTheDocument();
    fireEvent.click(within(needs).getByRole("button", { name: /See all 4/ }));
    expect(hrefs()).toEqual(["/portal/coach/observation/r2", "/portal/coach/observation/r4", "/portal/coach/observation/r3", "/portal/coach/observation/r1"]);
    fireEvent.click(within(needs).getByRole("button", { name: /Show fewer/ }));
    expect(hrefs().length).toBe(2);
  });

  it("History: how many in all, to the observations list", async () => {
    renderAt("/portal/coach/observe");
    const history = await screen.findByRole("link", { name: /History/ });
    expect(history).toHaveAttribute("href", "/portal/coach/reports");
    await waitFor(() => expect(history).toHaveTextContent("12 in all"));
  });

  it("in Urdu: مشاہدہ شیڈول کریں, آج کے دورے, آپ کے منتظر", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt("/portal/coach/observe");
    expect(await screen.findByRole("link", { name: /مشاہدہ شیڈول کریں/ })).toBeInTheDocument();
    expect(screen.getByText("آج کے دورے")).toBeInTheDocument();
    expect(screen.getByText("آپ کے منتظر")).toBeInTheDocument();
  });
});

/* ── Schedule an observation ─────────────────────────────────────────────────────────────────────────────────────── */

const teacher = (id: string, school: string, extra: Record<string, unknown> = {}) => ({
  teacherExtId: id, name: `Mehwish ${id.toUpperCase()}`, phone: null, schoolName: "IMCB G-8/4", emis: null, schoolExtId: school,
  hitl: 3, dc: 2, avgHitl: 61, daysSinceTraining: 4, daysSinceVisit: 6, levels: ["MIDDLE"], ...extra,
});
const PEOPLE = {
  success: true,
  schools: [
    { schoolExtId: "S1", name: "IMCB G-8/4", teachers: 2, daysSinceVisit: 3 },
    { schoolExtId: "S9", name: "IMSG (I-V) G-7/3", teachers: 1, daysSinceVisit: 0 },
  ],
  teachers: [teacher("a", "S1", { name: "Mehwish Ali" }), teacher("b", "S1", { name: "Kiran Shahzadi" }), teacher("c", "S9")],
};

describe("Schedule an observation: school, teacher, then Now or Later", () => {
  beforeEach(() => {
    C.getPeople.mockResolvedValue(PEOPLE);
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [{ ...v("k1", today, "10:30", "upcoming", "Kiran Shahzadi"), teacherExtId: "b" }] });
  });

  it("step 1 of 3, under Observe; a search narrows the schools", async () => {
    renderAt("/portal/coach/new-visit");
    expect(await screen.findByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Schedule an observation");
    expect(screen.getByTestId("page-crumb")).toHaveTextContent("Observe");
    fireEvent.change(screen.getByPlaceholderText("School name"), { target: { value: "G-7" } });
    expect(screen.queryByText("IMCB G-8/4")).toBeNull();
    expect(screen.getByText("IMSG (I-V) G-7/3")).toBeInTheDocument();
  });

  it("step 2: name and level, no numbers grid; a teacher booked today says when", async () => {
    renderAt("/portal/coach/new-visit?school=S1");
    const row = await screen.findByTestId("teacher-a");
    expect(row).toHaveTextContent("Mehwish Ali");
    expect(row).toHaveTextContent("Middle");
    expect(screen.queryByText("Coach score (avg.)")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("teacher-b")).toHaveTextContent(/Booked 10:30/));
    expect(screen.getByTestId("teacher-a").querySelector("a")?.getAttribute("href")).toBe("/portal/coach/new-visit?school=S1&teacher=a");
  });

  it("step 3: When? Schedule for Now (record or upload, no message) and Schedule for Later (a WhatsApp message); never him or her", async () => {
    renderAt("/portal/coach/new-visit?school=S1&teacher=a");
    const now = await screen.findByTestId("when-now");
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(within(now).getByText("Schedule for Now")).toBeInTheDocument();
    expect(within(now).getByText("You are in the class now.")).toBeInTheDocument();
    expect(within(now).getByRole("button", { name: /Start recording/ })).toBeInTheDocument();
    expect(within(now).getByRole("button", { name: /Upload recording/ })).toBeInTheDocument();
    expect(within(now).getByText("Mehwish Ali gets no message.")).toBeInTheDocument();
    const later = screen.getByTestId("when-later");
    expect(within(later).getByText("Schedule for Later")).toBeInTheDocument();
    expect(within(later).getByText("Another time, today or another day. Mehwish Ali gets a WhatsApp message.")).toBeInTheDocument();
    expect(within(later).getByRole("link", { name: /Pick day and time/ })).toHaveAttribute("href", "/portal/coach/new-visit?school=S1&teacher=a&when=later");
    expect(document.body.textContent).not.toMatch(/\b(her|him|his|she|he)\b/i);
  });

  it("Now · Start recording: booked for this half hour WITHOUT a message (now: true), then the record step", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [] });
    L.createSchedule.mockResolvedValue({ success: true, id: "new-1" });
    renderAt("/portal/coach/new-visit?school=S1&teacher=a");
    fireEvent.click(await screen.findByRole("button", { name: /Start recording/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith({ teacherExtId: "a", date: today, slot: karachiSlotNow(), now: true }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/visit\/new-1\/record$/));
    expect(trackFlow).toHaveBeenCalledWith("schedule.now_record");
  });

  it("Now · Upload recording: the same quiet booking, then the upload step", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [] });
    L.createSchedule.mockResolvedValue({ success: true, id: "new-2" });
    renderAt("/portal/coach/new-visit?school=S1&teacher=a");
    fireEvent.click(await screen.findByRole("button", { name: /Upload recording/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/visit\/new-2\/attach$/));
    expect(L.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ now: true }));
    expect(trackFlow).toHaveBeenCalledWith("schedule.now_upload");
  });

  it("Now, the teacher already booked today: that visit, no second booking", async () => {
    renderAt("/portal/coach/new-visit?school=S1&teacher=b");
    fireEvent.click(await screen.findByRole("button", { name: /Start recording/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coach\/visit\/k1\/record$/));
    expect(L.createSchedule).not.toHaveBeenCalled();
  });

  it("Now, the booking refused: the reason and Try again, she stays", async () => {
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [] });
    L.createSchedule.mockRejectedValue({ response: { data: { error: "Teacher not found" } } });
    renderAt("/portal/coach/new-visit?school=S1&teacher=a");
    fireEvent.click(await screen.findByRole("button", { name: /Start recording/ }));
    expect(await screen.findByText("Teacher not found")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/new-visit");
  });

  it("Later: the app's own day-and-time picker, a WhatsApp message, then 'Observation scheduled' with Done and Schedule another", async () => {
    L.createSchedule.mockResolvedValue({ success: true, id: "later-1" });
    renderAt("/portal/coach/new-visit?school=S1&teacher=a&when=later");
    expect(await screen.findByText("Pick day and time")).toBeInTheDocument();
    expect(screen.getByTestId("time-picker")).toBeInTheDocument();
    expect(screen.getByText("Mehwish Ali gets a WhatsApp message.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    await waitFor(() => expect(L.createSchedule).toHaveBeenCalledWith({ teacherExtId: "a", date: today, slot: "09:00" }));
    expect(await screen.findByText("Observation scheduled")).toBeInTheDocument();
    expect(trackFlow).toHaveBeenCalledWith("schedule.later");
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/portal/coach/observe");
    expect(screen.getByRole("link", { name: /Schedule another/ })).toHaveAttribute("href", "/portal/coach/new-visit");
  });

  it("Reschedule keeps its own screen (step 3 for that visit)", async () => {
    renderAt("/portal/coach/new-visit?school=S1&teacher=a&visit=v9&slot=09:00");
    expect(await screen.findByTestId("time-picker")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Reschedule");
    expect(screen.queryByTestId("when-now")).toBeNull();
  });

  it("in Urdu: the two choices' titles", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt("/portal/coach/new-visit?school=S1&teacher=a");
    expect(await screen.findByText("ابھی کے لیے شیڈول کریں")).toBeInTheDocument();
    expect(screen.getByText("بعد کے لیے شیڈول کریں")).toBeInTheDocument();
  });

  it("switch off: New visit exactly as on production (no When step: the day and time)", async () => {
    flow.on = false;
    renderAt("/portal/coach/new-visit?school=S1&teacher=a");
    expect(await screen.findByTestId("time-picker")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("New visit");
    expect(screen.queryByTestId("when-now")).toBeNull();
  });
});

/* ── Recording continues while she moves round the app ───────────────────────────────────────────────────────────── */

describe("Record, switch on: the recording keeps going while the coach moves round the app", () => {
  beforeEach(() => {
    C.getVisit.mockResolvedValue({ success: true, visit: v("v1", today, "10:30", "upcoming", "Mehwish Ali") });
  });

  it("the recorder is the app's session (returnTo this screen), and the menu stays", async () => {
    renderAt("/portal/coach/visit/v1/record");
    await waitFor(() => expect(rec.session.start).toHaveBeenCalledWith({ returnTo: "/portal/coach/visit/v1/record" }));
    expect(oldRecorder.used).toBe(0);
    await screen.findByRole("timer");
    expect(screen.getAllByTestId("layout").every((el) => el.getAttribute("data-bare") === "no")).toBe(true);
    expect(screen.getByText(FLOW_V6.en.keepsRecording)).toBeInTheDocument();
  });

  it("leaving the screen does not stop it", async () => {
    const { unmount } = renderAt("/portal/coach/visit/v1/record");
    await waitFor(() => expect(rec.session.start).toHaveBeenCalled());
    unmount();
    expect(rec.session.finish).not.toHaveBeenCalled();
  });

  it("coming back to a running recording: no second start", async () => {
    rec.session = rec.make({ active: true, returnTo: "/portal/coach/visit/v1/record", recordingId: "rec-1" });
    renderAt("/portal/coach/visit/v1/record");
    await screen.findByRole("timer");
    expect(rec.session.start).not.toHaveBeenCalled();
  });

  it("came back to a running recording, then it stops: no second recording starts (sandbox film, 20 Nov)", async () => {
    rec.session = rec.make({ active: true, returnTo: "/portal/coach/visit/v1/record", recordingId: "rec-1" });
    const view = render(
      <MemoryRouter initialEntries={["/portal/coach/visit/v1/record"]}>
        <Routes><Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("timer");
    const started = rec.session.start;
    // the provider after Stop: nothing recording, a new session object (as setLive(IDLE) gives)
    rec.session = rec.make({ active: false, returnTo: null, recordingId: null, start: started });
    view.rerender(
      <MemoryRouter initialEntries={["/portal/coach/visit/v1/record"]}>
        <Routes><Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} /></Routes>
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(started).not.toHaveBeenCalled();
  });

  it("Stop asks, then the recording goes to Check and send", async () => {
    // the session as the provider gives it once recording (the mock does not re-render on start)
    rec.session = rec.make({ active: true, returnTo: "/portal/coach/visit/v1/record", recordingId: "rec-1" });
    renderAt("/portal/coach/visit/v1/record");
    await screen.findByRole("timer");
    fireEvent.click(screen.getByRole("button", { name: OBSERVE.en.stop }));
    fireEvent.click(await screen.findByRole("button", { name: OBSERVE.en.yesStop }));
    await waitFor(() => expect(rec.session.finish).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/visit/v1/check"));
    expect(getDraft("v1")?.recordingId).toBe("rec-1");
  });

  it("another observation is recording: it says so and goes back to it, never starting a second", async () => {
    rec.session = rec.make({ active: true, returnTo: "/portal/coach/visit/zz/record", recordingId: "rec-0" });
    renderAt("/portal/coach/visit/v1/record");
    const busy = await screen.findByTestId("recording-elsewhere");
    expect(within(busy).getByRole("link", { name: new RegExp(FLOW_V6.en.backToRecording) })).toHaveAttribute("href", "/portal/coach/visit/zz/record");
    expect(rec.session.start).not.toHaveBeenCalled();
  });

  it("switch off: the old recorder, with no menu (production's screen)", async () => {
    flow.on = false;
    renderAt("/portal/coach/visit/v1/record");
    await screen.findByRole("timer");
    expect(oldRecorder.used).toBeGreaterThan(0);
    expect(rec.session.start).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("layout").some((el) => el.getAttribute("data-bare") === "yes")).toBe(true);
  });
});

/* ── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

describe("v6 words", () => {
  it("every v6 word has Urdu, and no English one says him or her", () => {
    for (const [k, en] of Object.entries(FLOW_V6.en)) {
      const ur = (FLOW_V6.ur as Record<string, unknown>)[k];
      expect(ur, k).toBeTruthy();
      const text = typeof en === "function" ? (en as (...a: unknown[]) => string)("Mehwish", 3, 3) : String(en);
      expect(text, k).not.toMatch(/\b(her|him|his|she|he)\b/i);
      if (typeof ur === "string") expect(ur, k).toMatch(/[؀-ۿ]/);
    }
  });

  it("the schedule words keep Step n of 3", () => {
    expect(SCHEDULE.en.stepOfN(3, 3)).toBe("Step 3 of 3");
  });
});

/* ── the NIETE portal v2 rule, swept across the coach app's copy (the operator, 20 Nov: "Never use him or her") ───── */

import { SCHOOL_CARD } from "../card/copy";
import { DISAGREE } from "../disagreements/copy";

describe("never him or her, anywhere in the coach app's School card and Disagreements words", () => {
  const strings = (o: unknown): string[] => {
    if (typeof o === "string") return [o];
    if (typeof o === "function") { try { return [String((o as (...a: unknown[]) => unknown)(3, 5))]; } catch { return []; } }
    if (Array.isArray(o)) return o.flatMap(strings);
    if (o && typeof o === "object") return Object.values(o).flatMap(strings);
    return [];
  };
  it.each([["School card", SCHOOL_CARD.en], ["Disagreements", DISAGREE.en]])("%s", (_n, words) => {
    expect(strings(words).filter((t) => /\b(her|him|his|she|he)\b/i.test(t))).toEqual([]);
  });
});
