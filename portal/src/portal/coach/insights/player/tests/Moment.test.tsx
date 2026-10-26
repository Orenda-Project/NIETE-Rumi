import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectNoIdentity, F, http, renderAt, serve } from "../../tests/harness";
import { domContract } from "../../count";
import { COPY } from "../../copy";

/**
 * bd-sex15q.16 — S4, the player page (`/portal/coach/insights/m/:momentId`, R6), through the real routes, gate, copy
 * and formatter; only the network is mocked (harness). Muted: play/pause/load are stubbed and never called before a tap.
 */
const LANGS = ["en", "ur"] as const;
const ID = F.moment.moment_id as string;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

let play: ReturnType<typeof vi.fn>;

describe.each(LANGS)("S4 player page (%s)", (lang) => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  beforeEach(async () => {
    http.get.mockReset();
    play = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as unknown as () => Promise<void>);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    await boot(lang);
  });

  it("coach: app bar, the sentence frame, the sub line, the full player; no autoplay; DOM contract", async () => {
    serve({ [`/coachip/m/${ID}`]: clone(F.moment) });
    const { container } = await renderAt(`/m/${ID}`);
    const page = screen.getByTestId("insights-moment");
    expect(page.textContent).toContain("T-07");
    expect(page.textContent).toContain("Govt. Primary School Fictional-03");
    const body = screen.getByTestId("s4-body");
    expect(within(body).getByTestId("s4-sentence").textContent).toContain(F.moment.w.sentence[lang]);
    expect(within(body).getByTestId("s4-sentence").textContent).toContain(lang === "en" ? "This is one of them." : "یہ ان میں سے ایک ہے۔");
    const sub = screen.getByTestId("s4-sub");
    if (lang === "en") expect(sub.textContent).toContain("Grade 3 Urdu");
    else expect(sub.textContent!.replace(/[\u2066-\u2069]/g, "")).toContain("جماعت ۳ Urdu");
    expect(sub.textContent).toContain("27:40");
    expect(sub.querySelector("[data-date]")).toBeTruthy();
    // the full variant is mounted, on the clip route
    expect(within(body).getByTestId("moment-player").getAttribute("data-variant")).toBe("full");
    const audio = within(body).getAllByTestId("moment-kit")[0].querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe(`/api/portal/coachip/m/${ID}/clip`);
    expect(play).not.toHaveBeenCalled();
    // read once, the moment only
    expect(http.get.mock.calls.map((c) => c[0])).toEqual([`/coachip/m/${ID}`]);
    const c = domContract(container);
    expect({ bare: c.bareDigits, nums: c.nums - c.numsWithDenWin, unresolved: c.unresolvedWins }).toEqual({ bare: [], nums: 0, unresolved: [] });
    if (lang === "ur") {
      expect(/·\s*[۰-۹]|[۰-۹]\s*·/.test(container.textContent || "")).toBe(false);
      expect(within(within(body).getAllByTestId("moment-kit")[0]).getByTestId("newui-audio").getAttribute("dir")).toBe("ltr");
    }
    expectNoIdentity(container, expect);
  }, 30000);

  it("See the move goes to the move page of this W", async () => {
    serve({ [`/coachip/m/${ID}`]: clone(F.moment), "/coachip/i/W-IP-TIME": () => { throw new Error("not needed"); } });
    await renderAt(`/m/${ID}`);
    fireEvent.click(screen.getByTestId("see-move"));
    await waitFor(() => expect(screen.queryByTestId("insights-moment")).toBeNull());
  }, 30000);

  it("RM circle form: school only in the app bar, no code, no sub line, no full recording", async () => {
    serve({ [`/coachip/m/${ID}`]: clone(F.moment_rm) });
    const { container } = await renderAt(`/m/${ID}`);
    const page = screen.getByTestId("insights-moment");
    expect(page.textContent).toContain("Govt. Primary School Fictional-03");
    expect(container.textContent).not.toMatch(/T-\d+/);
    expect(screen.queryByTestId("s4-sub")).toBeNull();
    expect(screen.queryByTestId("full-recording")).toBeNull();
    expect(screen.getByTestId("s4-sentence").textContent).toContain(F.moment_rm.w.sentence[lang]);
  }, 30000);

  it("clip failed: the session's audio plays from the moment, and the page says so", async () => {
    const id = F.moment_clip_failed.moment_id as string;
    serve({ [`/coachip/m/${id}`]: clone(F.moment_clip_failed) });
    await renderAt(`/m/${id}`);
    const audio = screen.getAllByTestId("moment-kit")[0].querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe(`/api/portal/coachip/session/${F.moment_clip_failed.session.session_id}/audio`);
    expect(screen.getByTestId("clip-failed").textContent).toContain("20:50");
    expect(screen.getByTestId("insights-moment").textContent).not.toMatch(/being prepared/i);
    expect(screen.getByTestId("gloss").textContent).not.toBe(COPY["s4.gloss.none"][lang]);
  }, 30000);

  it("not found: the 404 words, no player", async () => {
    serve({});
    await renderAt(`/m/${ID}`);
    expect(screen.getByTestId("insights-state").textContent).toBe(COPY["e.404"][lang]);
    expect(screen.queryByTestId("moment-player")).toBeNull();
  }, 30000);
});
