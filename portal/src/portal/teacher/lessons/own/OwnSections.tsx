import { useEffect, useState } from 'react';
import { useCopy } from '../../i18n';
import { OWN } from './copy';
import { fetchSections } from './api';
import { ChangeEntry } from './ChangeEntry';
import { RateCard } from './RateCard';
import { PlanSections, type Section } from './PlanSections';
import type { ChangeAt, Part } from './change';

/**
 * her own plan on the viewer, section by section: each card has its own
 * "Change this section", and a changed card shows Before / After. While the cards load, or when they cannot (no stored
 * JSON, a network failure), the single "Change this plan" entry stays so she can still change it.
 */
export function OwnSections({ at }: { at: ChangeAt }) {
  const C = useCopy(OWN);
  const [got, setGot] = useState<{ changed: Part | null; sections: Section[] } | null>(null);
  useEffect(() => {
    let live = true;
    void fetchSections(at.own, at.band).then((r) => { if (live) setGot(r); });
    return () => { live = false; };
  }, [at.own, at.band]);
  // bd-snkn32.11 — her rating of her own plan, under it either way.
  return (
    <>
      {got ? <PlanSections C={C} at={at} sections={got.sections} changed={got.changed} /> : <ChangeEntry at={at} />}
      <RateCard ownId={at.own} />
    </>
  );
}
