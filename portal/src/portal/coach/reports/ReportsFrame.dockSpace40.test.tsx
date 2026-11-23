import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-o15qnr.40.8 (queue #229, the operator 23 Nov 20:17, a phone screenshot: "Page not scrolling all the way on the
 * form") — on a Feedback Form view the last field (the 6-12 indicator's Evidence box) ended behind the sticky "Agree and
 * next" bar and the bottom menu. Every Reports frame with a bar now keeps room under its content for the bar, the menu
 * and the phone's safe area (and a notice or a running recording's bar above the menu), so the last field scrolls clear.
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach" }, loading: false }) }));
vi.mock("../ui", async (orig) => ({ ...(await orig<object>()), readPending: () => Promise.resolve(null) }));

import ReportsFrame from "./ReportsFrame";
import { RecordingBarShownContext } from "../../lib/recordingBarShown";

const frame = (dock: boolean, bar = false, bare = false) => render(
  <RecordingBarShownContext.Provider value={bar}>
    <MemoryRouter>
      <ReportsFrame title="Feedback Form" dock={dock ? <button type="button">Agree and next</button> : undefined} bare={bare} dockSpace>
        <p>last field</p>
      </ReportsFrame>
    </MemoryRouter>
  </RecordingBarShownContext.Provider>,
);

describe("ReportsFrame keeps room under the content for the bar, the menu and the safe area", () => {
  it("with a bar: a space after the content, bar + menu + safe area (+ a notice)", () => {
    frame(true);
    const space = screen.getByTestId("dock-space");
    expect(space.className).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(space.className).toMatch(/var\(--notice-h/);
    expect(space.className).toMatch(/168px/);
    // after the content
    expect(screen.getByText("last field").compareDocumentPosition(space) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a recording's bar above the menu: more room", () => {
    frame(true, true);
    expect(screen.getByTestId("dock-space").className).toMatch(/228px/);
  });

  it("no menu (bare): the bar and the safe area only", () => {
    frame(true, false, true);
    expect(screen.getByTestId("dock-space").className).toMatch(/88px/);
  });

  it("no bar: no space added", () => {
    frame(false);
    expect(screen.queryByTestId("dock-space")).toBeNull();
  });
});
