import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Round 20 (sa_r20_auto_end_section): the coach's End this section shows in RDF auto too, and asks the engine
// (sa:end_section) the same way as in RDF manual. It widens sa_end_section; on its own it shows nothing.

vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn() }));
import { keepScreenOn } from "../../lib/keepAwake";
import AssessEngineSlot from "./AssessEngineSlot";

const SID = "0b8f6c1e-3d2a-4c5b-9e7f-112233445566";

function setup(extra: Partial<Parameters<typeof AssessEngineSlot>[0]> = {}) {
  (keepScreenOn as any).mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  const onFinished = vi.fn();
  render(<AssessEngineSlot sessionId={SID} firstName="Ayan" lang="en" grade={3} block="rdf_auto" onFinished={onFinished} {...extra} />);
  const frame = screen.getByTestId("assess-engine-frame") as HTMLIFrameElement;
  const post = vi.fn();
  Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ postMessage: post, location: { search: "" } }) });
  return { post, onFinished };
}

describe("AssessEngineSlot round 20", () => {
  it("ON with sa_end_section, RDF auto: End this section asks, then tells the engine; the test stays open", () => {
    const { post, onFinished } = setup({ endSection: true, autoEndSection: true });
    fireEvent.click(screen.getByRole("button", { name: "End this section" }));
    fireEvent.click(screen.getByRole("button", { name: "End section" }));
    expect(post).toHaveBeenCalledWith({ type: "sa:end_section", s: SID }, window.location.origin);
    expect(onFinished).not.toHaveBeenCalled();
  });
  it("ON without sa_end_section: no button", () => {
    setup({ autoEndSection: true });
    expect(screen.queryByRole("button", { name: "End this section" })).toBeNull();
  });
  it("ON, the Whole battery: no button (RDF auto and RDF manual only)", () => {
    setup({ endSection: true, autoEndSection: true, block: "full" });
    expect(screen.queryByRole("button", { name: "End this section" })).toBeNull();
  });
});
