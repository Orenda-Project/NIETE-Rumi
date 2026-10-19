import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/api", () => ({
  default: { defaults: { baseURL: "/api/portal" }, get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
}));
import api, { portal } from "../../services/api";
import { forgetConfig } from "../../lib/useNewUi";
import { DISAGREE } from "./copy";
import { untranslated } from "../../teacher/i18n";
import { disagreements, readDisagreementsOn } from "./api";

/** bd-tbprit.3 — the disagreements API client, its flag (fail-closed) and its copy (both languages, complete). */
const A = vi.mocked(api);
const P = vi.mocked(portal);
beforeEach(() => { vi.clearAllMocks(); forgetConfig(); });

describe("disagreements api", () => {
  it("the clip is the portal's own path, whole seconds, never below zero", () => {
    expect(disagreements.clipUrl("abc", 190.7)).toBe("/api/portal/coach/disagreements/abc/clip?at=190");
    expect(disagreements.clipUrl("abc", -3)).toBe("/api/portal/coach/disagreements/abc/clip?at=0");
  });

  it("list, card and visited read the routes", async () => {
    A.get.mockResolvedValueOnce({ data: { success: true, todo: [], done: [] } });
    expect(await disagreements.list()).toEqual({ success: true, todo: [], done: [] });
    A.get.mockResolvedValueOnce({ data: { success: true, card: { id: "x" } } });
    expect(await disagreements.card("x")).toEqual({ id: "x" });
    expect(A.get).toHaveBeenLastCalledWith("/coach/disagreements/x");
    A.post.mockResolvedValueOnce({ data: { success: true, done: true } });
    expect(await disagreements.visited("x")).toBe(true);
    A.post.mockRejectedValueOnce(new Error("500"));
    expect(await disagreements.visited("x")).toBe(false);
  });

  it("the flag: only a real true is on; a failed read is off", async () => {
    P.getConfig.mockResolvedValueOnce({ features: { coachDisagreements: true } });
    expect(await readDisagreementsOn()).toBe(true);
    forgetConfig();
    P.getConfig.mockResolvedValueOnce({ features: { coachDisagreements: "yes" } });
    expect(await readDisagreementsOn()).toBe(false);
    forgetConfig();
    P.getConfig.mockRejectedValueOnce(new Error("down"));
    expect(await readDisagreementsOn()).toBe(false);
  });

  it("every word has its Urdu", () => {
    expect(untranslated(DISAGREE, ["dash", "arrow"])).toEqual([]);
  });
});
