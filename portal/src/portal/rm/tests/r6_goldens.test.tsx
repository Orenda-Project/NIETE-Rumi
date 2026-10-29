import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderRm, rmWorld, serve } from "./harness";

/**
 * bd-sex15q.47 (R6 ux-rm) — one golden per RM page with the switch on, from c-api's fictional fixture, in English and
 * Urdu: the baseline the next restyle diffs against (the RM deck had none, CODE_MAP §4). The page root is snapshotted
 * (the RM menu is ux-system's and has its own tests). Regenerate deliberately (`vitest -u`) and read the diff.
 */
type Lang = "en" | "ur";
const C03 = "00000000-0000-4000-8000-070000000003";
const PAGES: [string, string][] = [["", "rm-home"], ["/coaches", "rm-coaches"], [`/coach/${C03}`, "rm-coach"], ["/circle", "rm-circle"], ["/stats", "rm-stats"]];

describe.each(["en", "ur"] as Lang[])("RM goldens (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it.each(PAGES)("%s (%s)", async (sub, id) => {
    await renderRm(sub);
    expect(screen.getByTestId(id).innerHTML).toMatchSnapshot();
  });
});
