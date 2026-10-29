import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, F, http } from "./harness";
import { domContract } from "../count";
import { COPY } from "../copy";
import { digits } from "../format";

/**
 * bd-sex15q.46 (R6 fix cycle 2, FIX_R6 §7.2 A13, panel 015904) — S7's empty page says what a result will be and when it
 * starts: S1's phonics line ("… · 12 of 30", the gate's progress, `data-nonum`) under the `s7-empty` card, from the home
 * payload read inside the gate (B7: with the switch off, no /coachip/ request).
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const emptyResults = () => {
  const d = clone(F.results);
  d.cells = [];
  d.empty = { status: "no_scope", message: { en: "x", ur: "x" }, detail: { graded: null, widened_to_weeks: null, as_of: null } };
  return d;
};
const homeGets = () => http.get.mock.calls.filter((c) => c[0] === "/coachip/home").length;

for (const lang of ["en", "ur"] as const) {
  describe(`A13: S7 empty with the phonics line (${lang})`, () => {
    beforeEach(async () => { await boot(lang); http.get.mockReset(); });
    afterEach(() => cleanup());

    it("renders S1's phonics line under the empty card, from one home read", async () => {
      serve({ "/coachip/results": emptyResults(), "/coachip/home": F.home });
      const { container } = await renderAt("/stats/results");
      const empty = screen.getByTestId("s7-empty");
      const tile = screen.getByTestId("s1-phonics");
      // the tile comes after the empty card in document order
      expect(empty.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const line = screen.getByTestId("s1-phonics-line");
      expect(line.hasAttribute("data-nonum")).toBe(true);
      expect((line.textContent || "").replace(/[\u2066-\u2069]/g, "")).toBe(COPY["s1.phonics.line"][lang].replace("{read}", digits(F.home.phonics.read, lang)));
      expect(homeGets()).toBe(1);
      // no count on the page; the line's 30 is the gate's size (data-nonum), so nothing bare
      expect(domContract(container).bareDigits).toEqual([]);
      expect(domContract(container).unresolvedWins).toEqual([]);
    }, 20000);

    it("paused: the held line, still one line under the empty card", async () => {
      serve({ "/coachip/results": emptyResults(), "/coachip/home": F.home_phonics_paused });
      await renderAt("/stats/results");
      expect(screen.getByTestId("s1-phonics").getAttribute("data-status")).toBe("paused");
      expect(screen.getByTestId("s1-phonics-line").textContent).toBe(COPY["s1.phonics.paused"][lang]);
    }, 20000);

    it("a home read that fails leaves the empty card alone", async () => {
      serve({ "/coachip/results": emptyResults() });
      await renderAt("/stats/results");
      expect(screen.getByTestId("s7-empty").textContent).toBe(COPY["s7.empty.none"][lang]);
      expect(screen.queryByTestId("s1-phonics")).toBeNull();
    }, 20000);

    it("with the switch off, S7 makes no /coachip/ request", async () => {
      await boot(lang, { coachV2: true, coachip: false });
      http.get.mockReset();
      serve({ "/coachip/results": emptyResults(), "/coachip/home": F.home });
      await renderAt("/stats/results");
      expect(http.get.mock.calls.filter((c) => String(c[0]).startsWith("/coachip/"))).toEqual([]);
    }, 20000);
  });
}
