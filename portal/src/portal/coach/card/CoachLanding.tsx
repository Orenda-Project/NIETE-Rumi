import { FrameSkeleton } from "../../components/Skeleton";
import { readShellHint } from "../../lib/shellHint";
import CoachHome from "../pages/CoachHome";
import { useCardSwitch } from "./frame";
import SlimHome from "./SlimHome";

/**
 * /portal/coach. With the School card switch on it is the slim Coach Home (Training Library and My schools); off, it is
 * the coach Home it always was (which the coach app's guard keeps shut for a v2 coach). While the switch is read: the
 * frame's outline.
 */
export default function CoachLanding() {
  const on = useCardSwitch();
  if (on === true) return <SlimHome />;
  if (on === null) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  return <CoachHome />;
}
