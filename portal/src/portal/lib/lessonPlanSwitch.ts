import { useContext, useEffect, useState } from "react";
import { peekConfig, readConfigShared } from "./useNewUi";
import { AuthContext } from "../hooks/authContext";

/**
 * bd-kijmb8 (queue #318) — portal_lesson_plan_open: the "Lesson plan" button on recordings and observations, and the
 * sheet that opens the plan over the page. Fail-closed: only a literal `true` in `features.lessonPlanOpen` turns it on;
 * unread or failed config is off, and every screen is then exactly as it was.
 */
export function lessonPlanOpenOn(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  return !!features && typeof features === "object" && (features as { lessonPlanOpen?: unknown }).lessonPlanOpen === true;
}

/** The signed-in user's answer, from /config's shared read (no extra request); false until it says true. */
export function useLessonPlanOpen(): boolean {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  const [on, setOn] = useState<boolean>(() => lessonPlanOpenOn(peekConfig()));
  useEffect(() => {
    let live = true;
    readConfigShared().then(lessonPlanOpenOn).catch(() => false).then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, [userKey]);
  return on;
}
