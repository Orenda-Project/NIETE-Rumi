import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * bd-fmf24g.3 — the client for GET /me/grade-subjects, the pairs every teacher v2 picker opens with.
 * It passes the feature through, keeps only well-formed pairs, and never turns a failure into
 * "you have no classes".
 */

vi.mock("../services/api", () => ({ default: { get: vi.fn() } }));
import api from "../services/api";
import { loadGradeSubjects } from "./gradeSubjects";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(() => vi.clearAllMocks());

const CLASS_PAIR = { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", source: "class" };

describe("loadGradeSubjects", () => {
  it("asks for her pairs; with a feature, passes it through", async () => {
    http.get.mockResolvedValue({ data: { success: true, combos: [CLASS_PAIR] } });
    await loadGradeSubjects();
    expect(http.get).toHaveBeenLastCalledWith("/me/grade-subjects", undefined);
    await loadGradeSubjects("lessons");
    expect(http.get).toHaveBeenLastCalledWith("/me/grade-subjects", { params: { feature: "lessons" } });
  });

  it("returns the pairs as the server sent them", async () => {
    http.get.mockResolvedValue({ data: { success: true, combos: [CLASS_PAIR] } });
    expect(await loadGradeSubjects()).toEqual([CLASS_PAIR]);
  });

  it("with a feature: its key, and available only when there is a key", async () => {
    http.get.mockResolvedValue({ data: { success: true, combos: [
      { ...CLASS_PAIR, featureKey: "general_science", available: true },
      { ...CLASS_PAIR, subjectKey: "social_studies", subject: "Social Studies", featureKey: null, available: false },
      { ...CLASS_PAIR, subjectKey: "maths", featureKey: "", available: true },
    ] } });
    const out = await loadGradeSubjects("lessons");
    expect(out.map((p) => [p.subjectKey, p.featureKey, p.available])).toEqual([
      ["science", "general_science", true],
      ["social_studies", null, false],
      ["maths", null, false],
    ]);
  });

  it("early years keeps a null grade; history is history", async () => {
    http.get.mockResolvedValue({ data: { success: true, combos: [
      { grade: null, gradeCode: "early_years", subject: "English", subjectKey: "english", source: "class" },
      { ...CLASS_PAIR, source: "history" },
    ] } });
    const out = await loadGradeSubjects();
    expect(out[0].grade).toBeNull();
    expect(out[1].source).toBe("history");
  });

  it("a malformed pair is dropped, the rest kept", async () => {
    http.get.mockResolvedValue({ data: { success: true, combos: [{ grade: 4 }, null, CLASS_PAIR] } });
    expect(await loadGradeSubjects()).toEqual([CLASS_PAIR]);
  });

  it("a failed read throws — never an empty list", async () => {
    http.get.mockRejectedValue(Object.assign(new Error("502"), { response: { status: 502 } }));
    await expect(loadGradeSubjects()).rejects.toThrow();
    http.get.mockResolvedValue({ data: { success: false } });
    await expect(loadGradeSubjects()).rejects.toThrow();
  });
});
