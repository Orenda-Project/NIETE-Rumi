import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-43f1sk — an Urdu teacher's FIRST open (WhatsApp's browser, nothing remembered) drew the Home in English, then
 * GET /me/language turned the page to Urdu: the band grew 25 px and everything below jumped (CLS ~0.36 on staging,
 * 4 Nov 2026), then the Nastaliq font landed (+4 px). The gate now holds the page's outline until her language is
 * applied (and, for Urdu, its font has loaded), so the page is drawn once, in her language. Capped, so a slow or failed
 * read never keeps her waiting: after the cap the page draws as before.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
const get = vi.hoisted(() => vi.fn());
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get, set: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import TeacherGate from "./TeacherGate";
import { resetTeacherV2Memory } from "./useTeacherV2";
import { LANGUAGE_WAIT_MS, resetLanguageFollow } from "./i18n";

type BootWindow = Window & { __nieteBoot?: Record<string, unknown> };
const TEACHER = { id: "t-1", role: "teacher", phoneNumber: "923001110001" };

/** The page records the language it was FIRST drawn in. */
const firstDrawn: string[] = [];
function Page() {
  if (!firstDrawn.length) firstDrawn.push(i18n.language);
  return <p>v2 page</p>;
}

async function flush(n = 8) {
  for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); });
}

function visit() {
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { teacherV2: true } } as never);
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<TeacherGate><Page /></TeacherGate>} />
      </Routes>
    </MemoryRouter>,
  );
}

const fontLoad = vi.fn<(font: string, text?: string) => Promise<unknown>>();

beforeEach(async () => {
  vi.clearAllMocks();
  firstDrawn.length = 0;
  resetTeacherV2Memory();
  resetLanguageFollow();
  delete (window as BootWindow).__nieteBoot;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  fontLoad.mockResolvedValue([]);
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: fontLoad, ready: Promise.resolve() } });
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as BootWindow).__nieteBoot;
  delete (document as { fonts?: unknown }).fonts;
});

describe("the teacher app is drawn once, in her language (bd-43f1sk)", () => {
  it("while her stored language is being read: the outline, not the page", async () => {
    get.mockReturnValue(new Promise(() => {}));
    visit();
    await flush();
    expect(screen.queryByText("v2 page")).toBeNull();
    expect(document.querySelector('[data-frame="teacher-look"]')).not.toBeNull();
  });

  it("Urdu stored: the page is FIRST drawn in Urdu, never English first", async () => {
    get.mockResolvedValue({ language: "ur", locked: false });
    visit();
    await flush();
    expect(await screen.findByText("v2 page")).toBeTruthy();
    expect(firstDrawn).toEqual(["ur"]);
  });

  it("Urdu: the Nastaliq face is loaded before the page draws", async () => {
    get.mockResolvedValue({ language: "ur", locked: false });
    let fontLanded!: () => void;
    fontLoad.mockReturnValue(new Promise((r) => { fontLanded = () => r([]); }));
    visit();
    await flush();
    expect(fontLoad).toHaveBeenCalledWith(expect.stringContaining("NIETE Nastaliq"), expect.any(String));
    expect(screen.queryByText("v2 page")).toBeNull();
    fontLanded();
    expect(await screen.findByText("v2 page")).toBeTruthy();
    expect(firstDrawn).toEqual(["ur"]);
  });

  it("English stored on an English page: drawn as soon as the read answers, no font wait", async () => {
    get.mockResolvedValue({ language: "en", locked: true });
    visit();
    expect(await screen.findByText("v2 page")).toBeTruthy();
    expect(firstDrawn).toEqual(["en"]);
    expect(fontLoad).not.toHaveBeenCalled();
  });

  it(`an unanswered read never keeps her waiting: the page draws after ${LANGUAGE_WAIT_MS} ms, in the language it has`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockReturnValue(new Promise(() => {}));
    visit();
    await flush();
    expect(screen.queryByText("v2 page")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(LANGUAGE_WAIT_MS + 10); });
    await flush();
    expect(screen.getByText("v2 page")).toBeTruthy();
    expect(firstDrawn).toEqual(["en"]);
  });

  it("index.html's boot read of /me/language is taken instead of asking again", async () => {
    (window as BootWindow).__nieteBoot = { language: Promise.resolve({ success: true, language: "ur", locked: false }), done: {} };
    visit();
    expect(await screen.findByText("v2 page")).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(firstDrawn).toEqual(["ur"]);
  });

  it("asked once per page load: the next v2 page in the same visit is drawn at once", async () => {
    get.mockResolvedValue({ language: "ur", locked: false });
    const first = visit();
    expect(await screen.findByText("v2 page")).toBeTruthy();
    first.unmount();
    visit();
    expect(screen.getByText("v2 page")).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("the Latin face is loaded before the page draws too (a late swap re-wrapped the school line and moved the band)", async () => {
    get.mockResolvedValue({ language: "ur", locked: false });
    let latinLanded!: () => void;
    fontLoad.mockImplementation((font: string) => (font.includes("Plus Jakarta Sans") ? new Promise((r) => { latinLanded = () => r([]); }) : Promise.resolve([])));
    visit();
    await flush();
    expect(fontLoad).toHaveBeenCalledWith(expect.stringContaining("Plus Jakarta Sans"), expect.any(String));
    expect(screen.queryByText("v2 page")).toBeNull();
    latinLanded();
    expect(await screen.findByText("v2 page")).toBeTruthy();
  });
});
