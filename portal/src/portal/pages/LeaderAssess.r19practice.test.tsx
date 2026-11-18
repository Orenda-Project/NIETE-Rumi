import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Round 19 (sa_r19_practice_first, server side): the practice school comes first in every coach's school list, above
// today's visit. The server marks it `practice` and sends it first; the page keeps that order, online and from the
// schools saved on the phone. With the switch OFF the server sends no `practice`, and today's visit is first as before.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn(), mintLink: vi.fn(), getSwitches: vi.fn(), addChild: vi.fn() },
}));

import { portal, childTestSa } from "../services/api";
import LeaderAssess from "./LeaderAssess";

const api = childTestSa as any;
const SW = { handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false };
const netErr = () => Object.assign(new Error("Network Error"), { response: undefined });

const SIM = { schoolId: "sim", name: "SIM Child Test School", visitId: null, observedGrade: null, visitToday: false, practice: true };
const VISITED = { schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true, practice: false };
const OWN = { schoolId: "s1", name: "Abbot School", visitId: null, observedGrade: null, visitToday: false, practice: false };
const off = ({ practice, ...s }: any) => s; // eslint-disable-line @typescript-eslint/no-unused-vars

const order = () => screen.getAllByTestId(/^assess-school-(?!count)/).map((b) => b.getAttribute("data-testid"));

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSwitches.mockResolvedValue(SW);
});

describe("LeaderAssess: the practice school first", () => {
  it("ON: the server's order is kept, the practice school above today's visit", async () => {
    api.getSchools.mockResolvedValue({ schools: [SIM, VISITED, OWN] });
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    await screen.findByTestId("assess-school-sim");
    expect(order()).toEqual(["assess-school-sim", "assess-school-s2", "assess-school-s1"]);
  });

  it("ON, no signal: the schools saved on the phone keep the practice school first", async () => {
    api.getSwitches.mockResolvedValue({ ...SW, r8OfflinePrep: true });
    window.localStorage.setItem("assess:r8:schools", JSON.stringify([SIM, VISITED, OWN]));
    api.getSchools.mockRejectedValue(netErr());
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    await screen.findByTestId("assess-saved-schools");
    expect(order()).toEqual(["assess-school-sim", "assess-school-s2", "assess-school-s1"]);
  });

  it("OFF (no `practice` from the server): today's visit first, as before", async () => {
    api.getSchools.mockResolvedValue({ schools: [OWN, off(SIM), off(VISITED)] });
    render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
    await screen.findByTestId("assess-school-s2");
    expect(order()).toEqual(["assess-school-s2", "assess-school-s1", "assess-school-sim"]);
  });
});
