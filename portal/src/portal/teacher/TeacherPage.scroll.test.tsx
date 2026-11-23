import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
import TeacherPage from "./TeacherPage";

/**
 * bd-2q8l2u — a new teacher page opens at its top. The app keeps one window scroll across screens, so after she
 * scrolled down Grade and subject to reach Grade 2 English, the chapter list opened part-way down and chapters 1–3
 * sat above the screen (sandbox, 19 Nov: "shows only chapters 4 onwards"). A step inside one page (Make my own's
 * steps change only the address's ?query) keeps its place.
 */
let go: (to: string) => void = () => {};
function Nav() { go = useNavigate(); return null; }
const Page = ({ name }: { name: string }) => <TeacherPage title={name} backTo="/portal/teacher/lessons"><p>{name}</p></TeacherPage>;

function app() {
  return render(
    <MemoryRouter initialEntries={["/portal/teacher/lessons/new?pick=own"]}>
      <Nav />
      <Routes>
        <Route path="/portal/teacher/lessons/new" element={<Page name="Grade and subject" />} />
        <Route path="/portal/teacher/lessons/chapters" element={<Page name="English" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TeacherPage: a new page opens at its top", () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => { scrollTo = vi.fn(); vi.stubGlobal("scrollTo", scrollTo); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("going from Grade and subject to the chapters scrolls the window back to the top", () => {
    app();
    scrollTo.mockClear();
    act(() => go("/portal/teacher/lessons/chapters?grade=2&subject=english&pick=own"));
    expect(screen.getByText("English", { selector: "p" })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("a change to the same page's address (?step=) keeps her place", () => {
    app();
    act(() => go("/portal/teacher/lessons/chapters?grade=2&subject=english&pick=own"));
    scrollTo.mockClear();
    act(() => go("/portal/teacher/lessons/chapters?grade=2&subject=english&pick=own&step=size"));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
