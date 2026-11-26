import { describe, it, expect, vi } from "vitest";
import { render, screen, within, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-r2uzg1.23.11 (queue #274, call 13A; ICT sheet Middle and High TT 63, 74): an I-SAPS course whose parts are all
 * done but whose end-of-module exam is still to pass reads "Exam to do", not Done, and the level's Continue goes to
 * that exam. GET /training/courses now says it per course (exam_state 'pending' | 'passed' | null).
 */

configure({ asyncUtilTimeout: 5000 });

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  portal: { getConfig: vi.fn() },
}));

import api from "../../services/api";
import { TrainingLevelPage } from "./TrainingLevelPage";
import { TRAINING_V2_BASE } from "./model";
import { TRAINING_V2_COPY, TRAINING_V2_COPY_UR } from "./copy";
import { courseDone, examLeft, type Course } from "../../newui/training/trainingApi";

const course = (id: string, n: number, done: number, total: number, exam_state: Course["exam_state"]): Course =>
  ({ id, title: `Module ${n}: Course ${n}`, order_index: n - 1, module_count: total, completed_count: done, exam_state } as Course);

function renderLevel(courses: Course[]) {
  vi.mocked(api.get).mockImplementation(trainingGet({ "/training/courses": { courses } }) as never);
  return render(
    <MemoryRouter initialEntries={[`${TRAINING_V2_BASE}/provider/ISAPS/level/9`]}>
      <Routes><Route path={`${TRAINING_V2_BASE}/provider/:vendorKey/level/:levelId`} element={<TrainingLevelPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("courseDone / examLeft", () => {
  it("every part done and the exam left: not done, exam left", () => {
    const c = course("c-1", 1, 6, 6, "pending");
    expect(courseDone(c)).toBe(false);
    expect(examLeft(c)).toBe(true);
  });
  it("exam passed, or a vendor with no course exam: done as before", () => {
    expect(courseDone(course("c-2", 2, 6, 6, "passed"))).toBe(true);
    expect(courseDone(course("c-3", 3, 6, 6, null))).toBe(true);
    expect(examLeft(course("c-3", 3, 6, 6, null))).toBe(false);
  });
  it("parts still to do: neither done nor 'exam left'", () => {
    const c = course("c-4", 4, 2, 6, "pending");
    expect(courseDone(c)).toBe(false);
    expect(examLeft(c)).toBe(false);
  });
});

describe("I-SAPS level page: a course with its exam left", () => {
  it("reads 'Exam to do', not Done; the count leaves it out", async () => {
    renderLevel([course("c-1", 1, 6, 6, "pending"), course("c-2", 2, 6, 6, "passed"), course("c-3", 3, 2, 6, "pending")]);
    const list = await screen.findByTestId("training-level-courses");
    const rows = within(list).getAllByRole("link");
    expect(within(rows[0]).getByText("Exam to do")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("Done")).not.toBeInTheDocument();
    expect(within(rows[1]).getByText("Done")).toBeInTheDocument();
    expect(within(rows[2]).queryByText("Exam to do")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("Continue goes to that course's exam, and says so", async () => {
    renderLevel([course("c-1", 1, 6, 6, "pending"), course("c-2", 2, 6, 6, "passed")]);
    const go = await screen.findByTestId("training-level-continue");
    expect(go).toHaveAttribute("href", `${TRAINING_V2_BASE}/exam/c-1`);
    expect(go).toHaveTextContent("Continue to the exam");
  });

  it("the next course still has parts: Continue as before, to the course", async () => {
    renderLevel([course("c-1", 1, 6, 6, "passed"), course("c-2", 2, 2, 6, "pending")]);
    const go = await screen.findByTestId("training-level-continue");
    expect(go).toHaveAttribute("href", `${TRAINING_V2_BASE}/provider/ISAPS/level/9/course/c-2`);
    expect(go).toHaveTextContent(/^Continue$/);
  });

  it("the words, in English and Urdu", () => {
    expect(TRAINING_V2_COPY.examLeft).toBe("Exam to do");
    expect(TRAINING_V2_COPY_UR.examLeft).toBe("امتحان باقی");
    expect(TRAINING_V2_COPY.continueExam).toBe("Continue to the exam");
    expect(TRAINING_V2_COPY_UR.continueExam).toBe("امتحان جاری رکھیں");
  });
});
