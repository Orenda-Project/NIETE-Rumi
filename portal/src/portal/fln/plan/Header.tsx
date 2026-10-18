/**
 * bd-t7zk3t.11 — the navy plan header (DESIGN v2 §2 S4.1). Kicker on TWO lines: the subject, then the level and the
 * lesson's place in it from the placement row of the grade it was opened from (`pos` / `count` — NEVER the plan's `seq`; a guide, pos 0, shows the level
 * only). The title in the plan's own language; the chip row as the list shows it; `⏱ <total>` from the plan.
 */
import { flnStrings, type FlnLang } from '../strings';
import type { FlnPlan, FlnPlacement } from '../types';
import { Chrome } from './text';

export interface HeaderProps { plan: FlnPlan; placement: FlnPlacement | undefined; uiLang: FlnLang }

function hasVideo(plan: FlnPlan): boolean {
  if (plan.videos?.length) return true;
  return plan.sections.some((s) => s.groups.some((g) => g.items.some((it) => (it.media || []).some((m) => m.kind === 'video'))));
}

export function headerChips(plan: FlnPlan, placement: FlnPlacement | undefined, uiLang: FlnLang): string[] {
  const s = flnStrings(uiLang);
  const out: string[] = [];
  const label = placement?.label;
  if (label === 'screener') out.push(s.chip.answerKey);
  else if (plan.audio_summary?.sounds) out.push(`🔊 ${s.chip.sounds(plan.audio_summary.sounds)}`);
  if (label !== 'screener' && plan.audio_summary?.narration) out.push(`▶ ${s.chip.narration}`);
  if (hasVideo(plan)) out.push(s.chip.video);
  if (label === 'needs_textbook') out.push(s.chip.textbook);
  if (label === 'additional_practice') out.push(s.chip.additional);
  if (placement?.strand === 'extended') out.push(s.chip.extended);
  return out;
}

export function Header({ plan, placement, uiLang }: HeaderProps) {
  const s = flnStrings(uiLang);
  const rtl = uiLang === 'ur';
  const level = placement?.level;
  const line2 = !placement || level == null
    ? null
    : placement.pos > 0 && placement.label !== 'guide'
      ? s.kickerLevelLesson(level, placement.pos, placement.count)
      : s.kickerLevel(level);
  const chips = headerChips(plan, placement, uiLang);
  return (
    <header className="fln-plan-header">
      <div className="fln-kicker"><Chrome text={s.subjectKicker[plan.subject]} rtl={rtl} /></div>
      {line2 ? <div className="fln-kicker"><Chrome text={line2} rtl={rtl} /></div> : null}
      <h1 lang={plan.lang} dir={plan.dir}><Chrome text={plan.title} rtl={plan.dir === 'rtl'} /></h1>
      <div className="fln-hchips">
        {chips.map((c) => <span key={c} className={`fln-hc${c === s.chip.answerKey ? ' fln-hc--key' : ''}`}><Chrome text={c} rtl={rtl} /></span>)}
        <span className="fln-hc fln-hc--time">⏱ <Chrome text={s.totalTime(plan.minutes.total)} rtl={rtl} /></span>
      </div>
    </header>
  );
}
