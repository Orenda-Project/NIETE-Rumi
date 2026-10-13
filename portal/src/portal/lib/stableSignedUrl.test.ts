import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * bd-ymavij — "the reflection question's voice note sometimes won't play again, even on tapping play" (sandbox).
 * While the page waits for her answer it re-asks the progress endpoint every 5–15 s, and every answer carries the
 * question's audio link signed AGAIN (a new X-Amz-Date, so a new string). <audio src> reloads on every change, so a
 * tap that lands just before a refresh — or a play in progress — is thrown away. The link must stay the same while
 * it points at the same file, and still be renewed before it expires (an hour — row 14's ExpiredRequest).
 */

import { useStableSignedUrl } from "./stableSignedUrl";

const signed = (path: string, stamp: string) => `https://r2.example/bucket/${path}?X-Amz-Date=${stamp}&X-Amz-Signature=abc${stamp}`;

describe("useStableSignedUrl", () => {
  it("keeps the first link while a re-signed link points at the same file", () => {
    let now = 0;
    const { result, rerender } = renderHook(({ url }) => useStableSignedUrl(url, { now: () => now }), {
      initialProps: { url: signed("q1.ogg", "100000") },
    });
    const first = result.current;
    now = 5_000; rerender({ url: signed("q1.ogg", "100005") });
    now = 20_000; rerender({ url: signed("q1.ogg", "100020") });
    expect(result.current).toBe(first);
  });

  it("takes the new link when the file changes (another question)", () => {
    const { result, rerender } = renderHook(({ url }) => useStableSignedUrl(url, { now: () => 0 }), {
      initialProps: { url: signed("q1.ogg", "1") },
    });
    rerender({ url: signed("q2.ogg", "2") });
    expect(result.current).toBe(signed("q2.ogg", "2"));
  });

  it("renews the link before it can expire (older than 45 min)", () => {
    let now = 0;
    const { result, rerender } = renderHook(({ url }) => useStableSignedUrl(url, { now: () => now }), {
      initialProps: { url: signed("q1.ogg", "1") },
    });
    now = 46 * 60_000; rerender({ url: signed("q1.ogg", "2") });
    expect(result.current).toBe(signed("q1.ogg", "2"));
  });

  it("no link → none", () => {
    const { result } = renderHook(() => useStableSignedUrl(undefined));
    expect(result.current).toBeUndefined();
  });
});
