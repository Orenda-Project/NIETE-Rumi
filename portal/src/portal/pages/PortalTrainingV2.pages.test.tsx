/**
 * bd-klecr — one page per step: Training → Provider → Level → Course → Unit,
 * plus a Certificates page off Training.
 *
 * Operator, 2026-10-02: picking a provider opened its training UNDER the cards
 * on the same page. Each step now navigates to its own URL, so the browser's
 * Back works, a link can be shared, and the breadcrumb walks back up one step
 * at a time. Every page always renders, even when there is only one provider,
 * level or course to choose (operator: "every page should always show"), which
 * is why the old auto-select assertions were replaced rather than kept.
 *
 * The routes are mounted from TRAINING_V2_PATHS, the same list App.tsx uses,
 * so a path the page navigates to that the app does not serve fails here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTrainingV2 from "./PortalTrainingV2";
import { TRAINING_V2_PATHS } from "../lib/trainingRoutes";

const VENDORS = [
  { vendor_key: "TALEEMABAD", vendor_name: "NIETE", level_count: 2, course_count: 2, module_count: 20, completed_module_count: 5, certificate_count: 2, avg_score_pct: null },
  { vendor_key: "OXBRIDGE", vendor_name: "Oxbridge", level_count: 1, course_count: 1, module_count: 7, completed_module_count: 7, certificate_count: 1, avg_score_pct: null },
  { vendor_key: "BEACONHOUSE", vendor_name: "Beacon House", level_count: 1, course_count: 1, module_count: 12, completed_module_count: 0, certificate_count: 0, avg_score_pct: null },
];

function level(id: number, name: string, vendor_key: string, order_index: number, state = "in_progress") {
  return {
    id, name, order_index, cpd_level: null, vendor_key, unlock_logic: "chain", state,
    module_count: 10, completed_count: 2, courses_total: 2, courses_completed: 0,
    passed_at: null, cooldown_until: null, previous_level_order: order_index > 0 ? order_index - 1 : null,
  };
}
const LEVELS = [
  level(1, "Aspiring Teacher", "TALEEMABAD", 0),
  level(2, "Emerging Practitioner", "TALEEMABAD", 1, "locked"),
  level(17, "Game-Based Teaching", "OXBRIDGE", 0),
  level(18, "English", "BEACONHOUSE", 0),
];
const COURSES = [
  { id: "c-1", title: "Planning a lesson", level_id: 1, module_count: 2, completed_count: 1 },
  { id: "c-2", title: "Checking for understanding", level_id: 1, module_count: 2, completed_count: 0 },
];
const MODULES = [
  { id: "m-1", title: "Learning objectives", course_id: "c-1", duration_seconds: 0, completed_at: null, has_questions: true },
  { id: "m-2", title: "I Do, We Do, You Do", course_id: "c-1", duration_seconds: 0, completed_at: null, has_questions: true },
];
const CERTS = [
  { id: "a", certificate_code: "NIETE-1", level_name: "Aspiring Teacher", vendor_key: "TALEEMABAD", vendor_name: "NIETE", issued_at: "2026-09-28T00:00:00Z", has_pdf: true, download_url: "/api/portal/training/certificates/NIETE-1/download" },
  { id: "b", certificate_code: "NIETE-2", level_name: "Foundations", vendor_key: "TALEEMABAD", vendor_name: "NIETE", issued_at: "2026-08-14T00:00:00Z", has_pdf: true, download_url: "/api/portal/training/certificates/NIETE-2/download" },
  { id: "c", certificate_code: "NIETE-3", level_name: "Game-Based Teaching", vendor_key: "OXBRIDGE", vendor_name: "Oxbridge", issued_at: "2026-09-21T00:00:00Z", has_pdf: true, download_url: "/api/portal/training/certificates/NIETE-3/download" },
];

let certs: unknown[] = CERTS;
let courses: unknown[] = COURSES;

beforeEach(() => {
  vi.clearAllMocks();
  certs = CERTS;
  courses = COURSES;
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: VENDORS } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: LEVELS } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: certs } });
    if (url === "/training/courses") return Promise.resolve({ data: { courses } });
    if (url === "/training/modules") return Promise.resolve({ data: { modules: MODULES, exam: null } });
    if (url === "/training/module/m-2")
      return Promise.resolve({ data: { module: { ...MODULES[1], course: { id: "c-1", title: "Planning a lesson" }, level: { id: 1, name: "Aspiring Teacher" }, completed_at: null } } });
    if (/^\/training\/module\/.+\/attempts$/.test(url)) return Promise.resolve({ data: { attempts: [] } });
    return Promise.resolve({ data: {} });
  });
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_V2_PATHS.map(p => <Route key={p} path={p} element={<PortalTrainingV2 />} />)}
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;

describe("Training page — provider cards only", () => {
  it("shows the cards and nothing from any provider beneath them", async () => {
    renderAt("/portal/training");
    expect(await screen.findByTestId("vendor-card-TALEEMABAD")).toBeInTheDocument();
    expect(screen.queryByTestId("level-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("course-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vendor-certificates")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vendor-prompt")).not.toBeInTheDocument();
  });

  it("opens the provider on its OWN page when a card is clicked", async () => {
    renderAt("/portal/training");
    await userEvent.click(await screen.findByTestId("vendor-card-TALEEMABAD"));
    expect(where()).toBe("/portal/training/provider/TALEEMABAD");
    expect(await screen.findByTestId("level-card-1")).toBeInTheDocument();
    expect(screen.queryByTestId("vendor-grouping")).not.toBeInTheDocument();
  });

  it("does not skip the card page for a teacher with one provider", async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === "/training/vendors") return Promise.resolve({ data: { vendors: [VENDORS[0]] } });
      if (url === "/training/levels") return Promise.resolve({ data: { levels: LEVELS.slice(0, 2) } });
      if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
      return Promise.resolve({ data: {} });
    });
    renderAt("/portal/training");
    expect(await screen.findByTestId("vendor-card-TALEEMABAD")).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    expect(where()).toBe("/portal/training");
    expect(screen.queryByTestId("level-card-1")).not.toBeInTheDocument();
  });

  it("puts a Certificates button in the header with the earned count", async () => {
    renderAt("/portal/training");
    const btn = await screen.findByTestId("certificates-button");
    await waitFor(() => expect(btn).toHaveTextContent("3"));
    await userEvent.click(btn);
    expect(where()).toBe("/portal/training/certificates");
  });

  it("shows the button with 0 when nothing is earned yet", async () => {
    certs = [];
    renderAt("/portal/training");
    const btn = await screen.findByTestId("certificates-button");
    await waitFor(() => expect(btn).toHaveTextContent("0"));
  });
});

describe("Provider page — that provider's levels only", () => {
  it("lists only this provider's levels, with a breadcrumb back to Training", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    expect(await screen.findByTestId("level-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("level-card-2")).toBeInTheDocument();
    expect(screen.queryByTestId("level-card-17")).not.toBeInTheDocument();
    expect(screen.queryByTestId("course-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vendor-card-TALEEMABAD")).not.toBeInTheDocument();

    const crumb = screen.getByTestId("training-breadcrumb");
    expect(crumb).toHaveTextContent("NIETE");
    await userEvent.click(within(crumb).getByTestId("breadcrumb-training"));
    expect(where()).toBe("/portal/training");
  });

  // Operator, 2026-10-02: the level card counted MODULES ("0 / 55 modules" on
  // Beacon House English), but what a level holds, and what its next page
  // shows, is courses. The bot's own level line already counts courses.
  it("counts a level's courses on its card, not its modules", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    const card = await screen.findByTestId("level-card-1");
    expect(card).toHaveTextContent("0 / 2 courses");
    expect(card).not.toHaveTextContent("modules");
  });

  it("says a certified level's courses are all done", async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === "/training/vendors") return Promise.resolve({ data: { vendors: VENDORS } });
      if (url === "/training/levels")
        return Promise.resolve({ data: { levels: [{ ...LEVELS[2], state: "certified", courses_completed: 1, courses_total: 1 }] } });
      if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
      return Promise.resolve({ data: {} });
    });
    renderAt("/portal/training/provider/OXBRIDGE");
    const card = await screen.findByTestId("level-card-17");
    expect(card).toHaveTextContent("Certified · 1/1 courses");
  });

  it("still shows a provider's single level as a card", async () => {
    renderAt("/portal/training/provider/OXBRIDGE");
    expect(await screen.findByTestId("level-card-17")).toBeInTheDocument();
    expect(where()).toBe("/portal/training/provider/OXBRIDGE");
  });

  it("opens a level on its own page; a locked level does not open", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    expect(await screen.findByTestId("level-card-2")).toBeDisabled();
    await userEvent.click(screen.getByTestId("level-card-1"));
    expect(where()).toBe("/portal/training/provider/TALEEMABAD/level/1");
  });
});

describe("Level page — that level's courses only", () => {
  it("lists the courses as cards and no modules", async () => {
    renderAt("/portal/training/provider/TALEEMABAD/level/1");
    expect(await screen.findByTestId("course-card-c-1")).toBeInTheDocument();
    expect(screen.getByTestId("course-card-c-2")).toBeInTheDocument();
    expect(screen.queryByTestId("module-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("level-card-1")).not.toBeInTheDocument();
    const crumb = screen.getByTestId("training-breadcrumb");
    expect(crumb).toHaveTextContent("NIETE");
    expect(crumb).toHaveTextContent("Aspiring Teacher");
  });

  it("still shows a single course as a card instead of opening it", async () => {
    courses = [COURSES[0]];
    renderAt("/portal/training/provider/TALEEMABAD/level/1");
    expect(await screen.findByTestId("course-card-c-1")).toBeInTheDocument();
    expect(screen.queryByTestId("module-list")).not.toBeInTheDocument();
    expect((api.get as any).mock.calls.some(([u]: [string]) => u === "/training/modules")).toBe(false);
  });

  it("opens a course on its own page, and the provider crumb goes back one step", async () => {
    renderAt("/portal/training/provider/TALEEMABAD/level/1");
    await userEvent.click(await screen.findByTestId("course-card-c-1"));
    expect(where()).toBe("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
  });
});

// Operator, 2026-10-02: the "Receive certificate" row came off the level page
// for providers whose certificate is issued on passing (NIETE's level exam,
// Beacon House's capstone, Oxbridge's quiz scores) — there it was only a
// fallback. I-SAPS keeps its card: it has no level exam, the card tracks its
// module exams, and it is how a held written-answer result is collected.
describe("Level page — the certificate row", () => {
  function mockWithCertState(levels: unknown[], vendors: unknown[]) {
    (api.get as any).mockImplementation((url: string) => {
      if (url === "/training/vendors") return Promise.resolve({ data: { vendors } });
      if (url === "/training/levels") return Promise.resolve({ data: { levels } });
      if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
      if (url === "/training/courses") return Promise.resolve({ data: { courses: COURSES } });
      if (/^\/training\/level\/\d+\/certificate$/.test(url))
        return Promise.resolve({ data: { success: true, state: "locked", certificate: null, units_total: 10, units_done: 2, exams_total: url.includes("/27/") ? 9 : 0, exams_done: 3 } });
      return Promise.resolve({ data: {} });
    });
  }

  it("is not shown on a NIETE level", async () => {
    mockWithCertState(LEVELS, VENDORS);
    renderAt("/portal/training/provider/TALEEMABAD/level/1");
    expect(await screen.findByTestId("course-card-c-1")).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByTestId("level-certificate-claim")).not.toBeInTheDocument();
    expect(screen.queryByText(/Receive certificate/i)).not.toBeInTheDocument();
  });

  it("is not shown on a Beacon House or Oxbridge level", async () => {
    mockWithCertState(LEVELS, VENDORS);
    for (const [vendor, id] of [["BEACONHOUSE", 18], ["OXBRIDGE", 17]] as const) {
      const { unmount } = renderAt(`/portal/training/provider/${vendor}/level/${id}`);
      expect(await screen.findByTestId("course-card-c-1")).toBeInTheDocument();
      await new Promise(r => setTimeout(r, 30));
      expect(screen.queryByTestId("level-certificate-claim")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("keeps the I-SAPS module-exam certificate card", async () => {
    mockWithCertState(
      [...LEVELS, level(27, "Level 1: Novice", "ISAPS", 0)],
      [...VENDORS, { vendor_key: "ISAPS", vendor_name: "I-SAPS", level_count: 1, course_count: 9, module_count: 54, completed_module_count: 3, certificate_count: 0, avg_score_pct: null }],
    );
    renderAt("/portal/training/provider/ISAPS/level/27");
    expect(await screen.findByTestId("level-certificate-card")).toHaveTextContent("3 of 9 module exams passed");
  });
});

describe("Course page — that course's modules", () => {
  it("lists the modules, and the crumbs walk back up", async () => {
    renderAt("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
    expect(await screen.findByTestId("module-item-m-1")).toBeInTheDocument();
    expect(screen.queryByTestId("course-card-c-2")).not.toBeInTheDocument();
    const crumb = screen.getByTestId("training-breadcrumb");
    expect(crumb).toHaveTextContent("Planning a lesson");
    await userEvent.click(within(crumb).getByTestId("breadcrumb-level"));
    expect(where()).toBe("/portal/training/provider/TALEEMABAD/level/1");
  });

  it("opens a module on the existing unit page", async () => {
    renderAt("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
    await userEvent.click(await screen.findByTestId("module-item-m-2"));
    expect(where()).toBe("/portal/training/unit/m-2");
  });
});

describe("Unit page — breadcrumb names every step", () => {
  it("names provider, level and course, and the course crumb returns to the course page", async () => {
    renderAt("/portal/training/unit/m-2");
    const crumb = await screen.findByTestId("unit-breadcrumb");
    await waitFor(() => expect(crumb).toHaveTextContent("NIETE"));
    expect(crumb).toHaveTextContent("Aspiring Teacher");
    expect(crumb).toHaveTextContent("Planning a lesson");
    await userEvent.click(within(crumb).getByTestId("breadcrumb-course"));
    expect(where()).toBe("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
  });
});

// Operator, 2026-10-02 (sandbox): finished the last Beacon House English
// module, the course card read 10/10, and the level card still read 4/5. The
// database held 55/55. The levels were read once, on first load, and walking
// back up the breadcrumb never asked again. Each page re-reads what it shows.
describe("Counts are current when you walk back up", () => {
  let levelsNow: unknown[];
  let coursesNow: unknown[];
  let vendorsNow: unknown[];
  beforeEach(() => {
    levelsNow = LEVELS;
    coursesNow = COURSES;
    vendorsNow = VENDORS;
    (api.get as any).mockImplementation((url: string) => {
      if (url === "/training/vendors") return Promise.resolve({ data: { vendors: vendorsNow } });
      if (url === "/training/levels") return Promise.resolve({ data: { levels: levelsNow } });
      if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
      if (url === "/training/courses") return Promise.resolve({ data: { courses: coursesNow } });
      if (url === "/training/modules") return Promise.resolve({ data: { modules: MODULES, exam: null } });
      if (/^\/training\/module\/.+\/attempts$/.test(url)) return Promise.resolve({ data: { attempts: [] } });
      return Promise.resolve({ data: {} });
    });
  });
  const calls = (u: string) => (api.get as any).mock.calls.filter(([x]: [string]) => x === u).length;

  it("re-reads the levels when you go back to the provider page", async () => {
    renderAt("/portal/training/provider/TALEEMABAD/level/1");
    expect(await screen.findByTestId("course-card-c-1")).toBeInTheDocument();
    // The teacher finishes a course meanwhile.
    levelsNow = LEVELS.map(l => (l as { id: number }).id === 1 ? { ...(l as object), courses_completed: 1 } : l);
    await userEvent.click(within(screen.getByTestId("training-breadcrumb")).getByTestId("breadcrumb-vendor"));
    await waitFor(() => expect(screen.getByTestId("level-card-1")).toHaveTextContent("1 / 2 courses"));
  });

  it("re-reads the courses when you go back to the level page", async () => {
    renderAt("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
    expect(await screen.findByTestId("module-item-m-1")).toBeInTheDocument();
    coursesNow = COURSES.map(c => c.id === "c-1" ? { ...c, completed_count: 2 } : c);
    await userEvent.click(within(screen.getByTestId("training-breadcrumb")).getByTestId("breadcrumb-level"));
    await waitFor(() => expect(screen.getByTestId("course-card-c-1")).toHaveTextContent("2 / 2 modules"));
  });

  it("re-reads the provider cards when you go back to Training", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    expect(await screen.findByTestId("level-card-1")).toBeInTheDocument();
    vendorsNow = VENDORS.map(v => v.vendor_key === "TALEEMABAD" ? { ...v, completed_module_count: 20 } : v);
    await userEvent.click(within(screen.getByTestId("training-breadcrumb")).getByTestId("breadcrumb-training"));
    await waitFor(() => expect(screen.getByTestId("vendor-card-TALEEMABAD")).toHaveTextContent("100%"));
  });

  it("does not ask twice on first load", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    expect(await screen.findByTestId("level-card-1")).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    expect(calls("/training/levels")).toBe(1);
    expect(calls("/training/vendors")).toBe(1);
  });
});

// Operator, 2026-10-02 (sandbox, 923449320536): finished the last unit of
// I-SAPS Module 1. The database had all 6 units complete, but back on the
// course page the unit had no tick and the module exam was still locked. The
// module list and the exam gate were read once per course and never again.
describe("The course page is current when you come back to it", () => {
  const LOCKED = { available: false, body: "Finish every unit to unlock the module exam.", caption: "", cta: "🔒 Locked", module_no: 1 };
  const OPEN = { available: true, body: "Module 1 exam", caption: "", cta: "Start the module exam", module_no: 1 };
  let modulesNow: unknown[];
  let examNow: unknown;
  beforeEach(() => {
    modulesNow = MODULES;
    examNow = LOCKED;
    (api.get as any).mockImplementation((url: string) => {
      if (url === "/training/vendors") return Promise.resolve({ data: { vendors: VENDORS } });
      if (url === "/training/levels") return Promise.resolve({ data: { levels: LEVELS } });
      if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
      if (url === "/training/courses") return Promise.resolve({ data: { courses: COURSES } });
      if (url === "/training/modules") return Promise.resolve({ data: { modules: modulesNow, exam: examNow } });
      if (url === "/training/module/m-2")
        return Promise.resolve({ data: { module: { ...MODULES[1], course: { id: "c-1", title: "Planning a lesson" }, level: { id: 1, name: "Aspiring Teacher" } } } });
      if (/^\/training\/module\/.+\/attempts$/.test(url)) return Promise.resolve({ data: { attempts: [] } });
      return Promise.resolve({ data: {} });
    });
  });
  const finishUnit = () => {
    modulesNow = MODULES.map(m => m.id === "m-2" ? { ...m, completed_at: "2026-10-02T11:52:16Z" } : m);
    examNow = OPEN;
  };
  const calls = (u: string) => (api.get as any).mock.calls.filter(([x]: [string]) => x === u).length;

  async function openUnitFromCourse() {
    renderAt("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
    expect(await screen.findByTestId("module-item-m-2")).toHaveAttribute("data-done", "false");
    expect(screen.getByTestId("module-exam-locked")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("module-item-m-2"));
    expect(await screen.findByRole("heading", { name: "I Do, We Do, You Do" })).toBeInTheDocument();
    finishUnit();
  }
  async function expectCurrent() {
    await waitFor(() => expect(screen.getByTestId("module-item-m-2")).toHaveAttribute("data-done", "true"));
    expect(screen.getByTestId("module-exam-start")).toBeInTheDocument();
    expect(screen.queryByTestId("module-exam-locked")).not.toBeInTheDocument();
  }

  it("via the course crumb", async () => {
    await openUnitFromCourse();
    await userEvent.click(within(screen.getByTestId("unit-breadcrumb")).getByTestId("breadcrumb-course"));
    await expectCurrent();
  });

  it("via Back to modules", async () => {
    await openUnitFromCourse();
    await userEvent.click(screen.getByTestId("unit-back"));
    await expectCurrent();
  });

  it("does not ask for the modules twice on first load", async () => {
    renderAt("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
    expect(await screen.findByTestId("module-item-m-2")).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    expect(calls("/training/modules")).toBe(1);
  });
});

describe("Certificates page", () => {
  it("offers All plus a chip per provider that has a certificate, and filters by it", async () => {
    renderAt("/portal/training/certificates");
    expect(await screen.findByTestId("cert-chip-all")).toHaveTextContent("3");
    expect(screen.getByTestId("cert-chip-TALEEMABAD")).toHaveTextContent("2");
    expect(screen.getByTestId("cert-chip-OXBRIDGE")).toHaveTextContent("1");
    // No certificate from Beacon House, so no chip for it.
    expect(screen.queryByTestId("cert-chip-BEACONHOUSE")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("certificate-row")).toHaveLength(3);

    await userEvent.click(screen.getByTestId("cert-chip-OXBRIDGE"));
    const rows = screen.getAllByTestId("certificate-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Game-Based Teaching");
    // View + Download stay, as before.
    expect(within(rows[0]).getByTestId("certificate-download")).toBeInTheDocument();
  });

  it("labels each certificate with its provider under All", async () => {
    renderAt("/portal/training/certificates");
    const rows = await screen.findAllByTestId("certificate-row");
    expect(rows[2]).toHaveTextContent("Oxbridge");
  });

  it("says none are earned yet when there are none", async () => {
    certs = [];
    renderAt("/portal/training/certificates");
    expect(await screen.findByTestId("certificates-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("vendor-card-TALEEMABAD")).not.toBeInTheDocument();
  });

  it("is served under /v2 too, and its crumb returns to /v2", async () => {
    renderAt("/portal/training/v2/certificates");
    expect(await screen.findByTestId("cert-chip-all")).toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId("training-breadcrumb")).getByTestId("breadcrumb-training"));
    expect(where()).toBe("/portal/training/v2");
  });
});
