import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test", role: "coach", phoneNumber: "920000000000" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
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
  beforeEach(() => { open = vi.fn(); vi.stubGlobal("open", open); });
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
    renderAt("/portal/coach/coach-training/10");
    expect(screen.getByText("the module list")).toBeTruthy();
  });
});
