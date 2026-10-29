import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../services/api", () => ({ language: { get: vi.fn(), set: vi.fn() }, coach: { getHome: vi.fn() } }));
vi.mock("../../../lib/useChildTestSa", () => ({ useChildTestSa: vi.fn() }));
vi.mock("../../../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn }));
vi.mock("../useCoachip", () => ({ useCoachip: () => true, useCoachipRm: () => false }));
import { useAuth } from "../../../hooks/useAuth";
import { useChildTestSa } from "../../../lib/useChildTestSa";
import { coach, language } from "../../../services/api";
import CoachMore from "../../profile/CoachMore";
import { TEACHER_FRAME } from "../../../teacher/copy";

/**
 * bd-sex15q.46 (R6 fix cycle 1, FIX_R6 A7, panel 230158) — the coach's More with COACHIP on has no mixed screen: the
 * page heading is the design system's (24/800 navy inside the `.cp` root, not the kit's 32 px light title) and the
 * language row is a `.cp` row (lucide icon, the label, the coachip-ui EN | اردو) writing through the same one writer.
 * The kit's teacher More is untouched (more.flagOff stays byte-identical).
 */
const HEX = /\[#[0-9a-fA-F]{3,8}\]/;

describe.each(["en", "ur"] as const)("More with COACHIP on, no seam (%s)", (lang) => {
  beforeEach(async () => {
    vi.clearAllMocks();
    if (!i18n.isInitialized) await i18n.init({ lng: lang, resources: {} });
    await act(async () => { await i18n.changeLanguage(lang); });
    vi.mocked(useChildTestSa).mockReturnValue(false);
    vi.mocked(language.get).mockResolvedValue({ language: lang, locked: false });
    vi.mocked(language.set).mockResolvedValue(undefined);
    vi.mocked(coach.getHome).mockResolvedValue({ success: true, home: { today: [], counts: { schools: 3 } } } as never);
    vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Fixture Coach", role: "coach", phoneNumber: "920000000003" }, loading: false, logout: vi.fn() } as never);
  });
  afterEach(() => cleanup());

  const mount = () => render(<MemoryRouter initialEntries={["/portal/coach/more"]}><CoachMore /></MemoryRouter>);

  it("the heading is the design system's h1 inside a .cp root, and the kit's light title is not drawn", async () => {
    const { container } = mount();
    await act(async () => { await Promise.resolve(); });
    const h1s = container.querySelectorAll("h1");
    expect(h1s.length).toBe(1);
    const h1 = h1s[0];
    expect(h1.textContent).toBe(TEACHER_FRAME[lang].more.title);
    expect(h1.closest(".cp")).not.toBeNull();
    expect(h1.className).toContain("text-cp-navy");
    expect(h1.className).not.toContain("font-light");
  });

  it("no hex class inside the .cp roots, and the language row is a .cp row with the coachip-ui toggle that writes once", async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await act(async () => { await Promise.resolve(); });
    // inside the .cp roots (the page frame around them is the kit's TeacherPage, the flag-off look)
    const roots = Array.from(container.querySelectorAll<HTMLElement>(".cp"));
    expect(roots.length).toBeGreaterThan(0);
    const hex = roots.flatMap((r) => [r, ...Array.from(r.querySelectorAll<HTMLElement>("[class]"))])
      .flatMap((e) => (e.getAttribute("class") || "").split(/\s+/)).filter((c) => HEX.test(c));
    expect(hex).toEqual([]);
    const rows = screen.getAllByTestId("more-row-language");
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.closest(".cp")).not.toBeNull();
    expect(row.querySelector("[data-lang-toggle]")).not.toBeNull();
    const other = lang === "en" ? "ur" : "en";
    await user.click(within(row).getByTestId(`more-lang-${other}`));
    expect(language.set).toHaveBeenCalledTimes(1);
    expect(language.set).toHaveBeenCalledWith(other);
  });
});
