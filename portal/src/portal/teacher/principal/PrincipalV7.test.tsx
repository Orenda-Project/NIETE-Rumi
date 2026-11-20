import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr.28 (queue #204, v6/v7 for principals) — the operator 20 Nov ~22:20: "Right now get the portal ready for
 * principal and the coaches both", and Godfather's note: the PRINCIPAL Home and Observations pages in the v6 look (#188's
 * boards p9-home, p7-observe, p7-pick, p9-observations). With the switch on for a principal on the principal app
 * (`features.principalFlowV2`):
 *
 *   Home             the NIETE band, then ONE Focus card (the observation waiting on her longest: the teacher, how long,
 *                    its status line, ONE button naming the next step, "N more waiting"), My school, and three tiles:
 *                    Observe (N waiting), Lesson Plans, Training
 *   Observe          Schedule an observation ("One of my teachers, or my own lesson"), Booked for today (Record), Needs
 *                    you (oldest first, two, then See all N), History (N in all) → My observations
 *   My observations  Teacher name search; Needs you; Done (no score on a row), her own lessons as "My own lesson"
 *   Pick             "One of my teachers" / "My own lesson" (her own lesson: Digital Coaching's New observation)
 *
 * Switch off: today's Home tiles and today's Observe (PrincipalV2Home / PrincipalV2Observe pin those).
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const coachApi = vi.hoisted(() => ({ getReports: vi.fn(), getSchedule: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
  language: { get: vi.fn(), set: vi.fn() },
  coach: coachApi,
}));
vi.mock("../../coach/flow/track", () => ({ trackFlow: vi.fn() }));

import api, { portal } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { AuthContext } from "../../hooks/authContext";
import { noticeTracker } from "../notices/tracker";
import { forgetConfig } from "../../lib/useNewUi";
import { resetHomeMemo } from "../home/api";
import { resetHomeLookMemory, resetHomeOrderMemory } from "../home/useHomeData";
import i18n from "@/i18n/config";
import Home from "../pages/Home";
import { PrincipalObservations } from "./PrincipalObservations";
import { PrincipalMyObservations } from "./ObserveV6";
import { PickTeacher } from "./PickTeacher";
import { teacherPath } from "../routes";
import { COACHING_NEW, lessonPath } from "../coaching/paths";
import { PRINCIPAL_MY_OBSERVATIONS, PRINCIPAL_PICK, principalCheckPath, principalObservationPath } from "./observe";

vi.setConfig({ testTimeout: 40_000 });

const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-v7", schoolName: "GGPS Sample" };
const ON = { teacherV2: true, principalApp: true, principalFlowV2: true };
const HOME = { success: true, now: new Date().toISOString(), order: null, orderOn: false, card: null, scores: { coach: null, observation: null }, quizHome: null };
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

const row = (id: string, name: string, step: string, ago: number, extra: Record<string, unknown> = {}) => ({
  id, createdAt: daysAgo(ago), teacherName: name, teacherPhone: null, teacherExtId: `ext-${id}`, schoolName: "GGPS Sample",
  schoolExtId: null, status: "x", step, score: step === "sent" ? 63 : null, portal: true, ...extra,
});
const WAITING = [row("r2", "Ambreen Gul", "talk", 3), row("r1", "Lubna Arif", "report", 17), row("r3", "Hira Noor", "draft", 1)];
const SENT = [row("r4", "Kiran Shahzadi", "sent", 4)];
const REPORTS = { success: true, waiting: WAITING, inProgress: [], all: { total: 9, page: 1, pageSize: 20, items: [...WAITING, ...SENT] } };
const VISIT = { id: "v1", teacherExtId: "ext-k", teacherName: "Kiran Shahzadi", schoolName: "GGPS Sample", schoolExtId: null, scheduledFor: TODAY, scheduledSlot: "10:30", status: "upcoming" };
const OWN = { success: true, items: [{ id: "dc1", date: daysAgo(6).slice(0, 10), topic: "Fractions", subject: "Maths", grade: 4, minutes: 35, percentage: 70, reportReady: true }], total: 1 };
const CARD = { success: true, school: { name: "GGPS Sample", emis: "123" }, overview: { teachers: 18, active: { now: 14 }, lp: { total: 3 }, training: { modules: 2 }, papers: { total: 1 } }, scores: { dc: { count: 4 } }, teachers: [{ teacherExtId: "ext-k", name: "Kiran Shahzadi", levels: [4], counts: null }] };

function serve({ features = ON as Record<string, unknown>, reports = REPORTS as unknown } = {}) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  coachApi.getReports.mockResolvedValue(reports);
  coachApi.getSchedule.mockResolvedValue({ success: true, visits: [VISIT], overdue: [] });
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: HOME });
    if (url === "/principal/school/card") return Promise.resolve({ data: CARD });
    if (url === "/teacher/coaching/history") return Promise.resolve({ data: OWN });
    if (url === "/coaching-upload/pending") return Promise.resolve({ data: { success: true, recordings: [] } });
    return Promise.resolve({ data: { success: true, items: [] } });
  }) as never);
}

function at(path: string, el: JSX.Element) {
  vi.mocked(useAuth).mockReturnValue({ user: PRINCIPAL, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <AuthContext.Provider value={{ user: PRINCIPAL, loading: false } as never}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={path.split("?")[0]} element={el} /></Routes></MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  forgetConfig();
  resetHomeMemo();
  resetHomeOrderMemory();
  resetHomeLookMemory();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("the principal's Home in the v6 look (p9-home)", () => {
  it("the Focus card: the observation waiting on her longest, its line, ONE button, N more waiting", async () => {
    serve();
    at("/portal/teacher", <Home />);
    const focus = await screen.findByTestId("focus-waiting");
    expect(within(focus).getByText("Waiting for you")).toBeTruthy();
    expect(within(focus).getByText("3")).toBeTruthy();
    // the oldest of the three (17 days), not the first the server sent
    expect(within(focus).getByText("Lubna Arif")).toBeTruthy();
    expect(within(focus).getByText(/17 days waiting/)).toBeTruthy();
    expect(await within(focus).findByTestId("status-line")).toBeTruthy();
    const go = within(focus).getByRole("link", { name: "Send the report" });
    expect(go.getAttribute("href")).toBe(principalObservationPath("r1"));
    expect(within(focus).getByRole("link", { name: /2 more waiting/ }).getAttribute("href")).toBe(PRINCIPAL_MY_OBSERVATIONS);
  });

  it("then My school, then three tiles: Observe (N waiting), Lesson Plans, Training", async () => {
    serve();
    at("/portal/teacher", <Home />);
    await screen.findByTestId("principal-home-v6");
    expect(await screen.findByTestId("my-school-card")).toBeTruthy();
    const nav = screen.getByTestId("feature-tiles");
    await waitFor(() => expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent?.replace(/\d+ waiting/, "").trim()))
      .toEqual(["Observe", "Lesson Plans", "Training"]));
    const observe = within(nav).getByText("Observe").closest("a");
    expect(observe?.getAttribute("href")).toBe(teacherPath("observations"));
    await waitFor(() => expect(within(observe as HTMLElement).getByText("3 waiting")).toBeTruthy());
  });

  it("nothing waiting and nothing booked: No visits booked today, and Schedule an observation (Pick)", async () => {
    serve({ reports: { ...REPORTS, waiting: [] } });
    coachApi.getSchedule.mockResolvedValue({ success: true, visits: [], overdue: [] });
    at("/portal/teacher", <Home />);
    const empty = await screen.findByTestId("focus-empty");
    expect(within(empty).getByText("No visits booked today")).toBeTruthy();
    expect(within(empty).getByRole("link", { name: /Schedule an observation/ }).getAttribute("href")).toBe(PRINCIPAL_PICK);
  });

  it("switch off: today's principal Home (no Focus card, today's tiles)", async () => {
    serve({ features: { teacherV2: true, principalApp: true } });
    at("/portal/teacher", <Home />);
    await screen.findByTestId("feature-tiles");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("principal-home-v6")).toBeNull();
    expect(screen.queryByTestId("focus-card")).toBeNull();
  });

  it("in Urdu: the Focus card's own words", async () => {
    serve();
    await act(async () => { await i18n.changeLanguage("ur"); });
    at("/portal/teacher", <Home />);
    const focus = await screen.findByTestId("focus-waiting");
    expect(within(focus).getByText("آپ کے منتظر")).toBeTruthy();
  });
});

describe("the principal's Observe in the v6 look (p7-observe)", () => {
  it("Schedule an observation, Booked for today with Record, Needs you (two, then See all), History", async () => {
    serve();
    at("/portal/teacher/observations", <PrincipalObservations />);
    const page = await screen.findByTestId("principal-observe-v6");
    const sched = within(page).getByRole("link", { name: /Schedule an observation/ });
    expect(sched.getAttribute("href")).toBe(PRINCIPAL_PICK);
    expect(within(page).getByText("One of my teachers, or my own lesson")).toBeTruthy();

    const booked = await within(page).findByTestId("booked-today");
    expect(await within(booked).findByText("Kiran Shahzadi")).toBeTruthy();
    expect(within(booked).getByRole("link", { name: /Record/ }).getAttribute("href")).toBe(`${principalCheckPath("ext-k")}/record`);

    const needs = await within(page).findByTestId("needs-you");
    const names = () => within(needs).getAllByRole("link").map((a) => a.textContent || "");
    expect(names().filter((t) => /Lubna|Ambreen|Hira/.test(t))).toHaveLength(2);
    expect(names()[0]).toMatch(/Lubna Arif/);
    expect(within(needs).getAllByRole("link")[0].getAttribute("href")).toBe(principalObservationPath("r1"));
    fireEvent.click(within(needs).getByRole("button", { name: /See all 3/ }));
    expect(names().filter((t) => /Lubna|Ambreen|Hira/.test(t))).toHaveLength(3);

    const history = within(page).getByRole("link", { name: /History/ });
    expect(history.getAttribute("href")).toBe(PRINCIPAL_MY_OBSERVATIONS);
    await waitFor(() => expect(within(history).getByText("9 in all")).toBeTruthy());
  });

  it("switch off: today's Observe (the tiles, her teachers' observations)", async () => {
    serve({ features: { teacherV2: true, principalApp: true } });
    at("/portal/teacher/observations", <PrincipalObservations />);
    await screen.findByTestId("principal-observe-tiles");
    expect(screen.queryByTestId("principal-observe-v6")).toBeNull();
  });

  it("in Urdu: the line under Schedule an observation", async () => {
    serve();
    await act(async () => { await i18n.changeLanguage("ur"); });
    at("/portal/teacher/observations", <PrincipalObservations />);
    expect(await screen.findByText("کسی ٹیچر کا سبق، یا میرا اپنا سبق")).toBeTruthy();
  });
});

describe("My observations (p9-observations)", () => {
  it("Needs you first (oldest first, with its step), then Done (no score), her own lesson as My own lesson", async () => {
    serve();
    at(PRINCIPAL_MY_OBSERVATIONS, <PrincipalMyObservations />);
    const needs = await screen.findByTestId("my-obs-needs");
    const needRows = within(needs).getAllByRole("link");
    expect(needRows.map((a) => a.textContent)).toEqual([
      expect.stringMatching(/Lubna Arif.*Report to send/), expect.stringMatching(/Ambreen Gul.*Debrief to do/), expect.stringMatching(/Hira Noor.*Form to fill/),
    ]);
    expect(needRows[0].getAttribute("href")).toBe(principalObservationPath("r1"));
    const done = await screen.findByTestId("my-obs-done");
    await waitFor(() => expect(within(done).getByText("My own lesson")).toBeTruthy());
    expect(within(done).getByText("Kiran Shahzadi")).toBeTruthy();
    expect(done.textContent).not.toMatch(/%/);
    expect(within(done).getAllByText("Done").length).toBeGreaterThan(0);
    expect(within(done).getByText("Kiran Shahzadi").closest("a")?.getAttribute("href")).toBe(principalObservationPath("r4"));
    expect(within(done).getByText("My own lesson").closest("a")?.getAttribute("href")).toBe(lessonPath("dc1"));
  });

  it("Teacher name finds one teacher's observations", async () => {
    serve();
    at(PRINCIPAL_MY_OBSERVATIONS, <PrincipalMyObservations />);
    await screen.findByTestId("my-obs-needs");
    fireEvent.change(screen.getByPlaceholderText("Teacher name"), { target: { value: "kiran" } });
    expect(screen.queryByTestId("my-obs-needs")).toBeNull();
    expect(within(screen.getByTestId("my-obs-done")).getByText("Kiran Shahzadi")).toBeTruthy();
    expect(screen.queryByText("Lubna Arif")).toBeNull();
  });

  it("switch off: the page is not there (back to Observe)", async () => {
    serve({ features: { teacherV2: true, principalApp: true } });
    at(PRINCIPAL_MY_OBSERVATIONS, <PrincipalMyObservations />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("my-obs")).toBeNull();
  });
});

describe("Pick the teacher, v6 (p7-pick)", () => {
  it("One of my teachers / My own lesson: her own lesson is Digital Coaching's New observation", async () => {
    serve();
    at(PRINCIPAL_PICK, <PickTeacher />);
    const choice = await screen.findByTestId("pick-whose");
    expect(within(choice).getByText("One of my teachers")).toBeTruthy();
    expect(within(choice).getByRole("link", { name: "My own lesson" }).getAttribute("href")).toBe(COACHING_NEW);
  });

  it("switch off: no choice row", async () => {
    serve({ features: { teacherV2: true, principalApp: true } });
    at(PRINCIPAL_PICK, <PickTeacher />);
    await screen.findByTestId("principal-pick");
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("pick-whose")).toBeNull();
  });
});
