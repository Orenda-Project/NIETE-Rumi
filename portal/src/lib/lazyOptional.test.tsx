import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { lazyOptional } from "./lazyPage";

const Piece = () => <p>the piece</p>;

describe("lazyOptional (bd-sex15q.34)", () => {
  it("draws the piece once its chunk arrives", async () => {
    const P = lazyOptional(() => Promise.resolve({ default: Piece }));
    render(<Suspense fallback={null}><main>page<P /></main></Suspense>);
    expect(await screen.findByText("the piece")).toBeTruthy();
  });

  it("a chunk that fails once is asked for again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("chunk gone")).mockResolvedValue({ default: Piece });
    const P = lazyOptional(load, 10);
    render(<Suspense fallback={null}><main>page<P /></main></Suspense>);
    expect(await screen.findByText("the piece")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a chunk that never loads: the page stays, the piece is not drawn, nothing reloads", async () => {
    const reload = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...loc, reload } });
    try {
      const P = lazyOptional(() => Promise.reject(new Error("offline")), 10);
      render(<Suspense fallback={null}><main data-testid="page">page<P /></main></Suspense>);
      expect(await screen.findByTestId("page")).toBeTruthy();
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.getByTestId("page").textContent).toBe("page");
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: loc });
    }
  });
});
