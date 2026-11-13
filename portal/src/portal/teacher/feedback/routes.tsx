import type { TeacherRoute } from "../routes";
import { lazyPage as page } from "@/lib/lazyPage";
import { TEACHER_FEEDBACK_PATH } from "./paths";

/** bd-370733 — More → Send feedback, the coach's form for teachers too (operator, 12 Nov: "Should be for teacher as well"). */
const TeacherFeedback = page(() => import("./TeacherFeedback"));

const routes: TeacherRoute[] = [{ path: TEACHER_FEEDBACK_PATH, element: <TeacherFeedback /> }];
export default routes;
