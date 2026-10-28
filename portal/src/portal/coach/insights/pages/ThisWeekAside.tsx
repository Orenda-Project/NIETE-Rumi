import type { ReactNode } from "react";
import { useLang } from "../../../teacher/i18n";
import api from "../../../services/api";
import MomentSlot from "../MomentSlot";
import { t } from "../text";
import { useLoad } from "../useLoad";
import type { Home, Moment, WCard as WCardData } from "../types";
import { Section } from "../../../coachip-ui/Section";

/**
 * The laptop's right column (merged_S1_1440, ux-lead-2 174713 item 3): the headline's moment in the inline player
 * (S4's read, R6; the clip itself only on a tap, preload none), then the open steps. Never mounted on a phone.
 */
export default function ThisWeekAside({ home, children }: { home: Home; children: (first: boolean) => ReactNode }) {
  const lang = useLang();
  const card = home.moves[0] as WCardData | undefined;
  const mid = card?.moment_id ?? null;
  const { data: moment } = useLoad<Moment | null>(
    () => (mid ? api.get(`/coachip/m/${encodeURIComponent(mid)}`).then((r) => r.data as Moment) : Promise.resolve(null)),
    [mid],
  );
  return (
    <div className="flex flex-col">
      {moment && (
        <Section first label={t("s2.moment.title", lang)} testId="s1-moment">
          <MomentSlot moment={moment} />
        </Section>
      )}
      {children(!moment)}
    </div>
  );
}

