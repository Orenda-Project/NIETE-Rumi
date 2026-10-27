import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { language } from "../../services/api";
import { boot, renderRm, rmWorld, serve, settle } from "./harness";

/**
 * fix-r5 s2 item 12 (qa-rm R7 FAIL 20261027T072545): the RM pages had their EN | اردو switch only inside the laptop
 * top nav (`hidden md:block`), so a phone at 390 px had none. A switch must exist OUTSIDE every `md:`-only container
 * (jsdom has no layout: the test walks the ancestors' classes, the way the browser decides `display`), and tapping
 * its اردو must go through the one writer (useLanguageSwitch → language.set).
 */
function hiddenBelowMd(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cls = (n.getAttribute("class") || "").split(/\s+/);
    if (cls.includes("hidden") && cls.some((c) => /^md:(block|flex|grid|inline)/.test(c))) return true;
  }
  return false;
}

describe("the RM language switch on a phone", () => {
  beforeEach(async () => {
    await boot("en");
    serve(rmWorld());
    vi.mocked(language.set).mockResolvedValue({ success: true, language: "ur" } as never);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it.each(["", "/coaches", "/circle", "/stats", "/coach/00000000-0000-4000-8000-070000000003"])("%s: an rm-lang-ur shows below md and writes through language.set", async (sub) => {
    await renderRm(sub);
    const phone = screen.getAllByTestId("rm-lang-ur").filter((b) => !hiddenBelowMd(b));
    expect(phone).toHaveLength(1);
    await act(async () => { fireEvent.click(phone[0]); });
    await settle();
    expect(vi.mocked(language.set)).toHaveBeenCalledWith("ur");
  });
});
