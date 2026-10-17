import { useGet, type Load, type ReadingList } from "../../newui/training/trainingApi";

/**
 * bd-s42dye.2 — the coach Training Library's reads. ONLY the four library endpoints (bd-s42dye.1); nothing here
 * can write, and none of the attempt, progress, bands, certificate or catalogue endpoints is ever named.
 */
/** Ids are opaque: the server sends numbers (bigint); a string is accepted too. Always String(id) in routes and keys. */
export type Id = number | string;

export type LibraryModule = {
  id: Id; title: string; order_index: number; duration_seconds: number;
  has_video: boolean; has_audio: boolean; has_pdf: boolean; has_questions: boolean;
};
export type LibraryCourse = {
  id: Id; title: string; course_type?: string; order_index: number;
  has_readings: boolean; has_module_exam: boolean; modules: LibraryModule[];
};
export type LibraryLevel = {
  id: Id; name: string; order_index: number; has_level_exam: boolean;
  exam_kind: "grand_quiz" | "capstone" | null; courses: LibraryCourse[];
};
export type LibraryVendor = { vendor_key: string; vendor_name: string; levels: LibraryLevel[] };
export type Library = { vendors: LibraryVendor[] };

export type LibraryModuleDetail = {
  id: Id; title: string; course_id: Id; level_id: Id; vendor_key: string;
  body_html: string | null; video_url: string | null; audio_url: string | null; pdf_url: string | null;
  duration_seconds: number; has_questions: boolean;
};

export type PreviewQuestion = {
  id: Id; type: "mcq" | "msq" | "crq" | "open"; text: string; options: string[];
  image_url: string | null; option_image_urls?: (string | null)[];
};
export type Preview = { scope: "module" | "level" | "module_exam"; title: string; questions: PreviewQuestion[] };

export const useLibrary = (): Load<Library> =>
  useGet<Library>("/training/library", undefined, (d) => ({ vendors: (d as Library)?.vendors || [] }));

export const useLibraryModule = (id: string): Load<LibraryModuleDetail> =>
  useGet<LibraryModuleDetail>(`/training/library/module/${encodeURIComponent(id)}`);

export const useCourseReadings = (courseId: Id | null): Load<ReadingList> =>
  useGet<ReadingList>(courseId ? `/training/library/course/${encodeURIComponent(String(courseId))}/readings` : null, undefined, (d) => ({
    available: (d as ReadingList)?.available || [],
    unavailable: (d as ReadingList)?.unavailable || [],
  }));

export const usePreview = (params: Record<string, string> | null): Load<Preview> =>
  useGet<Preview>(params ? "/training/library/questions" : null, params ?? undefined, (d) => ({
    ...(d as Preview), questions: (d as Preview)?.questions || [],
  }));
