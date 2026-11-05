import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";
import { AuthContext, type SharedAuth } from "../../hooks/authContext";
import { COACH, net, resetAll } from "./harness.testdata";
import { untranslated } from "../../teacher/i18n";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { COPY_MODULES } from "../../teacher/copyRegistry";
import { WHERE, WHERE_COPY_ENTRY } from "./whereCopy";
import type { CoachFirstData, WhereToCoachData } from "./where";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * Where to coach and Who to coach first (bd-17v39c.4.14): the two coach-only pages against the API's shapes. Only the
 * network is mocked; the real switch hook, gate and frame run. Every number and tip on screen is the server's.
 */
const EXT = "920000000001";
const EMIS = "E-900";
const PERIOD = {
  key: "month" as const, from: "2026-10-01", to: "2026-10-28", today: "2026-10-28", schoolDaysSoFar: 20,
  buckets: [{ key: "w1", label: "Wk 1", date: "2026-09-28", future: false, partial: true }],
};
const tips = (en: string, ur: string, source = "rifat:D2") => ({ source, en: { lookFor: `LOOK ${en}`, tryThis: `TRY ${en}` }, ur: { lookFor: `دیکھیں ${ur}`, tryThis: `آزمائیں ${ur}` } });

function whereData(over: Partial<WhereToCoachData> = {}): WhereToCoachData {
  return {
    teacher: { teacherExtId: EXT, name: "Sana Demo", school: "Demo School", emis: EMIS },
    period: PERIOD,
    framework: "fico_v3",
    scaleMax: 4,
    sessions: { dc: 6, coach: 2 },
    signal: "patterns",
    sections: [
      { code: "D", dc: 52, coach: 50, agreeLow: true, differ: false, focusHere: true },
      { code: "C", dc: 61, coach: 70, agreeLow: false, differ: false, focusHere: false },
      { code: "B", dc: 64, coach: 70, agreeLow: false, differ: false, focusHere: false },
      { code: "F", dc: 84, coach: 58, agreeLow: false, differ: true, focusHere: false },
    ],
    focus: { id: "D3", section: "D", name: "Student-to-Student Interaction", n: 6, k: 6, avg: 1.5, scaleMax: 4, latest: 1, change: 0, tips: tips("pair talk", "جوڑیاں"), why: { test: 1, reason: "both" }, linkedStep: "You Do" },
    weakest: [
      { id: "D3", section: "D", name: "Student-to-Student Interaction", n: 6, k: 6, avg: 1.5, scaleMax: 4, latest: 1, change: 0, tips: tips("pair talk", "جوڑیاں"), focus: true },
      { id: "C1", section: "C", name: "Quality Questioning", n: 6, k: 5, avg: 1.8, scaleMax: 4, latest: 2, change: 0, tips: tips("why questions", "سوال", "draft"), focus: false },
      { id: "D1", section: "D", name: "Active Participation Rate", n: 6, k: 4, avg: 2.2, scaleMax: 4, latest: 2, change: 1, tips: tips("every row", "قطار", "rifat:D1"), focus: false },
    ],
    strength: { id: "F1", section: "F", name: "Content Accuracy", n: 6, k: 0, avg: 3.7, scaleMax: 4, latest: 4, change: 1, tips: null },
    plan: { pct: 64, measured: 4, of: 6, skipped: [{ step: "You Do", index: 4, skipped: 3, of: 4, tips: tips("practice activity", "مشق", "rifat:B2") }] },
    lastAdvice: { text: "Before you take answers, give pairs one minute.", date: "2026-10-27", sessionId: "s-6" },
    reports: [
      { id: "s-6", date: "2026-10-27", grade: "4", subject: "english", title: "Types of Sentences", score: 58, weakest: "D" },
      { id: "s-5", date: "2026-10-23", grade: "4", subject: "math", title: null, score: 61, weakest: "D" },
    ],
    moreReports: 2,
    checkin: {
      usage: { dc: 6, lp: 4, training: 1, papers: 0 },
      items: [{
        feature: "papers", state: "none", count: 0,
        content: {
          en: { questions: ["How are you making your tests and exams?", "Have you tried it?"], blockers: [["Did not know about it", "Show where the exam generator is."], ["Printing is a problem", "Note it for the programme team."]] },
          ur: { questions: ["آپ اپنے ٹیسٹ کیسے بناتی ہیں؟", "کیا آپ نے آزمایا؟"], blockers: [["اس کے بارے میں معلوم نہیں تھا", "دکھائیں کہ فیچر کہاں ہے۔"], ["پرنٹنگ کا مسئلہ", "نوٹ کریں۔"]] },
        },
      }],
    },
    ...over,
  };
}

const row = (name: string, ext: string, group: CoachFirstData["groups"][number]["key"], extra: Partial<CoachFirstData["groups"][number]["rows"][number]> = {}) => ({
  teacherExtId: ext, name, group, focus: { id: "D3", name: "Student-to-Student Interaction", section: "D" as const, why: { test: 1 as const, reason: "both" as const } },
  k: 6, n: 6, sessions: { dc: 6, coach: 2 }, lastDcDaysAgo: null, ...extra,
});
const FIRST: CoachFirstData = {
  school: { emis: EMIS, name: "Demo School" },
  period: PERIOD,
  level: null,
  teachers: 5,
  groups: [
    { key: "agree_low", rows: [row("Sana Demo", "920000000001", "agree_low")] },
    { key: "low_most", rows: [row("Rabia Demo", "920000000002", "low_most", { focus: { id: "C3", name: "Effective Feedback", section: "C", why: { test: 2, reason: "low", k: 5, n: 6, source: "dc" } }, k: 5, n: 6 })] },
    { key: "no_dc", rows: [row("Farah Demo", "920000000003", "no_dc", { focus: null, k: null, n: null, sessions: { dc: 0, coach: 0 }, lastDcDaysAgo: 41 })] },
    { key: "one_dc", rows: [] },
    { key: "none", rows: [row("Nadia Demo", "920000000005", "none"), row("Hina Demo", "920000000006", "none")] },
  ],
};

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where" data-search={search}>{pathname}</p>;
}

let pages: { WhereToCoachPage: () => JSX.Element; CoachFirstPage: () => JSX.Element };
beforeAll(async () => {
  pages = {
    WhereToCoachPage: (await import("./WhereToCoachPage")).default,
    CoachFirstPage: (await import("./CoachFirstPage")).default,
  };
}, 120_000);
beforeEach(async () => {
  await resetAll();
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
});

async function open(entry: string, lang: "en" | "ur" = "en") {
  if (!i18n.isInitialized) await i18n.init({ lng: lang, resources: {} });
  await act(async () => { await i18n.changeLanguage(lang); });
  const value: SharedAuth = { user: COACH, loading: false, request: vi.fn() };
  const view = render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[entry]}>
        <Where />
        <Routes>
          <Route path="/portal/coach/teacher/:ext/where" element={<pages.WhereToCoachPage />} />
          <Route path="/portal/coach/school/:emis/first" element={<pages.CoachFirstPage />} />
          <Route path="*" element={<p data-testid="other">other page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return view;
}

describe("Where to coach, one teacher", () => {
  it("opens on This month (Rifat's pick 1B) and says it is coach only, with no share button", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData());
    const { container } = await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.getByTestId("convo")).toBeInTheDocument());
    expect(net.calls).toContain(`/coach/teacher/${EXT}/where?period=month`);
    expect(screen.getAllByText("Only you see this · never shared").length).toBeGreaterThan(0);
    expect(within(container).queryByRole("button", { name: /share/i })).toBeNull();
    expect(container.textContent).not.toMatch(/HITL/);
  });

  it("the conversation: a strength, ONE focus and why, its Try this, the next step", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData());
    await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.getByTestId("convo")).toBeInTheDocument());
    const steps = screen.getAllByTestId("convo-step");
    expect(steps).toHaveLength(4);
    expect(screen.getByTestId("strength")).toHaveTextContent("F1 Content Accuracy went well in her sessions (3.7/4).");
    expect(screen.getByTestId("focus-name")).toHaveTextContent("Student-to-Student Interaction");
    expect(screen.getByTestId("why")).toHaveTextContent("Why this one: The AI coach and the human coach both scored it low.");
    expect(screen.getByTestId("try-focus")).toHaveTextContent("TRY pair talk");
    expect(steps[3]).toHaveTextContent("Look at D3 together on your next visit.");
  });

  it("each why line names the test that picked the focus", async () => {
    const cases: [WhereToCoachData["focus"] extends infer F ? F extends { why: infer W } ? W : never : never, RegExp][] = [
      [{ test: 2, reason: "low", k: 5, n: 6, source: "dc" }, /Low in 5 of 6 DC observations\./],
      [{ test: 2, reason: "low", k: 2, n: 2, source: "coach" }, /Low in 2 of 2 coach observations\./],
      [{ test: 3, reason: "step", step: "You Do" }, /Linked to a step she often skips: You Do\./],
      [{ test: 4, reason: "lowest" }, /Her lowest-scoring practice this period\./],
    ];
    for (const [why, line] of cases) {
      await resetAll();
      net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
      const d = whereData();
      net.answers.set(`/coach/teacher/${EXT}/where?period=month`, { ...d, focus: { ...d.focus!, why } });
      const view = await open(`/portal/coach/teacher/${EXT}/where?period=month`);
      await waitFor(() => expect(screen.getByTestId("why")).toHaveTextContent(line));
      view.unmount();
    }
  });

  it("sections weakest first, Focus here and AI and coach differ; weakest practices with the focus's tip open", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData());
    await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.getByTestId("sections")).toBeInTheDocument());
    const secs = screen.getAllByTestId("section-row");
    expect(secs.map((s) => s.getAttribute("data-code"))).toEqual(["D", "C", "B", "F"]);
    expect(secs[0]).toHaveTextContent("Focus here");
    expect(secs[3]).toHaveTextContent("AI and coach differ");
    expect(secs[0]).toHaveTextContent("AI score");
    expect(secs[0]).toHaveTextContent("Coach score");
    const weak = screen.getAllByTestId("weak-row");
    expect(weak.map((w) => w.getAttribute("data-id"))).toEqual(["D3", "C1", "D1"]);
    expect(weak[0]).toHaveTextContent("Your focus");
    expect(weak[0]).toHaveTextContent("1.5/4");
    expect(weak[0]).toHaveTextContent("Low in 6 of 6 DC observations");
    expect(within(weak[0]).getByTestId("tip")).toHaveTextContent("LOOK pair talk");
    expect(within(weak[1]).queryByTestId("tip")).toBeNull();
    fireEvent.click(within(weak[1]).getByRole("button", { name: /What to try/ }));
    expect(within(weak[1]).getByTestId("tip")).toHaveTextContent("TRY why questions");
  });

  it("the check-in asks first; tapping a blocker shows its support line (not saved)", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData());
    await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.getByTestId("checkin")).toBeInTheDocument());
    const card = screen.getByTestId("checkin-card");
    expect(card).toHaveTextContent("Assessments");
    expect(card).toHaveTextContent("Not used this month");
    expect(card).toHaveTextContent("“How are you making your tests and exams?”");
    expect(within(card).queryByTestId("support")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Did not know about it" }));
    expect(within(card).getByTestId("support")).toHaveTextContent("Show where the exam generator is.");
    expect(net.calls.filter((c) => !c.startsWith("/config") && !c.includes("/where"))).toEqual([]);
  });

  it("nothing low: No check-in needed", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData({ checkin: { usage: { dc: 9, lp: 9, training: 2, papers: 2 }, items: [] } }));
    await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.getByTestId("checkin-none")).toHaveTextContent("She used every feature this month. No check-in needed."));
  });

  it("the plan, the AI coach's last advice, and her DC observations each opening the full report", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData());
    await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.getByTestId("plan")).toBeInTheDocument());
    expect(screen.getByTestId("plan")).toHaveTextContent("She followed 64% of the steps in her NIETE lesson plans. 4 of her 6 DC observations used a NIETE lesson plan.");
    expect(screen.getByTestId("skipped-step")).toHaveTextContent("You Do");
    expect(screen.getByTestId("skipped-step")).toHaveTextContent("3 of 4 plans");
    expect(screen.getByTestId("skipped-step")).toHaveTextContent("TRY practice activity");
    expect(screen.getByTestId("advice")).toHaveTextContent("“Before you take answers, give pairs one minute.”");
    expect(screen.getByTestId("advice")).toHaveTextContent("Reinforce the same message on your visit.");
    const rows = screen.getAllByTestId("session-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/portal/coach/session/s-6?period=month", "/portal/coach/session/s-5?period=month"]);
    expect(rows[0]).toHaveTextContent("Weakest: D");
    expect(rows[0]).toHaveTextContent("AI score 58%");
    expect(screen.getByTestId("more-sessions")).toHaveTextContent("+ 2 more this month");
  });

  it("one DC: the early-signal note; nothing at all: choose a longer period", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData({ signal: "early", sessions: { dc: 1, coach: 0 } }));
    const view = await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.getByTestId("signal")).toHaveTextContent("Based on one session — an early signal"));
    view.unmount();
    await resetAll();
    net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
    net.answers.set(`/coach/teacher/${EXT}/where?period=week`, whereData({
      signal: "empty", sessions: { dc: 0, coach: 0 }, sections: [], focus: null, weakest: [], strength: null, plan: null, lastAdvice: null, reports: [], moreReports: 0,
      period: { ...PERIOD, key: "week" },
    }));
    await open(`/portal/coach/teacher/${EXT}/where?period=week`);
    await waitFor(() => expect(screen.getByTestId("where-empty")).toHaveTextContent("Choose a longer period to see where to coach."));
    expect(screen.queryByTestId("convo")).toBeNull();
    expect(screen.getByTestId("checkin")).toBeInTheDocument();
  });

  it("Urdu: her words, the tips in Urdu, right to left", async () => {
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData());
    await open(`/portal/coach/teacher/${EXT}/where?period=month`, "ur");
    await waitFor(() => expect(screen.getByTestId("convo")).toBeInTheDocument());
    expect(screen.getByTestId("convo")).toHaveTextContent("بات چیت کی ترتیب");
    expect(screen.getByTestId("why")).toHaveTextContent("AI کوچ اور انسانی کوچ دونوں نے اسے کم اسکور دیا۔");
    expect(screen.getByTestId("try-focus")).toHaveTextContent("آزمائیں جوڑیاں");
    expect(screen.getAllByText("صرف آپ کے لیے · کبھی شیئر نہیں ہوتا").length).toBeGreaterThan(0);
  });

  it("switch off: the page is Not found and reads nothing", async () => {
    net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: false } });
    net.answers.set(`/coach/teacher/${EXT}/where?period=month`, whereData());
    await open(`/portal/coach/teacher/${EXT}/where?period=month`);
    await waitFor(() => expect(screen.queryByTestId("convo")).toBeNull());
    expect(net.calls.some((c) => c.includes("/where"))).toBe(false);
  });
});

describe("Who to coach first, one school (ours)", () => {
  it("groups in order with their counts; No low pattern starts folded; rows open that teacher's Where to coach", async () => {
    net.answers.set(`/coach/school/${EMIS}/first?period=month`, FIRST);
    await open(`/portal/coach/school/${EMIS}/first?period=month`);
    await waitFor(() => expect(screen.getAllByTestId("first-group").length).toBe(4));
    expect(screen.getAllByTestId("first-group").map((g) => g.getAttribute("data-group"))).toEqual(["agree_low", "low_most", "no_dc", "none"]);
    expect(screen.getAllByTestId("first-group")[0]).toHaveTextContent("You and the AI coach both scored it low");
    expect(screen.getAllByTestId("first-group")[2]).toHaveTextContent("No DC observation this month · ask what is in the way");
    const rows = screen.getAllByTestId("first-row");
    expect(rows.map((r) => r.getAttribute("data-ext"))).toEqual(["920000000001", "920000000002", "920000000003"]);
    expect(rows[0].getAttribute("href")).toBe("/portal/coach/teacher/920000000001/where?period=month");
    expect(rows[0]).toHaveTextContent("D3");
    expect(rows[1]).toHaveTextContent("Low in 5 of 6 DC observations");
    expect(rows[2]).toHaveTextContent("Last DC observation 41 days ago");
    fireEvent.click(screen.getByRole("button", { name: "Show 2" }));
    expect(screen.getAllByTestId("first-row")).toHaveLength(5);
    expect(screen.getByTestId("first-how")).toHaveTextContent("How this order is worked out");
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
  });

  it("Urdu", async () => {
    net.answers.set(`/coach/school/${EMIS}/first?period=month`, FIRST);
    await open(`/portal/coach/school/${EMIS}/first?period=month`, "ur");
    await waitFor(() => expect(screen.getAllByTestId("first-group")[0]).toHaveTextContent("آپ اور AI کوچ دونوں نے کم اسکور دیا"));
  });
});

describe("the words", () => {
  it("every English word has an Urdu one, none empty or still English", () => {
    expect(untranslated(WHERE, WHERE_COPY_ENTRY.same ?? [])).toEqual([]);
  });

  it("every value is a label, or a phrase allowed by name (her coaching lines are sentences by design)", () => {
    for (const lang of ["en", "ur"] as const) {
      const bad = collectCopy(WHERE[lang]).filter((c) => copyProblem(c.text))
        .filter((c) => !(WHERE_COPY_ENTRY.longOk ?? []).some((p) => c.path === p || c.path.startsWith(`${p}.`) || c.path.startsWith(`${p}(`) || c.path.startsWith(`${p}[`)))
        .map((c) => `${lang} ${c.path}: ${c.text}`);
      expect(bad).toEqual([]);
    }
  });

  it("is registered with the app's copy checks and the Urdu review list", () => {
    expect(COPY_MODULES.some((m) => m.module === WHERE_COPY_ENTRY.module)).toBe(true);
  });

  it("speaks the app's vocabulary: DC observations, coach observations, never HITL or DC sessions", () => {
    const all = [...collectCopy(WHERE.en), ...collectCopy(WHERE.ur)].map((c) => c.text).join(" | ");
    expect(all).not.toMatch(/HITL|DC sessions?\b/);
    expect(WHERE.en.whyLow(3, 4)).toBe("Low in 3 of 4 DC observations.");
  });
});

describe("the doors (coach only)", () => {
  it("her Teacher page has Where to coach →, Only you see this, opening This month", async () => {
    const { renderApp, loadApp } = await import("./harness.testdata");
    const fx = await import("./fixtures.testdata");
    await loadApp();
    net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true } });
    net.answers.set(`/coach/teacher/${fx.EXT}/card`, fx.teacherCard());
    await renderApp(`/portal/coach/teacher/${fx.EXT}`);
    const door = await screen.findByTestId("where-door");
    expect(door).toHaveTextContent("Where to coach");
    expect(door).toHaveTextContent("Only you see this");
    expect(door.getAttribute("href")).toBe(`/portal/coach/teacher/${fx.EXT}/where?period=month`);
  }, 120_000);
});
