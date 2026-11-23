import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), saveObservationDraft: vi.fn(), saveObs612Form: vi.fn() },
}));
import { leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";

/**
 * Queue #218 — FICO-S v1.2 on the portal (coach and principal share this form). The level options, N/A included, are the
 * bot's data (obs612/fico-s-flow portalSections), so C2 and C3 show N/A in their own words as the WhatsApp form does.
 * One rule lives here: C3 arrives on N/A when the observer picks C1 level 1 (the bot sends it as the field's `follows`),
 * unless the observer already chose a C3 level; the observer can change it.
 */
const L = leader as any;
const LEVELS = ["Below standard", "Developing", "Proficient", "Exemplary"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}`, description: `What level ${i + 1} looks like` }));
const NA_C3 = { id: "NA", title: "N/A · No question asked", description: "The teacher asked the students no question to answer, so no student was chosen." };
const NA_C2 = { id: "NA", title: "N/A · No answer was wrong", description: "No answer was wrong in this lesson, so there was nothing to respond to." };
const level = (name: string, short: string, options: any[], extra = {}) => ({
  type: "field", name, role: "item", input: "radio", kind: "level", n: null, short, text: `Look for ${name}`, options, required: true, max: null, ...extra,
});
const ev = (name: string) => ({ type: "field", name, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Evidence", options: null, required: true, max: 600 });

const FICOS = (values: Record<string, string> = {}) => ({
  status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
  toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "FS_C", parts: [
      { type: "heading", text: "C1 · Quality of questions" },
      level("C1", "Section C · 1 of 8", LEVELS), ev("ev_C1"),
      { type: "heading", text: "C2 · Responding to wrong answers" },
      level("C2", "Section C · 2 of 8", [...LEVELS, NA_C2]), ev("ev_C2"),
      { type: "heading", text: "C3 · Who gets to answer" },
      level("C3", "Section C · 3 of 8", [...LEVELS, NA_C3], { follows: { code: "C1", level: "1" } }), ev("ev_C3"),
    ] },
  ],
  values, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
});

const VIEW = { id: "cs-1", teacher: { name: "Ayesha Bibi", phone: "923001110001" }, report: { teacherName: "Ayesha Bibi" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };
const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);
const group = (name: string) => within(screen.getByRole("radiogroup", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(FICOS());
});

describe("FICO-S v1.2 on the portal", () => {
  it("C2 and C3 show N/A last, in their own words", async () => {
    renderPage();
    await screen.findByText("C3 · Who gets to answer");
    expect(group("Section C · 2 of 8").getByRole("radio", { name: /N\/A · No answer was wrong/ })).toBeInTheDocument();
    expect(group("Section C · 3 of 8").getAllByRole("radio").map((r) => r.textContent)).toContain(`${NA_C3.title}${NA_C3.description}`);
    expect(group("Section C · 1 of 8").queryByRole("radio", { name: /N\/A/ })).toBeNull();
  });

  it("C1 at level 1 pre-picks C3's N/A; the observer can change it", async () => {
    renderPage();
    await screen.findByText("C3 · Who gets to answer");
    fireEvent.click(group("Section C · 1 of 8").getByRole("radio", { name: /1 · Below standard/ }));
    expect(group("Section C · 3 of 8").getByRole("radio", { name: /N\/A · No question asked/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(group("Section C · 3 of 8").getByRole("radio", { name: /2 · Developing/ }));
    expect(group("Section C · 3 of 8").getByRole("radio", { name: /2 · Developing/ })).toHaveAttribute("aria-checked", "true");
  });

  it("C1 above 1 leaves C3 alone, and a C3 level already chosen is never overwritten", async () => {
    L.getObservationDraft.mockResolvedValue(FICOS({ C3: "3" }));
    renderPage();
    await screen.findByText("C3 · Who gets to answer");
    fireEvent.click(group("Section C · 1 of 8").getByRole("radio", { name: /1 · Below standard/ }));
    expect(group("Section C · 3 of 8").getByRole("radio", { name: /3 · Proficient/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(group("Section C · 1 of 8").getByRole("radio", { name: /2 · Developing/ }));
    expect(group("Section C · 3 of 8").getByRole("radio", { name: /N\/A/ })).toHaveAttribute("aria-checked", "false");
  });
});
