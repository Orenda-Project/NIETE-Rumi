import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanCopy, scanStyle } from "../../newui/checks/source";

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
 * bd-ra8xu.40 — an FDE (obs612) visit's form, filled on the portal. The Feedback Form route opens it when the draft
 * says kind 'obs612': FDE's parts as steps (the kit's StepBar), each item with its options (Yes/No, 1-4, Level 0-3),
 * the tool's own text fields, Save draft and Submit (with a confirm tray), the refused fields shown, read-only once
 * sealed, and the label 'FDE v1' in very small type. Every word is the copy file's or FDE's own (from the API).
 */
const L = leader as any;
const YES_NO = [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }];
const POINTS = ["Needs Improvement", "Developing", "Proficient", "Excellent"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}` }));
const LEVELS = [0, 1, 2, 3].map((n) => ({ id: String(n), title: `Level ${n}`, description: `What level ${n} looks like` }));
const item = (name: string, n: number, text: string, kind: string, options: any[], extra = {}) => ({
  type: "field", name, role: "item", input: "radio", kind, n, short: null, text, options, required: true, max: null, ...extra,
});
const text = (name: string, role: string, required: boolean, t: string | null = null, input = "textarea") => ({
  type: "field", name, role, input, kind: null, n: null, short: null, text: t, options: null, required, max: 600,
});

const GEN = (extra: Record<string, unknown> = {}) => ({
  status: "ok", kind: "obs612", label: "FDE v1", rubricId: "obs612-gen-v1", tool: "gen", toolName: "General form",
  toolTitle: "Teacher Observation Form General", sheet: null, grade: 9, subject: "islamiat",
  sections: [
    { id: "GEN_ENV", parts: [
      { type: "heading", text: "CLASSROOM ENVIRONMENT" },
      item("env_1", 1, "Well lit and airy classroom", "yes_no", YES_NO),
      text("comment_env", "comment", false),
    ] },
    { id: "GEN_WORK", parts: [
      { type: "heading", text: "Students' Work Management" },
      item("work_1", 1, "Notebooks are checked", "yes_no", YES_NO),
      { type: "sub", role: "feedback" },
      text("fb_line", "line", true),
    ] },
  ],
  values: {}, errors: { env_1: "item", work_1: "item", fb_line: "text" }, missing: ["env_1", "work_1", "fb_line"],
  editable: true, sealed: false, submittedAt: null,
  ...extra,
});

const ENUR = () => ({
  ...GEN(), tool: "enur", toolName: "English & Urdu tool", rubricId: "obs612-enur-v1", sheet: "en",
  sections: [
    { id: "ENUR_CONTEXT", parts: [
      { type: "heading", text: "Section 1: Context & Pre-Observation" },
      { type: "context", rows: [{ key: "ctx_1", label: "School", value: "IMCG F-7/2" }, { key: "ctx_2", label: "Observer", value: null }] },
      { type: "field", name: "ctx_5", role: "context", input: "dropdown", kind: null, n: null, short: null, text: "Subject", options: [{ id: "English", title: "English" }, { id: "Urdu", title: "Urdu" }], required: true, max: null },
      { type: "field", name: "ctx_8", role: "context", input: "number", kind: null, n: null, short: null, text: "Class Size", options: null, required: false, max: null },
      item("s2b_1", 1, "Clear lesson objectives communicated", "points", POINTS),
      item("i1", 1, "Assigning and checking written work", "level", LEVELS, { short: "Written work checked" }),
    ] },
    { id: "ENUR_FEEDBACK", parts: [
      { type: "score", total: 111, max: 148, pct: 75, band: "Proficient" },
      { type: "levels", label: "Current level", rows: [{ key: "i1", n: 1, name: "Written work checked", level: "Level 2" }, { key: "i2", n: 2, name: "Opening based on SLOs", level: null }] },
      text("fb_strengths", "feedback", true, "Strengths"),
    ] },
  ],
  values: { ctx_5: "English" }, errors: {}, missing: [],
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
const button = (name: string) => screen.getByRole("button", { name });
const answered = (values: Record<string, string>, extra: Record<string, unknown> = {}) => GEN({ values, errors: {}, missing: [], ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(GEN());
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => GEN({ values }));
});

describe("FDE form on the portal", () => {
  it("opens instead of the FICO form: FDE's part, a StepBar over the parts, the label FDE v1 in very small type", async () => {
    renderPage();
    expect(await screen.findByText("CLASSROOM ENVIRONMENT")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Feedback Form");
    expect(screen.getByRole("img", { name: "Part 1 of 2" })).toBeInTheDocument();
    const label = screen.getByTestId("rubric-label");
    expect(label).toHaveTextContent("FDE v1");
    expect(label.className).toMatch(/text-\[(9|10|11)px\]/);
    expect(screen.queryByTestId("legend")).toBeNull();
  });

  it("an item: FDE's number (no 'Item n'), FDE's wording, its Yes/No options; the comment box is the tool's, optional", async () => {
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    expect(screen.queryByText("Item 1")).toBeNull();
    const group = within(screen.getByRole("radiogroup", { name: "Well lit and airy classroom" }));
    expect(group.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Yes", "No"]);
    expect(screen.getByLabelText(/Comments/)).toHaveAttribute("dir", "auto");
  });

  it("each input kind: Section 1 rows, a list, a whole number, 1-4 items, Level 0-3 with FDE's level text; the score so far", async () => {
    L.getObservationDraft.mockResolvedValue(ENUR());
    renderPage();
    expect(await screen.findByText("IMCG F-7/2")).toBeInTheDocument();
    expect(screen.getByText("School")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Subject/ })).toHaveTextContent("English");
    expect(screen.getByLabelText(/Class Size/)).toHaveAttribute("inputmode", "numeric");
    const points = within(screen.getByRole("radiogroup", { name: "Clear lesson objectives communicated" }));
    expect(points.getAllByRole("radio").map((r) => r.textContent)).toEqual(["1", "2", "3", "4"]);
    const level = within(screen.getByRole("radiogroup", { name: "Written work checked" }));
    expect(level.getAllByRole("radio")).toHaveLength(4);
    expect(level.getByText("What level 2 looks like")).toBeInTheDocument();
    fireEvent.click(level.getByRole("radio", { name: /Level 2/ }));
    expect(level.getByRole("radio", { name: /Level 2/ })).toHaveAttribute("aria-checked", "true");
    L.saveObs612Form.mockResolvedValue(ENUR());
    fireEvent.click(button("Next part"));
    expect(await screen.findByText("Score so far")).toBeInTheDocument();
    expect(screen.getByText("111 / 148 (75%)")).toBeInTheDocument();
    expect(screen.getByText("Proficient")).toBeInTheDocument();
    expect(screen.getByText("Not scored")).toBeInTheDocument();
  });

  it("Next saves the part (every value, no Submit) and stays on it while it has errors, each one marked", async () => {
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    fireEvent.change(screen.getByLabelText(/Comments/), { target: { value: "Bright room" } });
    fireEvent.click(button("Next part"));
    await waitFor(() => expect(L.saveObs612Form).toHaveBeenCalledTimes(1));
    expect(L.saveObs612Form).toHaveBeenCalledWith("cs-1", expect.objectContaining({ comment_env: "Bright room", env_1: "" }), false);
    expect(await screen.findByText("Choose an answer")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Part 1 of 2" })).toBeInTheDocument();
  });

  it("Next moves on once the part is clean", async () => {
    L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => GEN({ values, errors: { work_1: "item", fb_line: "text" } }));
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Well lit and airy classroom" })).getByRole("radio", { name: "Yes" }));
    fireEvent.click(button("Next part"));
    expect(await screen.findByText("Notebooks are checked")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Part 2 of 2" })).toBeInTheDocument();
    expect(screen.queryByText("Choose an answer")).toBeNull();
  });

  it("Save draft saves part-way and says so; it never submits", async () => {
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Well lit and airy classroom" })).getByRole("radio", { name: "No" }));
    fireEvent.click(button("Save draft"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(L.saveObs612Form).toHaveBeenCalledWith("cs-1", expect.objectContaining({ env_1: "no" }), false);
  });

  it("required items block Submit: the bot's check marks them, no tray, nothing submitted", async () => {
    L.getObservationDraft.mockResolvedValue(GEN({ values: { env_1: "yes" }, errors: { work_1: "item", fb_line: "text" }, missing: ["work_1", "fb_line"] }));
    L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => GEN({ values, errors: { work_1: "item", fb_line: "text" }, missing: ["work_1", "fb_line"] }));
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    fireEvent.click(button("Next part"));
    await screen.findByText("Notebooks are checked");
    fireEvent.click(button("Submit"));
    expect(await screen.findByText("2 answers missing")).toBeInTheDocument();
    expect(screen.getByText("Choose an answer")).toBeInTheDocument();
    expect(screen.getByText("Write a few words")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, submit" })).toBeNull();
    expect(L.saveObs612Form.mock.calls.every((c: any[]) => c[2] === false)).toBe(true);
  });

  it("a complete form: Submit asks first, then sends every value with submit, and opens the observation", async () => {
    const values = { env_1: "yes", comment_env: "", work_1: "no", fb_line: "Strong start; check every notebook" };
    L.getObservationDraft.mockResolvedValue(answered(values));
    L.saveObs612Form.mockImplementation(async (_id: string, v: Record<string, string>, submit: boolean) => answered(v, submit ? { sealed: true, editable: false, submitted: true } : {}));
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    fireEvent.click(button("Next part"));
    await screen.findByText("Notebooks are checked");
    expect(screen.getByLabelText(/Feedback for the teacher/)).toHaveValue("Strong start; check every notebook");
    fireEvent.click(button("Submit"));
    expect(await screen.findByText("Submit the form")).toBeInTheDocument();
    expect(screen.getByText("No changes after this")).toBeInTheDocument();
    fireEvent.click(button("Yes, submit"));
    await waitFor(() => expect(L.saveObs612Form).toHaveBeenLastCalledWith("cs-1", values, true));
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("a Submit the bot refuses (400) shows the refused fields on their part", async () => {
    const values = { env_1: "yes", comment_env: "", work_1: "no", fb_line: "Fine" };
    L.getObservationDraft.mockResolvedValue(answered(values));
    L.saveObs612Form.mockImplementation(async (_id: string, v: Record<string, string>, submit: boolean) => {
      if (submit) throw Object.assign(new Error("400"), { response: { status: 400, data: { status: "invalid", reason: "obs612_incomplete", missing: ["env_1"], errors: { env_1: "item" } } } });
      return answered(v);
    });
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    fireEvent.click(button("Next part"));
    await screen.findByText("Notebooks are checked");
    fireEvent.click(button("Submit"));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, submit" }));
    expect(await screen.findByText("Choose an answer")).toBeInTheDocument();
    expect(screen.getByText("Well lit and airy classroom")).toBeInTheDocument();
    expect(screen.getByText("1 answer missing")).toBeInTheDocument();
  });

  it("read-only once sealed: her answers as words, Submitted, no Save draft and no Submit", async () => {
    L.getObservationDraft.mockResolvedValue(GEN({ values: { env_1: "yes", comment_env: "Bright room", work_1: "no", fb_line: "Well done" }, sealed: true, editable: false, submittedAt: "2026-11-12T05:00:00Z", errors: {}, missing: [] }));
    renderPage();
    await screen.findByText("Well lit and airy classroom");
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("Bright room")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    fireEvent.click(button("Next part"));
    expect(await screen.findByText("Well done")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });

  it("a FICO draft still opens the FICO form", async () => {
    L.getObservationDraft.mockResolvedValue({ saved: false, editable: true, scale: [], fidelityScale: [], sections: [
      { key: "culture", letter: "C", title: "Classroom culture", kind: "indicators", notes: [], indicators: [{ id: "C1", field: "C1", name: "Positive learning environment", rating: "1", evidence: "", improvement: "" }] },
    ] });
    renderPage();
    expect(await screen.findByText("Positive learning environment")).toBeInTheDocument();
    expect(screen.queryByTestId("rubric-label")).toBeNull();
  });
});

describe("FDE form: the kit's rules", () => {
  const rel = "reports/Obs612Form.tsx";
  const src = () => readFileSync(resolve(__dirname, "Obs612Form.tsx"), "utf8");
  it("no words written into the component (they come from copy.ts or the API)", () => {
    expect(scanCopy(rel, src())).toEqual([]);
  });
  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    expect(scanStyle(rel, src()).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour")).toEqual([]);
  });
  it("free text keeps its own direction", () => {
    expect((src().match(/<textarea/g) || []).length).toBeGreaterThan(0);
    for (const m of src().match(/<(textarea|input)\b[^>]*>/g) || []) expect(m).toMatch(/dir="auto"/);
  });
});
