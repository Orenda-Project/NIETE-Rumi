import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-33wxxi.10 — a principal's TEACHERS as a register in the app's own Attendance (listId "staff"; the server
 * lists it first, only for a principal the principal app is on for). The screens are the class screens with:
 *
 *   - the words a teachers' register needs ("8 teachers", "Search teacher", "Teachers", "All 8 teachers",
 *     "Teacher attendance", "Done") — from copy.ts, in English and Urdu;
 *   - a principal whose ONLY register is her teachers goes straight to the roll call (the hub is skipped, with
 *     replace, so Back does not bounce her into it); there Back is Home, the hub's View · Download pair sits on
 *     top (mockup option B), and Saved's button is Done → Home; View and Download go Back to the roll call;
 *   - a principal who also owns a class sees the hub with her teachers first, and every class screen as a teacher.
 *
 * A class teacher's screens are unchanged (and their own tests stay as they were).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import api from "../../services/api";
import { AttendanceHub } from "./AttendanceHub";
import { MarkPage } from "./MarkPage";
import { ViewPage } from "./ViewPage";
import { DownloadPage } from "./DownloadPage";
import { ATTENDANCE_STAFF_COPY, ATTENDANCE_STAFF_COPY_UR, COPY_ENTRIES } from "./copy";
import { ATTENDANCE_V2_BASE as B, downloadPath, markPath, viewPath } from "./paths";
import { TEACHER_BASE } from "../paths";
import { collectCopy, copyProblem } from "../../newui/checks/rules";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const plain = (t: string | null) => (t || "").replace(/[⁦⁩]/g, "");

const NAMES = ["Ayesha Sample", "Farah Sample", "Nadia Sample", "Hina Sample", "Maria Sample", "Rabia Sample", "Sana Sample", "Zainab Sample"];
const STAFF = { listId: "staff", label: "GGPS Sample", grade: null, section: null, subjects: [], students: 8, marked: false, present: null, absent: null, leave: null };
const HER_CLASS = { listId: "11111111-1111-4111-8111-111111111111", label: "Grade 5 - A", grade: 5, section: "A", subjects: ["Mathematics"], students: 32, marked: true, present: 30, absent: 2, leave: 0 };
const PEOPLE = NAMES.map((name, i) => ({ id: `u-${i}`, name, roll: null, present: 6, marked: 6, pct: 100 }));

let classes: unknown[] = [STAFF];
beforeEach(async () => {
  vi.clearAllMocks();
  classes = [STAFF];
  http.get.mockImplementation((url: string) => {
    if (url.endsWith("/roster")) return Promise.resolve({ data: { listId: "staff", label: "GGPS Sample", students: NAMES.map((name, i) => ({ id: `u-${i}`, name, roll: null })) } });
    if (url.endsWith("/day")) return Promise.resolve({ data: { date: "2026-11-10", marked: false, present: null, absent: null, leave: null, statuses: {} } });
    if (url.endsWith("/month")) return Promise.resolve({ data: { month: "2026-11", days: [{ date: "2026-11-09", present: 7, absent: 0, leave: 1, total: 7 }], students: PEOPLE } });
    return Promise.resolve({ data: { date: "2026-11-10", classes } });
  });
  http.post.mockResolvedValue({ data: { date: "2026-11-10", present: 7, absent: 1, leave: 0, replaced: false } });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

const app = (at: string) => render(
  <MemoryRouter initialEntries={[at]}>
    <Routes>
      <Route path={TEACHER_BASE} element={<Where />} />
      <Route path={B} element={<AttendanceHub />} />
      <Route path={`${B}/:listId/mark`} element={<MarkPage />} />
      <Route path={`${B}/:listId/view`} element={<ViewPage />} />
      <Route path={`${B}/:listId/download`} element={<DownloadPage />} />
    </Routes>
  </MemoryRouter>,
);

const backHref = () => screen.getByLabelText("Back").getAttribute("href");
/** The roll call has read the day too (a day that loads after Save resets the page, as it should for a new day). */
const settled = async () => {
  await waitFor(() => expect(http.get.mock.calls.some(([u]) => String(u).endsWith("/day"))).toBe(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const crumb = () => screen.getByTestId("page-crumb").textContent;

describe("a principal whose only register is her teachers", () => {
  it("Attendance opens straight on her teachers' roll call", async () => {
    app(B);
    expect(await screen.findByText("Ayesha Sample")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mark attendance");
    expect(screen.getByPlaceholderText("Search teacher")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search student")).toBeNull();
    expect(screen.queryByText("No classes yet")).toBeNull();
  });

  it("the roll call: Back is Home, and View · Download sit on top (option B)", async () => {
    app(markPath("staff"));
    await screen.findByText("Ayesha Sample");
    expect(backHref()).toBe(TEACHER_BASE);
    expect(crumb()).toBe("Home");
    expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe(viewPath("staff"));
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(downloadPath("staff"));
  });

  it("Saved: Done goes Home (never Next class)", async () => {
    app(markPath("staff"));
    await screen.findByText("Ayesha Sample");
    await settled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(http.post).toHaveBeenCalledWith("/teacher/attendance/classes/staff/mark", { date: "2026-11-10", absentIds: [], leaveIds: [] });
    const done = await screen.findByRole("button", { name: "Done" });
    expect(screen.queryByText("Next class")).toBeNull();
    await act(async () => { fireEvent.click(done); });
    expect(screen.getByTestId("where").textContent).toBe(TEACHER_BASE);
  });

  it("the month view: teachers' words, Back to the roll call", async () => {
    app(viewPath("staff"));
    expect(await screen.findByText("Teachers")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Teacher attendance");
    expect(screen.getByText("All 8 teachers")).toBeTruthy();
    expect(screen.queryByText("Students")).toBeNull();
    expect(backHref()).toBe(markPath("staff"));
    expect(crumb()).toBe("Mark attendance");
  });

  it("the register download: Back to the roll call; the card names her teachers", async () => {
    app(downloadPath("staff"));
    expect(await screen.findByText("8 teachers")).toBeTruthy();
    expect(screen.getAllByText("Teacher attendance").length).toBeGreaterThan(0);
    expect(backHref()).toBe(markPath("staff"));
    expect(crumb()).toBe("Mark attendance");
  });
});

describe("a principal who also owns a class", () => {
  beforeEach(() => { classes = [STAFF, HER_CLASS]; });

  it("the hub: her teachers first (named for what they are), then her class as a teacher sees it", async () => {
    app(B);
    expect(await screen.findByText("8 teachers")).toBeTruthy();
    expect(screen.getByText("32 students")).toBeTruthy();
    const rows = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(rows).toContain(markPath("staff"));
    expect(rows).toContain(markPath(HER_CLASS.listId));
    expect(plain(document.body.textContent)).toContain("Teacher attendance");
    expect(plain(document.body.textContent)).not.toContain("GGPS Sample");
  });

  it("her teachers' roll call is a register among others: Back to the hub, Saved offers Next class", async () => {
    classes = [STAFF, { ...HER_CLASS, marked: false }];
    app(markPath("staff"));
    await screen.findByText("Ayesha Sample");
    expect(backHref()).toBe(B);
    expect(screen.getByPlaceholderText("Search teacher")).toBeTruthy();
    await settled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(await screen.findByRole("button", { name: "Next class" })).toBeTruthy();
  });

  it("her class's roll call says students, exactly as a teacher's", async () => {
    http.get.mockImplementation((url: string) => {
      if (url.endsWith("/roster")) return Promise.resolve({ data: { listId: HER_CLASS.listId, label: "Grade 5 - A", students: [{ id: "s1", name: "Ali Raza", roll: 1 }] } });
      if (url.endsWith("/day")) return Promise.resolve({ data: { date: "2026-11-10", marked: false, present: null, absent: null, leave: null, statuses: {} } });
      return Promise.resolve({ data: { date: "2026-11-10", classes } });
    });
    app(markPath(HER_CLASS.listId));
    await screen.findByText("Ali Raza");
    expect(screen.getByPlaceholderText("Search student")).toBeTruthy();
    expect(backHref()).toBe(B);
  });
});

describe("a class teacher: unchanged", () => {
  it("the hub stays the hub (no redirect) and says students", async () => {
    classes = [HER_CLASS];
    app(B);
    expect(await screen.findByText("32 students")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Attendance");
    expect(screen.queryByText(/teachers/i)).toBeNull();
  });

  it("no classes at all: still No classes yet", async () => {
    classes = [];
    app(B);
    expect(await screen.findByText("No classes yet")).toBeTruthy();
  });
});

describe("the teachers' words", () => {
  it("in Urdu on the roll call", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    app(markPath("staff"));
    await screen.findByText("Ayesha Sample");
    expect(screen.getByPlaceholderText(ATTENDANCE_STAFF_COPY_UR.searchStudent)).toBeTruthy();
    expect(ATTENDANCE_STAFF_COPY_UR.searchStudent).toBe("ٹیچر ڈھونڈیں");
    expect(ATTENDANCE_STAFF_COPY_UR.students(8)).toBe("8 ٹیچرز");
  });

  it("are labels (at most 4 words, no sentence), registered for the Urdu completeness checks", () => {
    const bad = collectCopy(ATTENDANCE_STAFF_COPY).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
    expect(COPY_ENTRIES.map((e) => e.screen)).toContain("Attendance: teachers");
  });
});
