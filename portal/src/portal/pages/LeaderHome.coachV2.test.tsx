import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr — a coach in the v2 pilot lands on the v2 Home, not My Patch.
 * Everyone else (flag off, or not a coach) keeps My Patch exactly as before.
 */

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../coach/useCoachV2", async (orig) => ({ ...(await orig<any>()), useCoachV2: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getOverview: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { useCoachV2 } from "../coach/useCoachV2";
import { leader } from "../services/api";
import LeaderHome from "./LeaderHome";

function renderAt(role: string, flag: boolean | null) {
  vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Hataf", role, phoneNumber: "923001234567" }, loading: false } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useCoachV2).mockReturnValue(flag);
  return render(
    <MemoryRouter initialEntries={["/portal/leader"]}>
      <Routes>
        <Route path="/portal/leader" element={<LeaderHome />} />
        <Route path="/portal/coach" element={<div>v2 home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LeaderHome with coach v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (leader as any).getOverview.mockResolvedValue({ success: true, overview: null });
  });

  it("a coach with the flag goes to the v2 Home", async () => {
    renderAt("coach", true);
    await waitFor(() => expect(screen.getByText("v2 home")).toBeInTheDocument());
  });

  it("flag off: My Patch stays", async () => {
    renderAt("coach", false);
    await waitFor(() => expect((leader as any).getOverview).toHaveBeenCalled());
    expect(screen.queryByText("v2 home")).toBeNull();
  });

  it("a principal with the flag: My Patch stays", async () => {
    renderAt("principal", true);
    await waitFor(() => expect((leader as any).getOverview).toHaveBeenCalled());
    expect(screen.queryByText("v2 home")).toBeNull();
  });
});
