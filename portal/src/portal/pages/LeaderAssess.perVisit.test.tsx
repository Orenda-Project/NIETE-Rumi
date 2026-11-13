import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Children per visit (sa_per_visit): a list the server drew at another size than 5 says so (`perVisit`), and the
// visit bar counts against it ("0/3"). A list with no size is counted against 5, as before.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn(), mintLink: vi.fn(), getSwitches: vi.fn(), addChild: vi.fn() },
}));

import { portal, childTestSa } from "../services/api";
import LeaderAssess from "./LeaderAssess";

const api = childTestSa as any;
const FIRST = ["Ayan", "Bilal", "Dua", "Esha", "Fiza"];
const child = (n: number) => ({
  drawId: `d${n}`, name: `${FIRST[n - 1]} Testwala`, nameUr: null, firstName: FIRST[n - 1], firstNameUr: null, grade: 3, section: "A",
  classLabel: "Grade 3 - A", classLabelUr: null, teacherName: "Saima Testwala", status: "listed", childNo: n, role: "new", namesake: false,
});
const BASE = { visit: { visitId: "v2", visitKey: null }, cycleId: "C1", grade: 3, gradeFallback: false, reused: false };
const SW = { handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false };

function setLang(lang: "en" | "ur") {
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", lang); } catch { /* none */ }
}

beforeEach(() => {
  vi.clearAllMocks();
  setLang("en");
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSchools.mockResolvedValue({ schools: [{ schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true }] });
  api.getSwitches.mockResolvedValue(SW);
});

async function open(list: any, first = "Ayan Testwala") {
  api.getList.mockResolvedValue({ list });
  render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("assess-school-s2"));
  const ready = screen.queryByTestId("assess-preflight-ready");
  if (ready) fireEvent.click(ready);
  await screen.findAllByText(first);
}

describe("LeaderAssess: children per visit", () => {
  it("a list drawn at 3: three children, two alternates, the bar reads 0/3", async () => {
    await open({ ...BASE, perVisit: 3, children: [1, 2, 3].map(child), alternates: [child(4), child(5)] });
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("Children done 0/3");
  });

  it("Urdu: the bar reads ۰/۳", async () => {
    setLang("ur");
    await open({ ...BASE, perVisit: 3, children: [1, 2, 3].map(child), alternates: [child(4), child(5)] });
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("۰/۳");
  });

  it("a list with no size (drawn at 5, or before the switch): counted against 5 as before, even with 3 on it", async () => {
    await open({ ...BASE, children: [1, 2, 3].map(child), alternates: [] });
    expect(screen.getByTestId("assess-visit-bar")).toHaveTextContent("Children done 0/5");
  });
});

// The visit clock follows the list: a list of three is 3 × 20 min = 60:00; a list with no size keeps 45:00. The
// resume/repick sitting stays 90 minutes whatever the list.
const MIN = 60 * 1000;
const ago = (m: number) => new Date(Date.now() - m * MIN).toISOString();
const timeText = () => screen.getByTestId("assess-visit-bar").querySelector("div > span:last-child") as HTMLElement;

describe("LeaderAssess: the visit clock follows the list size", () => {
  it("a list of three: / 60:00, not red at 50:00", async () => {
    const first = { ...child(1), sessionStartedAt: ago(50) };
    await open({ ...BASE, perVisit: 3, children: [first, child(2), child(3)], alternates: [child(4), child(5)] });
    expect(timeText()).toHaveTextContent(/^Time 50:0\d \/ 60:00$/);
    expect(timeText().className).not.toContain("text-red-700");
  });

  it("a list of three: red at 61:00", async () => {
    const first = { ...child(1), sessionStartedAt: ago(61) };
    await open({ ...BASE, perVisit: 3, children: [first, child(2), child(3)], alternates: [child(4), child(5)] });
    expect(timeText()).toHaveTextContent(/\/ 60:00$/);
    expect(timeText().className).toContain("text-red-700");
  });

  it("Urdu, a list of three: ۶۰:۰۰", async () => {
    setLang("ur");
    await open({ ...BASE, perVisit: 3, children: [1, 2, 3].map(child), alternates: [child(4), child(5)] });
    expect(timeText()).toHaveTextContent("۶۰:۰۰");
  });

  it("a list with no size (drawn at 5, or before the switch): / 45:00, red at 50:00, as today", async () => {
    const first = { ...child(1), sessionStartedAt: ago(50) };
    await open({ ...BASE, children: [first, ...[2, 3, 4, 5].map(child)], alternates: [] });
    expect(timeText()).toHaveTextContent(/\/ 45:00$/);
    expect(timeText().className).toContain("text-red-700");
  });

  it("the sitting stays 90 minutes on a list of three (sa_resume_repick): a start 80 min ago counts, 100 min ago does not", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, resumeRepick: true });
    const first = { ...child(1), sessionStartedAt: ago(80) };
    const second = { ...child(2), sessionStartedAt: ago(100) };
    await open({ ...BASE, perVisit: 3, children: [second, first, child(3)], alternates: [child(4), child(5)] }, "Bilal Testwala");
    expect(timeText()).toHaveTextContent(/^Time 80:0\d \/ 60:00$/);
  });
});
