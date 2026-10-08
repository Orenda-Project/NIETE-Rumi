import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import Profile from "./Profile";

/**
 * bd-fmf24g.1 — teacher v2 My profile (canvas v28 Profile). Her name, phone and school are
 * shown but not editable: no route lets a teacher change them today (the coach's
 * Edit teacher is a coach-only path), so the page does not pretend. Her teaching level
 * IS hers to change — the same GET/POST /training/bands the band picker uses, with the
 * server's 48-hour lock.
 */
const BANDS = {
  success: true,
  options: [
    { id: "PRIMARY", title: "Primary (Grades 1-5)" },
    { id: "MIDDLE", title: "Middle (Grades 6-8)" },
    { id: "HIGH", title: "High (Grades 9-12)" },
  ],
  selected: ["PRIMARY"],
  can_change: true,
};

function renderProfile() {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Ayesha Bibi", role: "teacher", phoneNumber: "923001234567", schoolName: "IMSG I-10/1" },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/portal/teacher/profile"]}><Profile /></MemoryRouter>);
}

describe("teacher v2 My profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: BANDS } as never);
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } } as never);
  });

  it("name, phone and school are shown, not editable", async () => {
    renderProfile();
    expect(screen.getByTestId("profile-name")).toHaveTextContent("Ayesha Bibi");
    expect(screen.getByTestId("profile-phone")).toHaveTextContent("0300 1234567");
    expect(screen.getByTestId("profile-school")).toHaveTextContent("IMSG I-10/1");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("teaching level: the server's options, short labels, hers ticked", async () => {
    renderProfile();
    const primary = await screen.findByRole("checkbox", { name: /Primary/ });
    expect(primary).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /Middle/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: /High/ })).toHaveAttribute("aria-checked", "false");
    expect(api.get).toHaveBeenCalledWith("/training/bands");
  });

  it("she can pick more than one, and Save posts them", async () => {
    renderProfile();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Middle/ }));
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/bands", { bands: ["PRIMARY", "MIDDLE"] }));
    expect(await screen.findByTestId("profile-saved")).toBeTruthy();
  });

  it("inside the 48 hours: the choices and Save are off, with the hours left", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...BANDS, can_change: false, hours_remaining: 31 } } as never);
    renderProfile();
    expect(await screen.findByRole("checkbox", { name: /Primary/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
    expect(screen.getByTestId("profile-lock")).toHaveTextContent("31h");
  });

  it("a 429 on save shows the lock, not an error", async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 429 } });
    renderProfile();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /High/ }));
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(screen.getByTestId("profile-lock")).toBeTruthy());
    expect(screen.queryByTestId("profile-error")).toBeNull();
  });

  it("the levels did not load: a retry, never a blank", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("network"));
    renderProfile();
    expect(await screen.findByRole("button", { name: /Try again/ })).toBeTruthy();
  });
});
