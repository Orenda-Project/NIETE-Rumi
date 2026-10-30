import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, F, http, httpError, renderAt, serve, settle } from "./harness";
import { COPY } from "../copy";

/**
 * fix-r5 s6 (b), GO_PACKAGE v5 §0.4 b (qa-coach 103742, COS-deputy 103956; the operator's ruling 1, "decode B: each
 * coach for their own teachers"): R16 `POST /coachip/teacher-name` worked, but no screen called it. S2's step card now
 * carries "Show name (switched on by your programme)" when, and only when, `/coachip/me` says `decode: true`. A tap
 * posts `{code_id}` (the server writes one audit row per show), the name shows on that card only, "Hide name" forgets it,
 * and a 404 (another coach's code, the switch gone) shows no name. With the decode switch off nothing asks /coachip/me.
 * The name below is fictional (FIXTURES rules).
 */
const W = "W-IP-TIME";
const NAME = "Fictional Teacher Zed";
const CODE_ID = () => F[`w_${W}`].step_card.code.code_id as string;
const DECODE_ON = { coachV2: true, coachip: true, coachipDecode: true };

function world(decodeAnswer: unknown = () => ({ name: NAME, computed_at: "2026-10-26T05:12:00Z" }), me: unknown = { ...F.me_coach, decode: true }) {
  return { [`/coachip/w/${W}`]: F[`w_${W}`], "/coachip/me": me, "POST /coachip/teacher-name": decodeAnswer };
}
const posts = (path: string) => http.post.mock.calls.filter((c: unknown[]) => c[0] === path);
const gets = (path: string) => http.get.mock.calls.filter((c: unknown[]) => c[0] === path);

describe.each(["en", "ur"] as const)("fix-r5 s6 (b): S2's Show name (%s)", (lang) => {
  afterEach(() => cleanup());
  beforeEach(() => { http.get.mockReset(); http.post.mockReset(); });

  it("hidden when decode is off: no control, no /coachip/me, no teacher-name post (switch off in /config)", async () => {
    await boot(lang);
    serve(world());
    await renderAt(`/w/${W}`);
    expect(screen.getByTestId("step-card")).toBeTruthy();
    expect(screen.queryByTestId("decode-show")).toBeNull();
    expect(gets("/coachip/me")).toHaveLength(0);
    expect(posts("/coachip/teacher-name")).toHaveLength(0);
  }, 30000);

  it("hidden when /config has the switch but /coachip/me says decode false", async () => {
    await boot(lang, DECODE_ON);
    serve(world(undefined, { ...F.me_coach, decode: false }));
    await renderAt(`/w/${W}`);
    expect(gets("/coachip/me")).toHaveLength(1);
    expect(screen.queryByTestId("decode-show")).toBeNull();
  }, 30000);

  it("decode on: the tap posts exactly {code_id}, shows the name on the card, Hide forgets it, a second show asks again", async () => {
    await boot(lang, DECODE_ON);
    serve(world());
    const { container } = await renderAt(`/w/${W}`);
    const show = screen.getByTestId("decode-show");
    expect(screen.getByTestId("step-card").contains(show)).toBe(true);
    expect(show.textContent).toBe(COPY["decode.show"][lang]);
    expect(container.textContent).not.toContain(NAME);
    await act(async () => { fireEvent.click(show); });
    await settle();
    expect(posts("/coachip/teacher-name").map((c: unknown[]) => c[1])).toEqual([{ code_id: CODE_ID() }]);
    const name = screen.getByTestId("decode-name");
    expect(name.textContent).toBe(NAME);
    expect(screen.getByTestId("step-card").contains(name)).toBe(true);
    // the name is on the step card and nowhere else on the page
    expect(container.textContent!.split(NAME)).toHaveLength(2);
    await act(async () => { fireEvent.click(screen.getByTestId("decode-hide")); });
    expect(screen.queryByTestId("decode-name")).toBeNull();
    expect(container.textContent).not.toContain(NAME);
    expect(screen.getByTestId("decode-show")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("decode-show")); });
    await settle();
    expect(posts("/coachip/teacher-name")).toHaveLength(2);
    expect(screen.getByTestId("decode-name").textContent).toBe(NAME);
  }, 30000);

  it("another coach's code: the 404 path shows no name and says it could not be shown", async () => {
    await boot(lang, DECODE_ON);
    serve(world(() => { throw httpError(404, F.errors["404"]); }));
    const { container } = await renderAt(`/w/${W}`);
    await act(async () => { fireEvent.click(screen.getByTestId("decode-show")); });
    await settle();
    expect(posts("/coachip/teacher-name")).toHaveLength(1);
    expect(screen.queryByTestId("decode-name")).toBeNull();
    expect(container.textContent).not.toContain(NAME);
    expect(screen.getByTestId("decode-failed").getAttribute("role")).toBe("status");
  }, 30000);
});
