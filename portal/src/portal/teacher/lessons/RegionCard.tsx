import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import { CARD, FOCUS } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';

/**
 * bd-rj6w0n.14.2 — the one-time ICT-or-GB choice, on the Lesson Plans page she already opens. Never a WhatsApp
 * question: every message costs money, and most teachers are already known (the GB roster, users.region, her school).
 *
 * GET /teacher/region says whether to ask (dashboard/routes/portal-teacher-region.routes.js, dark unless
 * LP_GB_K5_ENABLED). Only when ask is true does anything show: two choices; for ICT her sector, for GB her school
 * from the GB list (or Not listed). Sectors come from the region registry (bd-97daxo.2), so what is saved is spelt
 * as the registry spells it. Save posts once and the card goes, whatever the answer; a failed read shows nothing.
 */

type School = { id: string; name: string };
type Choice = 'ict' | 'gb';
type Ask = { sectors: string[]; schools: School[] };

async function loadAsk(): Promise<Ask | null> {
  try {
    const { data } = await api.get('/teacher/region');
    if (!data || data.ask !== true) return null;
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    return {
      sectors: list(data.sectors).filter((s): s is string => typeof s === 'string'),
      schools: list(data.schools).filter((s): s is School => !!s && typeof (s as School).id === 'string' && typeof (s as School).name === 'string'),
    };
  } catch {
    return null;
  }
}

export function RegionCard() {
  const C = useCopy(LESSONS).region;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [sector, setSector] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    void loadAsk().then((a) => { if (live) setAsk(a); });
    return () => { live = false; };
  }, []);

  if (done || !ask) return null;

  const ready = choice === 'gb' || (choice === 'ict' && sector !== '');
  const save = () => {
    if (!ready) return;
    const body = choice === 'ict' ? { region: choice, sector } : schoolId ? { region: choice, schoolId } : { region: choice };
    setDone(true);
    try {
      void Promise.resolve(api.post('/teacher/region', body)).catch(() => {});
    } catch { /* a save never fails for her */ }
  };

  const option = (value: Choice, label: string) => (
    <button
      type="button"
      aria-pressed={choice === value}
      onClick={() => setChoice(value)}
      className={cn(
        'min-h-[48px] flex-1 rounded-xl border px-3 text-[16px] font-semibold',
        choice === value ? 'border-[#0f766e] bg-[#ccfbf1] text-[#134e4a]' : 'border-[#d1d5db] bg-white text-[#111827]',
        FOCUS,
      )}
    >
      {label}
    </button>
  );

  const picker = (label: string, value: string, set: (v: string) => void, none: string, items: [string, string][]) => (
    <label className="flex flex-col gap-1 text-[14px]">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={cn('min-h-[48px] rounded-xl border border-[#d1d5db] bg-white px-3 text-[16px]', FOCUS)}
      >
        <option value="">{none}</option>
        {items.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );

  return (
    <section aria-label={C.title} className={cn('mt-3 flex flex-col gap-3 p-4', CARD)}>
      <h2 className="text-[18px] font-semibold">{C.title}</h2>
      <div className="flex gap-2">
        {option('ict', C.ict)}
        {option('gb', C.gb)}
      </div>
      {choice === 'ict' && picker(C.sector, sector, setSector, C.pick, ask.sectors.map((s) => [s, s]))}
      {choice === 'gb' && picker(C.school, schoolId, setSchoolId, C.notListed, ask.schools.map((s) => [s.id, s.name]))}
      <button
        type="button"
        disabled={!ready}
        onClick={save}
        className={cn('min-h-[48px] rounded-xl bg-[#0f766e] px-4 text-[16px] font-semibold text-white disabled:opacity-40', FOCUS)}
      >
        {C.save}
      </button>
    </section>
  );
}
