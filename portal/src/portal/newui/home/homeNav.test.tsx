import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-5rz1v.17 — Home's band carries her avatar (DESIGN.md "The menu"): on a page that draws
 * its own heading the phone's slim indigo strip goes, and the avatar in the band opens the SAME
 * account sheet the menu owns. Home stays lit on Home's own inner pages.
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import { resetNewUiMemory } from "../../lib/useNewUi";
import PortalNavigation from "../../components/PortalNavigation";
import { AccountAvatar } from "../NewUiNavigation";
import { closeAccountSheet, isAccountSheetOpen, openAccountSheet } from "../accountSheet";

const TEACHER = { id: "t-1", firstName: "Ayesha Khan", role: "teacher", phoneNumber: "923001234567" };

function renderNav(path: string, hideStrip?: boolean) {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: true } } as never);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PortalNavigation hideStrip={hideStrip} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
  act(() => closeAccountSheet());
});

describe("the account sheet is shared", () => {
  it("an avatar anywhere opens the menu's account sheet", async () => {
    renderNav("/portal/dashboard", true);
    await screen.findByTestId("newui-bottom-nav");
    expect(screen.queryByRole("dialog")).toBeNull();
    render(<AccountAvatar name="Ayesha Khan" testId="band-avatar" />);
    const avatar = screen.getByTestId("band-avatar");
    expect(avatar).toHaveAccessibleName("Account");
    expect(avatar).toHaveTextContent("AK");
    fireEvent.click(avatar);
    expect(isAccountSheetOpen()).toBe(true);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("My account")).toBeInTheDocument();
  });

  it("closing the sheet closes it for everyone", async () => {
    renderNav("/portal/dashboard", true);
    await screen.findByTestId("newui-bottom-nav");
    act(() => openAccountSheet());
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByTestId("newui-sheet-close"));
    expect(isAccountSheetOpen()).toBe(false);
  });
});

describe("the phone's top strip", () => {
  it("goes when the page draws its own heading (the band carries the avatar)", async () => {
    renderNav("/portal/dashboard", true);
    await screen.findByTestId("newui-bottom-nav");
    expect(screen.queryByTestId("newui-top-strip")).toBeNull();
    // The desktop bar keeps its avatar.
    expect(within(screen.getByTestId("newui-top-nav")).getByRole("button", { name: "Account" })).toBeInTheDocument();
  });

  it("stays on pages that have no heading yet", async () => {
    renderNav("/portal/curriculum");
    expect(await screen.findByTestId("newui-top-strip")).toBeInTheDocument();
  });
});

describe("Home is lit on Home's own pages", () => {
  it.each(["/portal/dashboard", "/portal/dashboard/lesson-plans", "/portal/dashboard/coaching"])("%s", async (path) => {
    renderNav(path, true);
    const bar = await screen.findByTestId("newui-bottom-nav");
    expect(within(bar).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
});
