import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * bd-5rz1v.13 — what the Assessment screens share: the failure words, how a file opens, and
 * the words that must never come back (bd-5rz1v.16: "Assessment Generator" and "Tests" are
 * "Assessment" now).
 */

vi.mock("../../services/api", () => ({ portal: { getAssessmentDownload: vi.fn(), getConfig: vi.fn() } }));
import { portal } from "../../services/api";
import * as copyModule from "../copy";
import { collectCopy, copyProblem } from "../checks/rules";
import { downloadArtifact, failureLabel, openFile, subjectIcon, typeLabel, FAILURE_CODES } from "./assessmentApi";
import { ASSESSMENT_COPY } from "../copy";

let clicks: Array<{ href: string; target: string; rel: string }>;

beforeEach(() => {
  vi.clearAllMocks();
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, target: this.target, rel: this.rel });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe("the server's eleven failure codes become short labels", () => {
  it("covers every code the old panel had a toast for", () => {
    expect([...FAILURE_CODES].sort()).toEqual([
      "BAD_JSON", "BOOK_NOT_FOUND", "CHAPTER_NOT_FOUND", "INVALID_PAGE_RANGE", "MODEL_UNAVAILABLE", "NO_CONTENT",
      "NO_QUESTIONS", "PAGE_OUT_OF_RANGE", "RENDER_FAILED", "TRUNCATED", "UPLOAD_FAILED",
    ]);
  });

  it.each([
    "BOOK_NOT_FOUND", "CHAPTER_NOT_FOUND", "NO_CONTENT", "PAGE_OUT_OF_RANGE", "INVALID_PAGE_RANGE", "TRUNCATED",
    "MODEL_UNAVAILABLE", "BAD_JSON", "NO_QUESTIONS", "RENDER_FAILED", "UPLOAD_FAILED",
  ])("%s is a label, not a sentence", (code) => {
    const label = failureLabel(code);
    expect(label).toBe(ASSESSMENT_COPY.failures[code as keyof typeof ASSESSMENT_COPY.failures]);
    expect(copyProblem(label)).toBeNull();
    expect(label.length).toBeGreaterThan(0);
  });

  it("an unknown code, or none, gets the fallback label", () => {
    expect(failureLabel("UNKNOWN")).toBe(ASSESSMENT_COPY.failureFallback);
    expect(failureLabel(null)).toBe(ASSESSMENT_COPY.failureFallback);
    expect(failureLabel(undefined)).toBe(ASSESSMENT_COPY.failureFallback);
  });
});

describe("opening a file (CertificatesPanel's pattern)", () => {
  it("on the web: a new tab, so the portal keeps her place", () => {
    openFile("https://r2.example/paper.pdf?X-Amz-Signature=abc");
    expect(clicks).toEqual([{ href: "https://r2.example/paper.pdf?X-Amz-Signature=abc", target: "_blank", rel: "noopener noreferrer" }]);
    expect(document.querySelectorAll("a[data-nu-download]")).toHaveLength(0);
  });

  it("in the Android app: no _blank — the WebView hands the file to Android and the portal stays put", () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    openFile("https://r2.example/paper.pdf");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].target).toBe("");
    expect(clicks[0].href).toBe("https://r2.example/paper.pdf");
  });

  it("never through window.open (a new window in the WebView is external Chrome)", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    openFile("https://r2.example/paper.pdf");
    expect(open).not.toHaveBeenCalled();
  });
});

describe("downloadArtifact", () => {
  it("asks for the paper's link and opens it", async () => {
    vi.mocked(portal.getAssessmentDownload).mockResolvedValue({ success: true, available: true, url: "https://r2.example/p.pdf" });
    await expect(downloadArtifact("p-1", "paper")).resolves.toBe("opened");
    expect(portal.getAssessmentDownload).toHaveBeenCalledWith("p-1", "paper");
    expect(clicks.map((c) => c.href)).toEqual(["https://r2.example/p.pdf"]);
  });

  it("not available: says so and opens nothing", async () => {
    vi.mocked(portal.getAssessmentDownload).mockResolvedValue({ success: true, available: false });
    await expect(downloadArtifact("p-1", "answer_key")).resolves.toBe("unavailable");
    expect(clicks).toEqual([]);
  });

  it("a failed request: 'failed', never a throw", async () => {
    vi.mocked(portal.getAssessmentDownload).mockRejectedValue(new Error("502"));
    await expect(downloadArtifact("p-1", "paper")).resolves.toBe("failed");
    expect(clicks).toEqual([]);
  });
});

describe("question types and subjects", () => {
  it("long type names are shortened for a chip; unknown ones are shown as the server sends them", () => {
    expect(typeLabel("MCQs")).toBe("MCQ");
    expect(typeLabel("Fill in the Blanks")).toBe("Fill in");
    expect(typeLabel("Short Questions")).toBe("Short");
    expect(typeLabel("Picture Description")).toBe("Picture Description");
  });

  it("every subject has an icon (a book when it is not one we know)", () => {
    for (const key of ["science", "maths", "english", "urdu", "islamiat", "general_knowledge", "social_studies", "art", null]) {
      expect(subjectIcon(key)).toBeTruthy();
    }
    expect(subjectIcon("science")).not.toBe(subjectIcon("maths"));
  });
});

describe("bd-5rz1v.16 — it is called Assessment", () => {
  it("no word of the new UI says 'Assessment Generator' or 'Tests'", () => {
    const all = collectCopy(copyModule as unknown as Record<string, unknown>);
    const bad = all.filter((e) => /Assessment Generator|\bTests?\b/i.test(e.text));
    expect(bad).toEqual([]);
    expect(ASSESSMENT_COPY.title).toBe("Assessment");
  });
});
