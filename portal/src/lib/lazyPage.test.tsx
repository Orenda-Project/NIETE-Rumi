/**
 * bd-fxk3t8 — a page in its own chunk survives a deploy.
 *
 * Chunk names are content hashes and a deploy removes the old files, so a teacher who had
 * the app open before the deploy asks for a chunk that is gone. The app reloads once (the
 * new index.html names the new chunks); a second failure in the same tab is a real error,
 * shown as one, never a reload loop.
 */
import { Component, Suspense, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
import { lazyPage } from "./lazyPage";

class Catch extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() { return this.state.error ? <p>error: {this.state.error}</p> : this.props.children; }
}

const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  window.sessionStorage.clear();
  reload.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  vi.restoreAllMocks();
});

async function show(Page: ReturnType<typeof lazyPage>) {
  render(<Catch><Suspense fallback={<p>outline</p>}><Page /></Suspense></Catch>);
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

it("loads a page from its chunk", async () => {
  await show(lazyPage(() => Promise.resolve({ default: () => <p>the page</p> })));
  expect(screen.getByText("the page")).toBeTruthy();
});

it("a chunk a deploy removed: reloads once, into the new app", async () => {
  await show(lazyPage(() => Promise.reject(new Error("Failed to fetch dynamically imported module"))));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.getByText("outline")).toBeTruthy(); // the outline stays until the reload takes over
});

it("failing again after that reload: the error, not another reload", async () => {
  window.sessionStorage.setItem("niete:chunk-reload", "1");
  await show(lazyPage(() => Promise.reject(new Error("gone"))));
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByText("error: gone")).toBeTruthy();
});

it("a page that loads clears the mark, so a later deploy can reload again", async () => {
  window.sessionStorage.setItem("niete:chunk-reload", "1");
  await show(lazyPage(() => Promise.resolve({ default: () => <p>fine</p> })));
  expect(window.sessionStorage.getItem("niete:chunk-reload")).toBeNull();
});
