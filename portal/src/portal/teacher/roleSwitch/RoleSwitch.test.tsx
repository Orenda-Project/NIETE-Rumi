import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../coach/CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
  coach: { getHome: vi.fn() },
  leader: { getOverview: vi.fn() },
}));
import api, { coach, leader, portal } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import { resetTeacherV2Memory } from "../useTeacherV2";
import RoleSwitch from "./RoleSwitch";
import { leave } from "./leave";
import Profile from "../pages/Profile";
import CoachProfile from "../../coach/profile/CoachProfile";
import LeaderHome from "../../pages/LeaderHome";

/**
 * bd-tacnwy — "Profile type": an internal tester switches her OWN users.role (teacher, coach, principal) from the
 * portal. Drawn only when GET /config says features.roleSwitch (the server's portal_role_switch list); every real
 * teacher and coach sees nothing. One tap on another type asks first (the kit's ConfirmTray, with the warning to
 * finish any recording), then POST /me/role and a full reload into /portal, which lands her in that type's app.
 * It is on all three places she can land: the teacher's My profile, the coach's My profile, and My Patch (where a
 * principal lands today).
 */
const config = (on: boolean) => ({
  success: true,
  roleSwitchRoles: on ? ["teacher", "coach", "principal"] : [],
  features: { assessmentGenerator: false, assessmentGeneratorMessage: null, roleSwitch: on },
});

function asUser(role: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Hataf Atif", role, phoneNumber: "923001234567", schoolName: "IMSG I-10/1" },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function renderSwitch(role = "teacher") {
  asUser(role);
  return render(<MemoryRouter><RoleSwitch /></MemoryRouter>);
}

let leaveTo: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.clearAllMocks();
  forgetConfig();
  resetTeacherV2Memory();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.mocked(portal.getConfig).mockResolvedValue(config(true) as never);
  vi.mocked(api.get).mockResolvedValue({ data: { options: [], selected: [] } } as never);
  vi.mocked(api.post).mockResolvedValue({ data: { success: true, changed: true, from: "teacher", to: "coach" } } as never);
  vi.mocked(coach.getHome).mockResolvedValue({ success: true, home: { today: [], counts: { teachers: 3, schools: 1 } } } as never);
  vi.mocked(leader.getOverview).mockResolvedValue({ success: true, overview: null } as never);
  leaveTo = vi.spyOn(leave, "to").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("who sees it", () => {
  it("not on the list (/config roleSwitch false): nothing is drawn", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue(config(false) as never);
    renderSwitch();
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(portal.getConfig).toHaveBeenCalled());
    expect(screen.queryByTestId("role-switch")).toBeNull();
    expect(screen.queryByText("Profile type")).toBeNull();
  });

  it("/config cannot be read: nothing is drawn (fail closed)", async () => {
    vi.mocked(portal.getConfig).mockRejectedValue(new Error("down"));
    renderSwitch();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("role-switch")).toBeNull();
  });

  it("on the list: Profile type, a Testers only chip, the three types, hers selected", async () => {
    renderSwitch("teacher");
    const box = await screen.findByTestId("role-switch");
    expect(box).toHaveTextContent("Profile type");
    expect(box).toHaveTextContent("Testers only");
    expect(within(box).getByRole("button", { name: /Teacher/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(box).getByRole("button", { name: /Coach/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(box).getByRole("button", { name: /Principal/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("the server's role list decides the rows", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ ...config(true), roleSwitchRoles: ["teacher", "coach"] } as never);
    renderSwitch("coach");
    const box = await screen.findByTestId("role-switch");
    expect(within(box).queryByRole("button", { name: /Principal/ })).toBeNull();
    expect(within(box).getByRole("button", { name: /Coach/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("one switch", () => {
  it("another type asks first, with the recording warning; Switch posts it and reloads into /portal", async () => {
    renderSwitch("teacher");
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("role-switch")).getByRole("button", { name: /Coach/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Switch to Coach");
    expect(dialog).toHaveTextContent("Finish any recording first");
    expect(api.post).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/me/role", { role: "coach" }));
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/portal"));
  });

  it("tapping the type she already is does nothing", async () => {
    renderSwitch("teacher");
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("role-switch")).getByRole("button", { name: /Teacher/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("Cancel closes it: nothing posted, no reload", async () => {
    renderSwitch("teacher");
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("role-switch")).getByRole("button", { name: /Principal/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.post).not.toHaveBeenCalled();
    expect(leaveTo).not.toHaveBeenCalled();
  });

  it("a failed switch says Not switched and stays", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("502"));
    renderSwitch("teacher");
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("role-switch")).getByRole("button", { name: /Coach/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Switch" }));
    expect(await screen.findByTestId("role-switch-error")).toHaveTextContent("Not switched");
    expect(leaveTo).not.toHaveBeenCalled();
  });
});

describe("Urdu", () => {
  it("the ontology's words: پروفائل کی قسم، ٹیچر، کوچ، ہیڈ ٹیچر", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderSwitch("teacher");
    const box = await screen.findByTestId("role-switch");
    expect(box).toHaveTextContent("پروفائل کی قسم");
    expect(within(box).getByRole("button", { name: /^ٹیچر/ })).toBeTruthy();
    expect(within(box).getByRole("button", { name: /کوچ/ })).toBeTruthy();
    expect(within(box).getByRole("button", { name: /ہیڈ ٹیچر/ })).toBeTruthy();
  });
});

describe("where it is: every app a tester can land in", () => {
  it("the teacher's My profile", async () => {
    asUser("teacher");
    render(<MemoryRouter initialEntries={["/portal/teacher/profile"]}><Profile /></MemoryRouter>);
    expect(await screen.findByTestId("role-switch")).toBeTruthy();
  });

  it("the coach's My profile", async () => {
    asUser("coach");
    render(<MemoryRouter initialEntries={["/portal/coach/profile"]}><CoachProfile /></MemoryRouter>);
    expect(await screen.findByTestId("role-switch")).toBeTruthy();
  });

  it("My Patch, where a principal lands", async () => {
    asUser("principal");
    render(<MemoryRouter><LeaderHome /></MemoryRouter>);
    expect(await screen.findByTestId("role-switch")).toBeTruthy();
  });

  it("off, none of the three draws it", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue(config(false) as never);
    asUser("teacher");
    const a = render(<MemoryRouter><Profile /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("role-switch")).toBeNull();
    a.unmount();
    asUser("coach");
    const b = render(<MemoryRouter><CoachProfile /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("role-switch")).toBeNull();
    b.unmount();
    asUser("principal");
    render(<MemoryRouter><LeaderHome /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("role-switch")).toBeNull();
  });
});
