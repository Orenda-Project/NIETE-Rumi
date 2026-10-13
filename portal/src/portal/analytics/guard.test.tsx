import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext, type SharedAuth } from "../hooks/authContext";
import AnalyticsOnlyGuard from "./AnalyticsOnlyGuard";

/**
 * bd-s6qbts.3 — the ONE guard around the app's routes (App.tsx). An analytics-only account that opens any other
 * portal page — a bookmark, a shared link, the back button, a tap — is sent to the schools analytics page before
 * that page mounts. Anyone else who opens the analytics page goes to their own home. It never asks the server who
 * is signed in itself: a signed-out page (privacy, sign-in) must stay a page that reads nothing.
 */
const mounted: string[] = [];
function Page({ name }: { name: string }) {
  mounted.push(name);
  const { pathname } = useLocation();
  return (
    <div>
      <p data-testid="page">{name}</p>
      <p data-testid="where">{pathname}</p>
      <Link to="/portal/curriculum">to curriculum</Link>
    </div>
  );
}

const PATHS: Array<[string, string]> = [
  ["/portal/analytics/schools", "analytics"],
  ["/portal/dashboard", "dashboard"],
  ["/portal/curriculum", "curriculum"],
  ["/portal/account", "account"],
  ["/portal/leader", "leader"],
  ["/portal/coach", "coach"],
  ["/portal/teacher/lessons", "teacher v2"],
  ["/portal/login", "login"],
  ["/portal/setup/:token", "setup"],
  ["/portal/reset-password", "reset"],
  ["/portal/reset-password/verify", "reset verify"],
  ["/portal/privacy", "privacy"],
  ["/portal/delete-account", "delete account"],
];

function renderAt(entry: string, user: SharedAuth["user"], extra: Partial<SharedAuth> = {}) {
  const value: SharedAuth = { user, loading: false, request: vi.fn(), ...extra };
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[entry]}>
        <AnalyticsOnlyGuard>
          <Routes>
            {PATHS.map(([p, name]) => <Route key={p} path={p} element={<Page name={name} />} />)}
          </Routes>
        </AnalyticsOnlyGuard>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return value;
}

const analyticsUser = { firstName: "FDE", lastName: "", phoneNumber: "923000000000", role: "unregistered", analyticsOnly: true };
const teacher = { firstName: "Ayesha", lastName: "", phoneNumber: "923000000001", role: "teacher", analyticsOnly: false };
const coach = { firstName: "Noor", lastName: "", phoneNumber: "923000000002", role: "coach" };

beforeEach(() => { mounted.length = 0; });

describe("an analytics-only account", () => {
  it.each([
    "/portal/dashboard", "/portal/curriculum", "/portal/account", "/portal/leader", "/portal/coach", "/portal/teacher/lessons",
  ])("opening %s lands on the analytics page, and that page never mounts", (p) => {
    renderAt(p, analyticsUser);
    expect(screen.getByTestId("page")).toHaveTextContent("analytics");
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/analytics/schools");
    expect(mounted).toEqual(["analytics"]);
  });

  it.each([
    ["/portal/privacy", "privacy"],
    ["/portal/reset-password", "reset"],
    ["/portal/reset-password/verify", "reset verify"],
    ["/portal/delete-account", "delete account"],
    ["/portal/setup/abc123", "setup"],
    ["/portal/login", "login"],
    ["/portal/analytics/schools", "analytics"],
  ])("stays on %s", (p, name) => {
    renderAt(p, analyticsUser);
    expect(screen.getByTestId("page")).toHaveTextContent(name);
  });

  it("a tap to another portal page comes back to the analytics page", async () => {
    renderAt("/portal/privacy", analyticsUser);
    await userEvent.setup().click(screen.getByText("to curriculum"));
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/analytics/schools");
    expect(mounted).not.toContain("curriculum");
  });
});

describe("everyone else", () => {
  it("a teacher who opens the analytics page goes to the dashboard", () => {
    renderAt("/portal/analytics/schools", teacher);
    expect(screen.getByTestId("page")).toHaveTextContent("dashboard");
    expect(mounted).not.toContain("analytics");
  });

  it("a coach who opens the analytics page goes to My Patch", () => {
    renderAt("/portal/analytics/schools", coach);
    expect(screen.getByTestId("page")).toHaveTextContent("leader");
  });

  it.each([
    ["/portal/dashboard", "dashboard"], ["/portal/curriculum", "curriculum"], ["/portal/account", "account"], ["/portal/privacy", "privacy"],
  ])("a teacher on %s stays there", (p, name) => {
    renderAt(p, teacher);
    expect(screen.getByTestId("page")).toHaveTextContent(name);
  });

  it("a coach on her own pages stays there", () => {
    renderAt("/portal/coach", coach);
    expect(screen.getByTestId("page")).toHaveTextContent("coach");
  });

  it("while nobody is known yet the page renders as before (it reads the user itself)", () => {
    renderAt("/portal/dashboard", null, { loading: true });
    expect(screen.getByTestId("page")).toHaveTextContent("dashboard");
  });
});

it("never asks the server who is signed in (a signed-out page stays a page that reads nothing)", () => {
  const value = renderAt("/portal/privacy", null);
  expect(value.request).not.toHaveBeenCalled();
});

describe("App.tsx", () => {
  // Comments stripped first: a comment naming the guard must not pass for the guard itself.
  const app = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("wraps the whole route table in the guard, once", () => {
    expect(app.match(/<AnalyticsOnlyGuard>/g)).toHaveLength(1);
    expect(app).toMatch(/<AnalyticsOnlyGuard>\s*<Routes>[\s\S]*<\/Routes>\s*<\/AnalyticsOnlyGuard>/);
  });

  it("serves the analytics page at /portal/analytics/schools, as its own chunk", () => {
    expect(app).toMatch(/<Route path="\/portal\/analytics\/schools" element=\{<SchoolsAnalytics \/>\} \/>/);
    expect(app).toMatch(/^const SchoolsAnalytics = page\(\(\) => import\("\.\/portal\/analytics\/SchoolsAnalytics"\)\);$/m);
  });
});
