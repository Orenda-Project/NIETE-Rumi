import { useEffect, useState } from 'react';
import { BookOpen, Mic } from 'lucide-react';
import type { LessonPlanUsed } from '../home/progressApi';
import type { LibraryPick } from '../../lib/coachingSend';
import { useCopy } from '../../teacher/i18n';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { BottomActions, BottomButton } from '../BottomButton';
import { getRecentPlans, pickOf, planChips } from './coachingApi';
import { PICKER_WORDS_EN } from './pickerWords';
import { LIVE_COPY } from './liveCopy';

/**
 * bd-v0toag.31 — before Record, a group D teacher picks the lesson she is about to teach from the plans she
 * opened last (one tap picks it and starts recording), or skips and records as today.
 */
export function PickStage({ onStart }: { onStart: (p?: { pick: LibraryPick; title: string; chips: string[] }) => void }) {
  const W = PICKER_WORDS_EN;
  const L = useCopy(LIVE_COPY);
  const [recent, setRecent] = useState<LessonPlanUsed[]>([]);

  useEffect(() => {
    let live = true;
    getRecentPlans(3).then((plans) => { if (live) setRecent(plans); }).catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <div data-testid="record-pick" className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-nu-surface-text">{L.pickTitle}</h2>
      {recent.length ? (
        <List label={L.pickTitle}>
          {recent.map((p) => (
            <Row
              key={p.planKey}
              title={p.title || W.planFallback}
              icon={BookOpen}
              chips={planChips(p, W).map((c) => <Chip key={c}>{c}</Chip>)}
              onClick={() => onStart({ pick: pickOf(p), title: p.title || W.planFallback, chips: planChips(p, W) })}
            />
          ))}
        </List>
      ) : null}
      <BottomActions>
        <BottomButton tone="outline" icon={Mic} onClick={() => onStart()}>{L.skip}</BottomButton>
      </BottomActions>
    </div>
  );
}
