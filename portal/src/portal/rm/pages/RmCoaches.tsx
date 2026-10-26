import { useState } from "react";
import { useLang } from "../../teacher/i18n";
import { StateBlock } from "../../coach/insights/components/StateBlock";
import { rm } from "../api";
import { useRmLoad } from "../useRmLoad";
import { useRmSession } from "../RmGate";
import type { Coach } from "../types";
import { RmNote, RmPage } from "../components/RmFrame";
import { CoachGroups } from "../components/CoachGroups";
import FollowUpPicker from "../components/FollowUpPicker";
import { rt } from "../text";

/** bd-sex15q.17 — the Coaches tab: S8's two groups on their own page (same read, same order, same follow-up). */
export default function RmCoaches() {
  const lang = useLang();
  const { sector } = useRmSession();
  const { data, error, reload } = useRmLoad(() => rm.home(), []);
  const [coach, setCoach] = useState<Coach | null>(null);
  return (
    <RmPage title={rt("coaches.title", lang, { sector: data?.sector ?? sector })} windows={data?.windows} testId="rm-coaches" trust={data ? "s8.trust" : null}>
      {error === "not_found" ? <RmNote testId="rm-no-sector">{rt("s8.empty.no_sector", lang)}</RmNote>
        : !data ? <StateBlock error={error} testId="rm-state" />
        : <div className="mx-auto max-w-3xl"><CoachGroups home={data} onFollowUp={setCoach} /></div>}
      {coach && data && <FollowUpPicker coach={coach} home={data} onClose={() => { setCoach(null); reload(); }} onSent={() => undefined} />}
    </RmPage>
  );
}
