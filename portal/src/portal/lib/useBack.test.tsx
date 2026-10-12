import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { BackLink, useBack } from "./useBack";

/**
 * bd-fmf24g.68 — Back means the screen she was just on. One helper for every header: browser history back when an
 * in-app screen is behind this one; the page's fixed parent (backTo) only when nothing is (a fresh tab, a link from
 * WhatsApp, the first page after login).
 */

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}
function Btn({ to }: { to?: string }) {
  const back = useBack(to);
  return <button type="button" onClick={back}>Back</button>;
}
function Lnk({ to }: { to: string }) {
  return <BackLink to={to}>Back link</BackLink>;
}

const setIdx = (idx: number | null) => {
  window.history.replaceState(idx == null ? null : { idx, key: "k" }, "");
};
afterEach(() => setIdx(null));

describe("useBack", () => {
  it("goes one step back in history when an in-app screen is behind, NOT to backTo", () => {
    render(
      <MemoryRouter initialEntries={["/portal/dashboard", "/portal/coaching", "/portal/lessons"]} initialIndex={2}>
        <Routes><Route path="*" element={<><Btn to="/portal/dashboard" /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coaching$/);
  });

  it("with nothing behind (the first entry), goes to backTo", () => {
    render(
      <MemoryRouter initialEntries={["/portal/lessons"]}>
        <Routes><Route path="*" element={<><Btn to="/portal/dashboard" /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/dashboard$/);
  });

  it("the first page after login (a replaced entry has a new key but the history index is still 0) goes to backTo", () => {
    setIdx(0);
    render(
      <MemoryRouter initialEntries={["/portal/dashboard", "/portal/lessons"]} initialIndex={1}>
        <Routes><Route path="*" element={<><Btn to="/portal/dashboard" /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/dashboard$/);
  });

  it("replaces the entry when it falls back, so Back does not bounce", () => {
    render(
      <MemoryRouter initialEntries={["/portal/lessons"]}>
        <Routes><Route path="*" element={<><Btn to="/portal/dashboard" /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // one entry still: a second Back has nothing behind it and goes to backTo again, not to /portal/lessons
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/dashboard$/);
  });
});

describe("BackLink", () => {
  it("is a link to backTo (href kept) that goes back in history when there is a screen behind", () => {
    render(
      <MemoryRouter initialEntries={["/portal/dashboard", "/portal/coaching", "/portal/lessons"]} initialIndex={2}>
        <Routes><Route path="*" element={<><Lnk to="/portal/dashboard" /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    const a = screen.getByRole("link", { name: "Back link" });
    expect(a).toHaveAttribute("href", "/portal/dashboard");
    fireEvent.click(a);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/coaching$/);
  });

  it("goes to backTo when nothing is behind", () => {
    render(
      <MemoryRouter initialEntries={["/portal/lessons"]}>
        <Routes><Route path="*" element={<><Lnk to="/portal/dashboard" /><Link to="/x">x</Link><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Back link" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/dashboard$/);
  });
});
