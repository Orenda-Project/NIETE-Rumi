import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-4joiqz — the leader menu (My Patch, Teachers, Observations…) gets Lesson Plans: the teacher Lesson Plans pages,
 * read as a leader. A principal who is NOT on the teacher app has no other way to them. It is in the phone's bottom
 * bar too (WhatsApp's in-app browser is a phone), not only behind Other.
 *
 * A teacher's menu is unchanged: her Lesson Plans is still today's page.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

function renderNav(user: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
}

/** The phone's bottom bar of the classic menu (the desktop bar is the other <nav>). */
const phoneBar = (container: HTMLElement) => container.querySelector("nav.md\\:hidden") as HTMLElement;

describe("the leader menu", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["principal", "coach", "aeo", "supervisor", "school_leader"])("%s: Lesson Plans → the Lesson Plans tab, on the desktop bar and the phone bar", (role) => {
    const { container } = renderNav({ firstName: "Sana", role });
    const links = screen.getAllByRole("link", { name: /Lesson Plans/ });
    expect(links.length).toBe(2);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/portal/teacher/lessons"));
    expect(within(phoneBar(container)).getByRole("link", { name: /Lesson Plans/ })).toHaveAttribute("href", "/portal/teacher/lessons");
    // The rest of the leader menu is as it was.
    expect(screen.queryAllByText("My Patch").length).toBeGreaterThan(0);
  });
});

describe("a teacher's menu (golden)", () => {
  it("Lesson Plans is still today's page", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    const links = screen.getAllByRole("link", { name: /Lesson Plans/ });
    links.forEach((l) => expect(l).toHaveAttribute("href", "/portal/curriculum"));
  });
});
