import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * All DC observations starts on the range in its address (?range=custom&from=&to=), so Home's "DC observations" tile
 * opens the same 30 days it counted. Without it, This month as today.
 */
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: {} }));

import "../routes";
import api from "../../services/api";
import { CoachingAllPage } from "./CoachingAll";
import { COACHING_ALL } from "./paths";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockRejectedValue(new Error("down"));
});
const at = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><Routes><Route path={COACHING_ALL} element={<CoachingAllPage />} /></Routes></MemoryRouter>,
);

describe("All DC observations, the address's range", () => {
  it("?range=custom&from=&to= → asked for those dates", async () => {
    at(`${COACHING_ALL}?range=custom&from=2026-10-01&to=2026-10-30`);
    await waitFor(() => expect(http.get.mock.calls[0]?.[1]?.params).toMatchObject({ from: "2026-10-01", to: "2026-10-30", prevFrom: "2026-09-01", prevTo: "2026-09-30" }));
  });

  it("no range in the address → This month", async () => {
    at(COACHING_ALL);
    await waitFor(() => expect(http.get.mock.calls[0]?.[1]?.params?.from).toMatch(/^\d{4}-\d{2}-01$/));
  });
});
