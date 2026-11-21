import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.31 (#188, 21 Nov) — FICO-S and FDE on the v6/v7 switch: every text box sized to its text (each paragraph
 * its own direction), and "Next part" with gaps: a short counted toast AND the first unfilled item scrolled to and
 * focused, the inline marks kept. Switch off: today's form (FeedbackForm.v7.test.tsx keeps its snapshots).
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), saveObservationDraft: vi.fn(), saveObs612Form: vi.fn() },
}));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";

const L = leader as any;
const LEVELS = [0, 1, 2, 3].map((n) => ({ id: String(n), title: `Level ${n}`, description: `What level ${n} looks like` }));
const item = (name: string, n: number, text: string) => ({
  type: "field", name, role: "item", input: "radio", kind: "level", n, short: text, text, options: LEVELS, required: true, max: null,
});
const box = (name: string, role: string, required: boolean, t: string | null = null) => ({
  type: "field", name, role, input: "textarea", kind: null, n: null, short: null, text: t, options: null, required, max: 600,
});
const FDE = (extra: Record<string, unknown> = {}) => ({
  status: "ok", kind: "obs612", label: "FDE v1", rubricId: "obs612-msci-v1", tool: "msci", toolName: "Maths & Science tool",
  toolTitle: "Maths & Science Observation Tool", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "MSCI_A", parts: [
      { type: "heading", text: "Teaching the concept" },
      item("m1", 1, "Model or drawing"),
      item("m2", 2, "Checks understanding"),
      box("obs_1", "observation", false),
    ] },
    { id: "MSCI_B", parts: [{ type: "heading", text: "Feedback" }, box("fb_line", "line", true)] },
  ],
  values: {}, errors: { m1: "item", m2: "item", fb_line: "text" }, missing: ["m1", "m2", "fb_line"], editable: true, sealed: false, submittedAt: null,
  ...extra,
});
const VIEW = { id: "cs-1", teacher: { name: "Lubna Arif", phone: "923001110001" }, report: { teacherName: "Lubna Arif" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(FDE());
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => {
    const errors: Record<string, string> = {};
    if (!values.m1) errors.m1 = "item";
    if (!values.m2) errors.m2 = "item";
    if (!values.fb_line) errors.fb_line = "text";
    return { ...FDE(), values, errors, missing: Object.keys(errors) };
  });
});

describe("FICO-S / FDE on the switch: gaps on Next part", () => {
  it("a counted toast, the first unfilled item focused, the inline marks kept", async () => {
    renderPage();
    await screen.findByText("Teaching the concept");
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    const toast = await screen.findByTestId("ff-toast");
    expect(toast).toHaveTextContent("2 items still need a level");
    expect(screen.getByTestId("err-m1")).toBeInTheDocument();
    expect(screen.getByTestId("err-m2")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("radiogroup", { name: "Model or drawing" })).getAllByRole("radio")).toContain(document.activeElement));
    expect(screen.getByText("Teaching the concept")).toBeInTheDocument(); // it stays on the part
  });

  it("one gap left: the toast counts one, and the focus goes to it", async () => {
    renderPage();
    await screen.findByText("Teaching the concept");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Model or drawing" })).getByRole("radio", { name: /Level 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(await screen.findByTestId("ff-toast")).toHaveTextContent("1 item still needs a level");
    await waitFor(() => expect(within(screen.getByRole("radiogroup", { name: "Checks understanding" })).getAllByRole("radio")).toContain(document.activeElement));
  });

  it("Submit with a text box empty: the toast says an answer, and the box is focused", async () => {
    L.getObservationDraft.mockResolvedValue(FDE({ values: { m1: "2", m2: "1" }, errors: { fb_line: "text" }, missing: ["fb_line"] }));
    renderPage();
    await screen.findByText("Teaching the concept");
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    await screen.findByText("Feedback");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByTestId("ff-toast")).toHaveTextContent("1 item still needs an answer");
    await waitFor(() => expect(screen.getByLabelText("Feedback for the teacher")).toHaveFocus());
  });

  it("every text box is sized to its text, each paragraph its own direction", async () => {
    renderPage();
    await screen.findByText("Teaching the concept");
    const obs = document.getElementById("fde-obs_1") as HTMLTextAreaElement;
    expect(obs.tagName).toBe("TEXTAREA");
    expect(obs).toHaveAttribute("rows", "1");
    expect(obs).toHaveAttribute("data-autosize");
    expect(obs).toHaveAttribute("dir", "auto");
    expect(obs.className).toMatch(/\[unicode-bidi:plaintext\]/);
  });

  it("switch off: no toast, today's note", async () => {
    flow.on = false;
    renderPage();
    await screen.findByText("Teaching the concept");
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    await waitFor(() => expect(L.saveObs612Form).toHaveBeenCalled());
    expect(screen.queryByTestId("ff-toast")).toBeNull();
    expect(document.getElementById("fde-obs_1")).toHaveAttribute("rows", "3");
  });
});
