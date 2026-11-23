import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-bfagiy (queue #232) — Schedule an observation, step 1: the school search ignores spaces, punctuation and capitals,
 * takes the words in any order, matches the EMIS, and puts the closest school first. The operator, 23 Nov: "on school
 * search the schools are something like I-10/3 etc. It has punctuations and spaces. It is hard to search." The rule
 * itself is pinned in lib/schoolSearch.test.ts; this pins that the page uses it. Principals book through the same page.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPeople: vi.fn(), getSchedule: vi.fn(), getReports: vi.fn(), handoff: vi.fn(() => Promise.resolve({ code: null })) },
  leader: { cancelSchedule: vi.fn(), createSchedule: vi.fn(), getObserveLessonQuestion: vi.fn(() => Promise.resolve(null)) },
}));
vi.mock("./track", () => ({ trackFlow: vi.fn() }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<object>()), useBotNumber: () => "923000000000" }));
vi.mock("../ui", async (orig) => ({ ...(await orig<object>()), readPending: vi.fn(() => Promise.resolve({ waiting: 0, ids: [] })) }));
vi.mock("./useCoachFlowV2", () => ({ useFlowV2: () => true, useFlowV6: () => true, useCoachFlowV2: () => true, coachFlowV2On: () => true }));

import { coach } from "../../services/api";
import CoachNewVisit from "../pages/CoachNewVisit";

const C = coach as any;
const school = (schoolExtId: string, name: string, emis: string, daysSinceVisit: number | null) =>
  ({ schoolExtId, name, emis, teachers: 3, visits: 0, daysSinceVisit, avgHitl: null });
const PEOPLE = {
  success: true,
  schools: [
    // never visited, so it sorts to the top when nothing is typed
    school("S4", "IMCG (VI-XII) I-10/4", "613", null),
    school("S2", "IMCB G-10/3", "1033", 40),
    school("S1", "IMSG (I-V) I-10/3", "612", 3),
    school("S7", "IMSG F-7/2", "721", 9),
  ],
  teachers: [],
};

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  C.getPeople.mockResolvedValue(PEOPLE);
  C.getSchedule.mockResolvedValue({ success: true, from: "", to: "", overdue: [], visits: [] });
  C.getReports.mockResolvedValue({ success: true, waiting: [], inProgress: [], all: { total: 0, page: 1, pageSize: 20, items: [] } });
});

async function typeSearch(q: string) {
  render(
    <MemoryRouter initialEntries={["/portal/coach/new-visit"]}>
      <Routes><Route path="/portal/coach/new-visit" element={<CoachNewVisit />} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByPlaceholderText("School name"), { target: { value: q } });
}

/** The school names on screen, top to bottom. */
const shown = () => PEOPLE.schools.map((s) => s.name)
  .filter((n) => screen.queryByText(n))
  .sort((a, b) => (screen.getByText(a).compareDocumentPosition(screen.getByText(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

describe("Schedule an observation: the school search", () => {
  it.each(["i103", "I 10 3", "i-10/3", "IMSG I10"])("%j puts IMSG (I-V) I-10/3 first", async (q) => {
    await typeSearch(q);
    expect(shown()[0]).toBe("IMSG (I-V) I-10/3");
    expect(screen.queryByText("IMSG F-7/2")).toBeNull();
  });

  it("finds a school by its EMIS", async () => {
    await typeSearch("1033");
    expect(shown()).toEqual(["IMCB G-10/3"]);
  });

  it("nothing typed: every school, never-visited first, as before", async () => {
    await typeSearch("");
    expect(shown()).toEqual(["IMCG (VI-XII) I-10/4", "IMCB G-10/3", "IMSG F-7/2", "IMSG (I-V) I-10/3"]);
  });
});
