import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * All lesson plans starts on the range in its address (?range=custom&from=&to=, the newui rangeFromSearch rule), so
 * Home's "Plans opened" tile opens the same 30 days it counted. Without it, This month as today.
 */
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { LessonsAllPage } from "./LessonsAll";
import { LESSONS_ALL } from "./paths";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (url: string) => {
    if (url === "/me/grade-subjects") return { data: { success: true, combos: [] } };
    throw Object.assign(new Error("404"), { response: { status: 404 } });
  });
});
const asked = () => http.get.mock.calls.filter(([u]) => u === "/lesson-plans/history").pop()?.[1]?.params;
const at = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><Routes><Route path={LESSONS_ALL} element={<LessonsAllPage />} /></Routes></MemoryRouter>,
);

describe("All lesson plans, the address's range", () => {
  it("?range=custom&from=&to= → asked for those dates and the 30 before", async () => {
    at(`${LESSONS_ALL}?range=custom&from=2026-10-01&to=2026-10-30`);
    await waitFor(() => expect(asked()).toMatchObject({ range: "custom", from: "2026-10-01", to: "2026-10-30", prevFrom: "2026-09-01", prevTo: "2026-09-30" }));
  });

  it("no range in the address → This month, as today", async () => {
    at(LESSONS_ALL);
    await waitFor(() => expect(asked()?.from).toMatch(/^\d{4}-\d{2}-01$/));
  });
});
