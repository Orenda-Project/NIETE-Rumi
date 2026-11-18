import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const reportSendFailure = vi.hoisted(() => vi.fn());
vi.mock("../../lib/dcUploadReport", async (orig) => ({ ...(await orig<typeof import("../../lib/dcUploadReport")>()), reportSendFailure }));

import { DC_MAX_PHOTOS } from "../../lib/coachingUpload";
import { isHeld } from "../../lib/pickedRead";
import { COACHING_V2_COPY as C, COACHING_V2_COPY_UR as UR } from "./copy";
import { PhotoGrid } from "./parts";

/**
 * bd-r2uzg1.9 — ICT IAB row 29 (queue #116): on Digital Coaching in the Android app a photo the phone had picked
 * would not open at Submit (331 times, 25 teachers, 29 Oct–13 Nov; every one an ordinary JPEG). The teacher's grid
 * now reads each photo the moment she picks it and keeps those bytes; a photo that will not open, or a file that is
 * not a JPEG or PNG inside (an mp4 or a PDF named .jpg), is refused right there, with its reason in the logs.
 */
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const MP4 = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32];
const photo = (name: string, bytes = JPEG) => new File([new Uint8Array([...bytes, 7, 7])], name, { type: "image/jpeg" });
function neverOpens(name: string) {
  const f = photo(name);
  Object.defineProperty(f, "arrayBuffer", { value: () => Promise.reject(Object.assign(new Error("x"), { name: "NotReadableError" })) });
  return f;
}

let last: File[] = [];
function Harness() {
  const [photos, setPhotos] = useState<File[]>([]);
  last = photos;
  return <PhotoGrid photos={photos} onChange={setPhotos} testId="dc-photos-input" max={DC_MAX_PHOTOS} camera readOnPick />;
}

beforeEach(() => { reportSendFailure.mockClear(); last = []; });

describe("each photo is read when she picks it (bd-r2uzg1.9)", () => {
  it("a JPEG from the gallery or the camera joins the grid as a copy the page holds", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [photo("a.jpg"), photo("b.jpg")] } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(2));
    fireEvent.change(screen.getByTestId("dc-photos-input-camera"), { target: { files: [photo("c.jpg")] } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(3));
    expect(last.map((f) => f.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(last.every(isHeld)).toBe(true);
    expect(reportSendFailure).not.toHaveBeenCalled();
  });

  it("an mp4 named .jpg is not taken: Not a photo, the good photo picked with it still joins, the logs say video", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [photo("a.jpg"), photo("clip.jpg", MP4)] } });
    expect((await screen.findByRole("alert")).textContent).toBe(C.notAPhoto);
    await waitFor(() => expect(last.map((f) => f.name)).toEqual(["a.jpg"]));
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "pick", kind: "photo", reason: "not_image", magic: "video", item: 2, items: 2 }));
  });

  it("a photo that will not open is refused at the pick, not at Submit, with the browser's error name logged", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [neverOpens("board.jpg")] } });
    expect((await screen.findByRole("alert", undefined, { timeout: 4000 })).textContent).toBe(C.photoWontOpen);
    expect(screen.queryAllByRole("button", { name: /Remove photo/ })).toHaveLength(0);
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "pick", kind: "photo", reason: "unreadable", errName: "NotReadableError", sentBytes: 0, sentAs: "none" }));
  });

  it("the new words have their Urdu, and none says 'app'", () => {
    for (const k of ["photoWontOpen", "changePhoto", "sendWithoutPhoto"] as const) {
      expect(typeof UR[k]).toBe("string");
      expect(UR[k]).not.toBe(C[k]);
      expect(`${C[k]} ${UR[k]}`).not.toMatch(/\bapp\b|ایپ/i);
    }
  });
});
