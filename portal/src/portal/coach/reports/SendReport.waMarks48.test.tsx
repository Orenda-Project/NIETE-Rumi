import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { waParts } from "./waText";

/**
 * bd-o15qnr.48 (queue #244, the 390 px walk on sandbox; #234 listed it as issue 6) — the Send page's preview shows the
 * words the teacher gets on WhatsApp, where *this* is bold and _this_ is italic. The portal printed the marks as they
 * are ("📝 *From Hina Coach*", "_"Okay, I will try that."_"). On the switch the preview now draws them as WhatsApp
 * does; off the switch it is unchanged. The words sent are not touched (the bot sends its own text).
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getPending: vi.fn(), getObservation: vi.fn() }, leader: { getObservation: vi.fn(), previewReport: vi.fn(), sendReport: vi.fn() } }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));
import { coach, leader } from "../../services/api";
import SendReport from "./SendReport";

const L = leader as any;
const C = coach as any;
const COMPANION = "📝 *From Hina Coach*\n\nWe talked about asking why.\n\n🌱 *Your commitment*\n_\"Okay, I will try that.\"_";
const VIEW = {
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step: "report", problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: "preview", teacherName: "Ayesha Bibi", teacherPhone: "923001110001", caption: "Your *lesson* report", companionText: COMPANION, imageUrl: null, sentAt: null, templateSentAt: null },
};
const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/send"]}>
    <Routes><Route path="/portal/coach/observation/:id/send" element={<SendReport />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  flow.on = true;
  C.getObservation.mockResolvedValue({ success: true, id: "cs-1", date: "2026-10-06T06:30:00Z", step: "report", score: null, dcScore: 72 });
  L.getObservation.mockResolvedValue(VIEW);
});

describe("WhatsApp's marks in the Send preview", () => {
  it("waParts: *bold*, _italic_, ~struck~; a lone mark, or one across lines, stays as typed", () => {
    expect(waParts("a *b* c")).toEqual([{ t: "a " }, { t: "b", b: true }, { t: " c" }]);
    expect(waParts('_"Okay"_')).toEqual([{ t: '"Okay"', i: true }]);
    expect(waParts("~gone~")).toEqual([{ t: "gone", s: true }]);
    expect(waParts("2 * 3 = 6")).toEqual([{ t: "2 * 3 = 6" }]);
    expect(waParts("*one\ntwo*")).toEqual([{ t: "*one\ntwo*" }]);
    expect(waParts("snake_case_name")).toEqual([{ t: "snake_case_name" }]);
  });

  it("on the switch: bold and italic drawn, no * or _ left in the preview", async () => {
    renderPage();
    const preview = await screen.findByTestId("report-preview");
    const bold = Array.from(preview.querySelectorAll("strong")).map((e) => e.textContent);
    expect(bold).toEqual(expect.arrayContaining(["From Hina Coach", "Your commitment", "lesson"]));
    expect(Array.from(preview.querySelectorAll("em")).map((e) => e.textContent)).toContain('"Okay, I will try that."');
    expect(preview.textContent).not.toMatch(/\*From|commitment\*|_"Okay/);
    expect(preview.textContent).toContain("We talked about asking why.");
  });

  it("off the switch: unchanged (the marks as before)", async () => {
    flow.on = false;
    renderPage();
    const preview = await screen.findByTestId("report-preview");
    expect(preview.textContent).toContain("*From Hina Coach*");
  });
});
