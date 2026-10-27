import { useEffect, useState } from 'react';
import { childTestSa } from '../../services/api';
import type { SaSwitches } from '../../types/childTestSa';

/**
 * The Learning assessment page's switches for this coach, read once when the page
 * is on. Fail-CLOSED: until the answer comes, and when it cannot be read, every
 * switch is off and the page is today's.
 */

export const SWITCHES_OFF: SaSwitches = {
  handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false, rdfW3Forms: false, voiceGateV2: false, resumeRepick: false, allGrades: false, addChild: false,
};

export function useSaSwitches(enabled: boolean | null): SaSwitches {
  const [on, setOn] = useState<SaSwitches>(SWITCHES_OFF);
  useEffect(() => {
    if (enabled !== true) return undefined;
    let live = true;
    Promise.resolve().then(() => childTestSa.getSwitches())
      .then((s) => {
        if (!live || !s) return;
        setOn({
          handbackV2: s.handbackV2 === true,
          micRequired: s.micRequired === true,
          coachPicksBlock: s.coachPicksBlock === true,
          rdfForm: s.rdfForm === true,
          resultsView: s.resultsView === true,
          rdfW3Forms: s.rdfW3Forms === true,
          voiceGateV2: s.voiceGateV2 === true,
          resumeRepick: s.resumeRepick === true,
          allGrades: s.allGrades === true,
          addChild: s.addChild === true,
          // round 7b: the coach's End test as a tap + Restart test; RDF manual's End this section
          endTestRestart: s.endTestRestart === true,
          endSection: s.endSection === true,
        });
      })
      .catch(() => { /* off */ });
    return () => { live = false; };
  }, [enabled]);
  return on;
}
