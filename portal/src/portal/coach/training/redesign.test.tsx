import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "coach", phoneNumber: "92300", firstName: "Noor", lastName: "Fatima" }, loading: false }) }));
vi.mock("../useCoachV2", async (orig) => ({ ...(await orig<any>()), useCoachV2: () => true }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("../../services/api", () => ({ default: http, language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() } }));

import { LibraryHome, LibraryModulePage, LibraryPreview, LibraryProvider } from "./LibraryPages";

/**
 * bd-s42dye.6 — the coach Training Library is drawn with the teacher app v2's kit: the Home band and provider tiles,
 * the page frame with the Training tile, Part rows, Handout / preview rows, the quick-check question visuals (read
 * only). These tests pin THAT (structure, not pixels): a screen that goes back to its own card chrome fails here.
 */
const mod = (id: string, title: string, o: Record<string, unknown> = {}) => ({
  id, title, order_index: 0, duration_seconds: 300, has_video: true, has_audio: false, has_pdf: false, has_questions: false, ...o,
});
const LIBRARY = { vendors: [
  { vendor_key: "TALEEMABAD", vendor_name: "NIETE", levels: [
    { id: 1, name: "Aspiring", order_index: 0, has_level_exam: true, exam_kind: "grand_quiz", courses: [
      { id: "c-1", title: "Module 1 - Routines", order_index: 0, has_readings: false, has_module_exam: false, modules: [mod("m-1", "Why routines", { has_questions: true }), mod("m-2", "Making routines", { order_index: 1 })] },
    ] },
    { id: 2, name: "Emerging", order_index: 1, has_level_exam: false, exam_kind: null, courses: [
      { id: "c-2", title: "Asking questions", order_index: 0, has_readings: false, has_module_exam: false, modules: [mod("m-3", "Open questions")] },
    ] },
  ] },
  { vendor_key: "ISAPS", vendor_name: "Teacher Development Programme, 9-12", levels: [
    { id: 9, name: "Effective Teaching", order_index: 0, has_level_exam: false, exam_kind: null, courses: [
      { id: "c-9", title: "Planning", order_index: 0, has_readings: true, has_module_exam: true, modules: [mod("m-9", "Plan well", { has_pdf: true })] },
    ] },
  ] },
  { vendor_key: "BEACONHOUSE", vendor_name: "AI-Powered Subject Pedagogy, 6-10", levels: [] },
  { vendor_key: "OXBRIDGE", vendor_name: "GBTLA, 6-10", levels: [] },
  { vendor_key: "TALEEMABAD_LEGACY", vendor_name: "Taleemabad", levels: [] },
] };
const M1 = { id: "m-1", title: "Why routines", course_id: "c-1", level_id: 1, vendor_key: "TALEEMABAD", body_html: "<p>Routines matter</p>",
  video_url: "https://cdn.test/v.mp4", audio_url: null, pdf_url: "https://cdn.test/h.pdf", duration_seconds: 300, has_questions: true };
const PREVIEW = { scope: "module", title: "Why routines", questions: [
  { id: "q1", type: "mcq", text: "What is a routine?", options: ["A habit", "A test"], image_url: null },
  { id: "q2", type: "msq", text: "Pick the routines", options: ["Greeting", "Exit", "Noise"], image_url: null },
  { id: "q3", type: "crq", text: "Describe one routine", options: [], image_url: null },
] };

beforeEach(async () => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (url: string) => {
    if (url === "/training/library") return { data: LIBRARY };
    if (url === "/training/library/module/m-1") return { data: M1 };
    if (url === "/training/library/questions") return { data: PREVIEW };
    throw new Error(`unmocked ${url}`);
  });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

const app = (entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/portal/coach/training" element={<LibraryHome />} />
      <Route path="/portal/coach/training/preview" element={<LibraryPreview />} />
      <Route path="/portal/coach/training/module/:id" element={<LibraryModulePage />} />
      <Route path="/portal/coach/training/:vendorKey" element={<LibraryProvider />} />
    </Routes>
  </MemoryRouter>,
);

describe("the landing is the teacher Home pattern", () => {
  it("opens with the NIETE band (greeting, date, no school row), then the Training Library heading", async () => {
    app("/portal/coach/training");
    await screen.findByTestId("provider-TALEEMABAD");
    const band = screen.getByTestId("home-greeting");
    expect(band.querySelector("h1")?.textContent).toBe("Salaam, Noor Fatima!");
    expect(screen.getByTestId("home-date")).toBeTruthy();
    expect(screen.queryByTestId("home-school")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /Training Library/ })).toBeTruthy();
  });

  it("every provider is a hub provider tile: its mark, its name, its course count", async () => {
    app("/portal/coach/training");
    const grid = await screen.findByTestId("library-providers");
    expect(grid.className).toContain("grid-cols-2");
    const tile = screen.getByTestId("provider-TALEEMABAD");
    expect(tile.className).toContain("min-h-[150px]");
    expect(tile.className).toContain("rounded-[18px]");
    expect(tile.textContent).toContain("NIETE");
    expect(tile.textContent).toContain("2 courses");
    // the mark on its white tile, and nothing that reads as progress
    expect(tile.querySelector("span.rounded-\\[14px\\]")).toBeTruthy();
    expect(tile.querySelector('[role="img"], [style*="gradient"]')).toBeNull();
    expect(within(grid).getAllByRole("link")).toHaveLength(5);
  });

  it("a long programme name steps down a size, as on the teacher hub", async () => {
    app("/portal/coach/training");
    const long = await screen.findByTestId("provider-ISAPS");
    expect(long.querySelector("b")?.className).toContain("text-[15px]");
    expect(screen.getByTestId("provider-TALEEMABAD").querySelector("b")?.className).toContain("text-[18px]");
  });
});

describe("the provider page is the teacher level and course pages", () => {
  it("the frame carries the Training tile, the crumb and the provider's name", async () => {
    app("/portal/coach/training/TALEEMABAD");
    await screen.findByTestId("level-1");
    expect(screen.getByTestId("page-feature-tile")).toBeTruthy();
    expect(screen.getByTestId("page-crumb").textContent).toBe("Training Library");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NIETE");
  });

  it("parts are the teacher's Part rows: PART over the number, the length under the name", async () => {
    app("/portal/coach/training/TALEEMABAD");
    const row = await screen.findByTestId("module-m-1");
    const lead = within(row).getByTestId("listrow-lead");
    expect(lead.textContent).toBe("Part1");
    expect(row.textContent).toContain("Why routines");
    expect(row.textContent).toContain("5 min");
    expect(within(screen.getByTestId("module-m-2")).getByTestId("listrow-lead").textContent).toBe("Part2");
  });

  it("an exam preview is a kit row with a lead tile and a chevron, not an outline button", async () => {
    app("/portal/coach/training/TALEEMABAD");
    const row = await screen.findByTestId("preview-level-1");
    expect(row.className).toContain("min-h-[76px]");
    expect(row.querySelector("svg")).toBeTruthy();
    expect(row.className).not.toContain("justify-center");
  });

  it("a single-level provider shows its level and courses straight away", async () => {
    app("/portal/coach/training/ISAPS");
    expect(await screen.findByTestId("course-c-9")).toBeTruthy();
    expect(screen.getByTestId("level-9").textContent).toContain("Effective Teaching");
    expect(screen.getByTestId("preview-course-c-9").className).toContain("min-h-[76px]");
  });
});

describe("the part page is the teacher part page", () => {
  it("has the Training tile, the crumb, Part n/m and the length as chips", async () => {
    app("/portal/coach/training/module/m-1");
    await screen.findByTestId("library-video");
    expect(screen.getByTestId("page-feature-tile")).toBeTruthy();
    const header = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
    expect(header).toBeTruthy();
    const chips = Array.from(document.querySelectorAll("[data-chip]")).map((c) => c.textContent);
    expect(chips).toContain("Part 1/2");
    expect(chips).toContain("5 min");
  });

  it("the handout and the question preview are kit rows (lead tile, chip or chevron), the handout an outside link", async () => {
    app("/portal/coach/training/module/m-1");
    const handout = await screen.findByTestId("library-handout");
    expect(handout.tagName).toBe("A");
    expect(handout.getAttribute("href")).toBe("https://cdn.test/h.pdf");
    expect(handout.getAttribute("target")).toBe("_blank");
    expect(handout.className).toContain("min-h-[76px]");
    expect(within(handout).getByText("PDF").hasAttribute("data-chip")).toBe(true);
    const pv = screen.getByTestId("preview-module");
    expect(pv.className).toContain("min-h-[76px]");
    expect(pv.getAttribute("href")).toBe("/portal/coach/training/preview?module_id=m-1");
  });

  it("shows no Up next, no Mark done, no Start", async () => {
    app("/portal/coach/training/module/m-1");
    await screen.findByTestId("library-video");
    expect(document.body.textContent).not.toMatch(/up next|mark done|start quick check|continue/i);
  });
});

describe("the question preview wears the teacher quick-check visuals, read only", () => {
  it("each question is the quick check's prompt over its big A/B/C answer rows, with nothing to press", async () => {
    const { container } = app("/portal/coach/training/preview?module_id=m-1");
    const q1 = await screen.findByTestId("question-1");
    expect(q1.querySelector("p")?.className).toContain("text-[20px]");
    const rows = q1.querySelectorAll("ol > li");
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("min-h-16");
    expect(rows[0].className).toContain("border-2");
    expect(rows[0].textContent).toBe("AA habit");
    expect(screen.getByTestId("question-2").querySelectorAll("ol > li")).toHaveLength(3);
    expect(container.querySelectorAll("input, textarea, select, button, [role=radio], [role=checkbox], [aria-checked]")).toHaveLength(0);
    // nothing in the preview is picked, right or wrong
    expect(container.innerHTML).not.toMatch(/border-\[#2f7a52\]|border-\[#c8331f\]|border-\[#33374a\]/);
  });

  it("the preview-only line is the kit's note, and the written question is named, not boxed", async () => {
    app("/portal/coach/training/preview?module_id=m-1");
    const note = await screen.findByTestId("preview-banner");
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toContain("Preview only");
    const written = screen.getByTestId("question-3");
    expect(written.textContent).toContain("Written answer");
    expect(written.querySelector("ol")).toBeNull();
  });
});

describe("Urdu", () => {
  it("the landing band and tiles follow the language, and the band mirrors", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    app("/portal/coach/training");
    await screen.findByTestId("provider-TALEEMABAD");
    expect(screen.getByTestId("home-greeting").querySelector("h1")?.textContent).toBe("السلام علیکم، Noor Fatima!");
    expect(screen.getByTestId("provider-TALEEMABAD").textContent).toContain("2 کورس");
    expect(screen.getByRole("heading", { level: 2, name: /ٹریننگ لائبریری/ })).toBeTruthy();
  });
});

describe("no look-alike chrome in the library pages", () => {
  const src = readFileSync(resolve(__dirname, "LibraryPages.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("draws no card, row or button of its own: it imports the teacher kit", () => {
    expect(src).not.toMatch(/rounded-2xl border border-\[#e5e7eb\]/);
    expect(src).toMatch(/teacher\/training\/parts/);
    expect(src).toMatch(/teacher\/training\/TrainingFrame/);
    expect(src).toMatch(/teacher\/ui/);
  });
});
