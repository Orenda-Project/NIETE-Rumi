import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { tapProblems } from "../../newui/checks/rules";
import { DC_MAX_PHOTOS } from "../../lib/coachingUpload";
import { COACHING, COACHING_V2_COPY as C } from "./copy";
import { PhotoGrid } from "./parts";

/**
 * bd-rt8wky — a teacher's Digital Coach photos on the portal: Take photo (the phone camera) next to From gallery,
 * one tap each, mixed freely up to 10; a count under the grid. The coach's grid (3, no camera prop) is unchanged.
 */
const jpg = (n: string) => new File(["x"], `${n}.jpg`, { type: "image/jpeg" });

function Harness({ start = 0, camera = true }: { start?: number; camera?: boolean }) {
  const [photos, setPhotos] = useState<File[]>(() => Array.from({ length: start }, (_, i) => jpg(`p${i}`)));
  return <PhotoGrid photos={photos} onChange={setPhotos} testId="dc-photos-input" max={DC_MAX_PHOTOS} camera={camera} />;
}

describe("Take photo and From gallery (bd-rt8wky)", () => {
  it("two tiles, one tap each: Take photo opens the camera, From gallery picks several", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: C.takePhoto })).toBeTruthy();
    expect(screen.getByRole("button", { name: C.fromGallery })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.addPhoto })).toBeNull();
    const cam = screen.getByTestId("dc-photos-input-camera") as HTMLInputElement;
    expect(cam.getAttribute("capture")).toBe("environment");
    expect(cam.multiple).toBe(false);
    const gallery = screen.getByTestId("dc-photos-input") as HTMLInputElement;
    expect(gallery.multiple).toBe(true);
    expect(gallery.getAttribute("capture")).toBeNull();
  });

  it("each photo taken joins the grid, the tiles stay for the next, and the count follows", () => {
    render(<Harness />);
    const cam = screen.getByTestId("dc-photos-input-camera");
    fireEvent.change(cam, { target: { files: [jpg("a")] } });
    fireEvent.change(cam, { target: { files: [jpg("b")] } });
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [jpg("c"), jpg("d")] } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(4);
    expect(screen.getByText(C.photoCount(4, DC_MAX_PHOTOS))).toBeTruthy();
    expect(screen.getByRole("button", { name: C.takePhoto })).toBeTruthy();
  });

  it("at 10 the tiles go away; removing one brings them back", () => {
    render(<Harness start={10} />);
    expect(screen.queryByRole("button", { name: C.takePhoto })).toBeNull();
    expect(screen.queryByRole("button", { name: C.fromGallery })).toBeNull();
    expect(screen.getByText(C.photoCount(10, DC_MAX_PHOTOS))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: C.removePhoto(1) }));
    expect(screen.getByRole("button", { name: C.takePhoto })).toBeTruthy();
  });

  it("a gallery pick past 10 is refused with the existing line", () => {
    render(<Harness start={9} />);
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [jpg("x"), jpg("y")] } });
    expect(screen.getByText(C.upToPhotos(DC_MAX_PHOTOS))).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(9);
  });

  it("no count before the first photo", () => {
    render(<Harness />);
    expect(screen.queryByText(C.photoCount(0, DC_MAX_PHOTOS))).toBeNull();
  });

  it("both tiles are 56px tap targets", () => {
    const { container } = render(<Harness start={1} />);
    expect(tapProblems(container)).toEqual([]);
  });

  it("the coach's grid (no camera) keeps its one Add photo tile and no count", () => {
    render(<PhotoGrid photos={[jpg("a")]} onChange={() => {}} testId="photos-input" />);
    expect(screen.getByRole("button", { name: C.addPhoto })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.takePhoto })).toBeNull();
    expect(screen.queryByTestId("photos-input-camera")).toBeNull();
  });

  it("Urdu: the new words exist and differ from the English", () => {
    const b = COACHING as unknown as { en: Record<string, unknown>; ur: Record<string, unknown> };
    expect(b.ur.takePhoto).toBe("تصویر لیں");
    expect(b.ur.fromGallery).toBe("گیلری سے");
    expect((b.ur.photoCount as (n: number, m: number) => string)(4, 10)).toBe("10 میں سے 4 تصاویر");
    expect(b.en.fromGallery).not.toBe(b.ur.fromGallery);
  });
});
