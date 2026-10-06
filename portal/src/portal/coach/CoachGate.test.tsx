import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("./useCoachV2", async (orig) => ({ ...(await orig<any>()), useCoachV2: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import { useCoachV2 } from "./useCoachV2";
import CoachGate from "./CoachGate";

/**
 * bd-o15qnr — the /portal/coach screens exist only for a coach with the flag.
 * Anyone else who lands on one (a bookmark, a shared link) goes to My Patch,
 * exactly as before; nothing of v2 renders while the flag is being read.
 */
function renderAt(user: Record<string, unknown> | null, flag: boolean | null) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useCoachV2).mockReturnValue(flag);
  return render(
    <MemoryRouter initialEntries={["/portal/coach"]}>
      <Routes>
        <Route path="/portal/coach" element={<CoachGate><div>v2 home</div></CoachGate>} />
        <Route path="/portal/leader" element={<div>my patch</div>} />
        <Route path="/portal/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CoachGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a coach with the flag sees the screen", () => {
    renderAt({ role: "coach", phoneNumber: "92300" }, true);
    expect(screen.getByText("v2 home")).toBeInTheDocument();
  });

  it("flag off: My Patch", () => {
    renderAt({ role: "coach", phoneNumber: "92300" }, false);
    expect(screen.getByText("my patch")).toBeInTheDocument();
  });

  it("a principal with the flag: My Patch", () => {
    renderAt({ role: "principal", phoneNumber: "92300" }, true);
    expect(screen.getByText("my patch")).toBeInTheDocument();
  });

  it("while the flag is read: nothing of v2", () => {
    renderAt({ role: "coach", phoneNumber: "92300" }, null);
    expect(screen.queryByText("v2 home")).toBeNull();
    expect(screen.queryByText("my patch")).toBeNull();
  });
});
