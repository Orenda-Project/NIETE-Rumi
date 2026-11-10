import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test", role: "coach", phoneNumber: "920000000000" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
const progress = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../../services/api", async (orig) => ({
  ...(await orig<typeof import("../../services/api")>()),
  coach: { getCoachTrainingProgress: progress.get, setCoachModuleDone: progress.set },
}));
import CoachTrainingModulePage from "./CoachTrainingModulePage";
import { COACH_MODULE_PATH, COACH_TRAINING_PATH } from "./modules";

/**
 * bd-rlxkkt.6 — the operator, 5 Nov 2026: a module's video and its page are not shown together on the list. A coach opens
 * a module and gets a clean choice of two big buttons, PDF (the module's page) and Video; a tap opens that format, and
 * coming back lands on the choice. Back goes to the list.
 */
describe("a module's own screen: PDF or Video", () => {
  beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    open = vi.fn(); vi.stubGlobal("open", open);
    progress.get.mockReset().mockResolvedValue({ success: true, done: {} });
    progress.set.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const renderAt = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={COACH_MODULE_PATH} element={<CoachTrainingModulePage />} />
        <Route path={COACH_TRAINING_PATH} element={<p>the module list</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it("English: the module's title, then two big buttons, PDF first and Video; each opens its own format", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    const { container } = renderAt("/portal/coach/coach-training/8");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rehearse it aloud");
    expect(screen.getByTestId("coach-training-module")).toHaveTextContent("Module 8");
    const pdf = screen.getByRole("button", { name: "PDF" });
    const video = screen.getByRole("button", { name: "Video" });
    expect(pdf).toHaveAttribute("data-testid", "coach-format-pdf");
    expect(video).toHaveAttribute("data-testid", "coach-format-video");
    expect(pdf.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const b of [pdf, video]) expect(b.className).toMatch(/min-h-\[176px\]/);
    fireEvent.click(pdf);
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C", "_blank", "noopener,noreferrer");
    fireEvent.click(video);
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/FnhqM4ae3uV1XwwwgSYfYs", "_blank", "noopener,noreferrer");
    // still on the choice after a format opened (it opens in the browser), and Back goes to the list
    expect(screen.getByRole("button", { name: "PDF" })).toBeTruthy();
    expect(container.querySelector(`a[href="${COACH_TRAINING_PATH}"]`)).not.toBeNull();
  });

  it("Urdu: the same choice in Urdu words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt("/portal/coach/coach-training/1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("مخصوص تعریف سے آغاز");
    expect(screen.getByRole("button", { name: "پی ڈی ایف" })).toHaveAttribute("data-testid", "coach-format-pdf");
    expect(screen.getByRole("button", { name: "ویڈیو" })).toHaveAttribute("data-testid", "coach-format-video");
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("a module that does not exist goes back to the list", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    renderAt("/portal/coach/coach-training/11");
    expect(screen.getByText("the module list")).toBeTruthy();
  });
});

/**
 * bd-rlxkkt.12 — Module 10, "No evidence, no level" (the ICT HITL owner's DM, 10 Nov 2026), has its page but no video yet.
 * Its screen keeps the same two squares so nothing looks broken: PDF opens her page; Video says Coming soon and opens
 * nothing. Modules 1–9 keep their videos.
 */
describe("Module 10: its page now, its video coming soon", () => {
  beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    open = vi.fn(); vi.stubGlobal("open", open);
    progress.get.mockReset().mockResolvedValue({ success: true, done: {} });
    progress.set.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const renderAt = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={COACH_MODULE_PATH} element={<CoachTrainingModulePage />} />
        <Route path={COACH_TRAINING_PATH} element={<p>the module list</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it("English: Module 10's title; PDF opens her page; Video reads Coming soon, is off, and opens nothing", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    renderAt("/portal/coach/coach-training/10");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No evidence, no level");
    expect(screen.getByTestId("coach-training-module")).toHaveTextContent("Module 10");
    fireEvent.click(screen.getByTestId("coach-format-pdf"));
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/62371mmVGLxniEHz6VGRXx", "_blank", "noopener,noreferrer");
    const video = screen.getByTestId("coach-format-video");
    expect(video).toBeDisabled();
    expect(video).toHaveTextContent("Video");
    expect(video).toHaveTextContent("Coming soon");
    expect(video).toHaveAccessibleName("Video, Coming soon");
    open.mockClear();
    fireEvent.click(video);
    expect(open).not.toHaveBeenCalled();
  });

  it("Urdu: ویڈیو — جلد آ رہی ہے", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt("/portal/coach/coach-training/10");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ثبوت نہیں تو لیول نہیں");
    const video = screen.getByTestId("coach-format-video");
    expect(video).toBeDisabled();
    expect(video).toHaveTextContent("جلد آ رہی ہے");
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("modules 1–9 keep a working Video (no Coming soon)", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    renderAt("/portal/coach/coach-training/9");
    const video = screen.getByTestId("coach-format-video");
    expect(video).not.toBeDisabled();
    expect(video).not.toHaveTextContent("Coming soon");
    fireEvent.click(video);
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/MUxJFCkertstuJXnNNF9LC", "_blank", "noopener,noreferrer");
  });

  it("Mark done works on Module 10 (its key is evidence)", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    progress.set.mockResolvedValue({ success: true, done: { evidence: "2026-11-10T12:00:00.000Z" } });
    renderAt("/portal/coach/coach-training/10");
    fireEvent.click(await screen.findByTestId("coach-mark-done"));
    expect(progress.set).toHaveBeenCalledWith("evidence", true);
    expect(await screen.findByTestId("coach-module-done")).toHaveTextContent("Done");
  });
});

/**
 * bd-rlxkkt.9 — the ICT HITL owner, 6 Nov 2026: when a coach completes a module she gets a "complete" option here. Under
 * the PDF / Video choice: Mark done (the Training Library's own words); once done, a Done tick by the title and Mark not
 * done to undo. Saved per coach on the server (users.preferences.coach_training_done, via the portal API).
 */
describe("a module's screen: Mark done, and undo", () => {
  beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
    progress.get.mockReset();
    progress.set.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const renderAt = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path={COACH_MODULE_PATH} element={<CoachTrainingModulePage />} /></Routes>
    </MemoryRouter>,
  );

  it("not done yet: Mark done under the choice; a tap saves it, shows Done, and offers Mark not done", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    progress.get.mockResolvedValue({ success: true, done: {} });
    progress.set.mockResolvedValue({ success: true, done: { rehearse: "2026-11-06T09:00:00.000Z" } });
    renderAt("/portal/coach/coach-training/8");
    const mark = await screen.findByTestId("coach-mark-done");
    expect(mark).toHaveTextContent("Mark done");
    expect(screen.queryByTestId("coach-module-done")).toBeNull();
    const video = screen.getByTestId("coach-format-video");
    expect(video.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(mark);
    expect(progress.set).toHaveBeenCalledWith("rehearse", true);
    expect(await screen.findByTestId("coach-module-done")).toHaveTextContent("Done");
    expect(screen.getByTestId("coach-mark-not-done")).toHaveTextContent("Mark not done");
    expect(screen.queryByTestId("coach-mark-done")).toBeNull();
  });

  it("already done: Done shows at once, and Mark not done takes it back", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    progress.get.mockResolvedValue({ success: true, done: { praise: "2026-11-06T08:00:00.000Z" } });
    progress.set.mockResolvedValue({ success: true, done: {} });
    renderAt("/portal/coach/coach-training/1");
    expect(await screen.findByTestId("coach-module-done")).toBeTruthy();
    fireEvent.click(screen.getByTestId("coach-mark-not-done"));
    expect(progress.set).toHaveBeenCalledWith("praise", false);
    expect(await screen.findByTestId("coach-mark-done")).toBeTruthy();
    expect(screen.queryByTestId("coach-module-done")).toBeNull();
  });

  it("a save that fails says Not saved and leaves it as it was", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    progress.get.mockResolvedValue({ success: true, done: {} });
    progress.set.mockRejectedValue(new Error("boom"));
    renderAt("/portal/coach/coach-training/2");
    fireEvent.click(await screen.findByTestId("coach-mark-done"));
    expect(await screen.findByTestId("coach-progress-not-saved")).toHaveTextContent("Not saved");
    await waitFor(() => expect(screen.getByTestId("coach-mark-done")).toBeTruthy());
    expect(screen.queryByTestId("coach-module-done")).toBeNull();
  });

  it("Urdu: مکمل کریں, مکمل, نامکمل کریں", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    progress.get.mockResolvedValue({ success: true, done: {} });
    progress.set.mockResolvedValue({ success: true, done: { praise: "2026-11-06T09:00:00.000Z" } });
    renderAt("/portal/coach/coach-training/1");
    const mark = await screen.findByTestId("coach-mark-done");
    expect(mark).toHaveTextContent("مکمل کریں");
    fireEvent.click(mark);
    expect(await screen.findByTestId("coach-module-done")).toHaveTextContent("مکمل");
    expect(screen.getByTestId("coach-mark-not-done")).toHaveTextContent("نامکمل کریں");
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});

