import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * fix-r5 s5 (red-3 161102 fail, B22 config B): the RM surface asks for a circle moment in RM context. A dual who is
 * RM of the sector they coach in must get the RM circle form, so the RM client sends `?as=rm` (the server honours it
 * only for an RM session). Network boundary only: the house axios client.
 */
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { rm } from "../api";

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: { moment_id: "m-1" } } as never);
});

describe("rm.moment asks in RM context", () => {
  it("GET /coachip/m/:id with params { as: 'rm' } and nothing else", async () => {
    await rm.moment("00000000-0000-4000-8000-000000000001");
    expect(vi.mocked(api.get).mock.calls).toEqual([
      ["/coachip/m/00000000-0000-4000-8000-000000000001", { params: { as: "rm" } }],
    ]);
  });
});
