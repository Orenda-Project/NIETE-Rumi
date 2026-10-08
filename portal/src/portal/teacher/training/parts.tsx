import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Download, Lock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TRAINING_COPY as T } from '../../newui/copy';
import { shortDate } from '../../newui/range';
import { certificateUrl, downloadCertificate } from '../../newui/training/certificateFile';
import { StatusChip, type ChipData } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import type { AnswerState } from './inner';

/**
 * bd-fmf24g.12 — the v2 pieces the Training inner screens share (v28 canvas Training row): a row with any
 * icon lead, a status card ("Ready", "Passed"…), the bottom buttons, the question dots, big answer choices,
 * a written-answer box, the certificate card and an answer read back. Words come from the callers (the new
 * UI's TRAINING_COPY, so a restyled screen says exactly what it said before).
 */

type Icon = LucideIcon;

/* ── a row ────────────────────────────────────────────────────────────────── */

export function V2Row({
  icon: I, title, sub, chip, end = 'chevron', to, onPress, off, testId, ariaLabel,
}: {
  icon: Icon;
  title: ReactNode;
  sub?: ReactNode;
  chip?: ChipData | null;
  end?: 'chevron' | 'download' | 'external' | 'none';
  to?: string;
  onPress?: () => void;
  off?: boolean;
  testId?: string;
  ariaLabel?: string;
}) {
  const inner = (
    <>
      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">
        <I className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span dir="auto" className="line-clamp-2 text-[16px] font-semibold leading-snug">{title}</span>
        {sub ? <span className="text-[13px] text-[#6b7280]">{sub}</span> : null}
      </span>
      {chip?.text ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
      {off ? <Lock className="h-5 w-5 shrink-0 text-[#6b7280]" strokeWidth={2.2} aria-hidden="true" />
        : end === 'download' ? <Download className="h-[22px] w-[22px] shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" />
          : end === 'chevron' ? <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
            : end === 'external' ? <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" /> : null}
    </>
  );
  const box = cn(CARD, 'flex min-h-[76px] w-full items-center gap-3.5 py-2.5 pe-3.5 ps-3 text-start text-[#1d2025]', off && 'opacity-[.55]');
  if (off) return <div aria-disabled="true" data-testid={testId} className={box}>{inner}</div>;
  if (to) return <Link to={to} data-testid={testId} aria-label={ariaLabel} className={cn(box, FOCUS)}>{inner}</Link>;
  if (onPress) return <button type="button" onClick={onPress} data-testid={testId} aria-label={ariaLabel} className={cn(box, FOCUS)}>{inner}</button>;
  return <div data-testid={testId} className={box}>{inner}</div>;
}

/* ── a status card ────────────────────────────────────────────────────────── */

const HERO_TONE = {
  neutral: 'bg-[#eeeafd] text-[#6e52e0]',
  done: 'bg-[#eaf6ef] text-[#2f7a52]',
  waiting: 'bg-[#fef3c7] text-[#b45309]',
  quiet: 'bg-[#f3f4f6] text-[#6b7280]',
} as const;

export function HeroCard({
  icon: I, tone = 'neutral', title, ring, children, live, testId,
}: {
  icon?: Icon;
  tone?: keyof typeof HERO_TONE;
  title: ReactNode;
  /** A score ring instead of the icon: the share done and its words ("4/5"). */
  ring?: { value: number; text: string };
  children?: ReactNode;
  live?: boolean;
  testId?: string;
}) {
  const pct = ring ? Math.max(0, Math.min(100, Math.round(ring.value * 100))) : 0;
  return (
    <section
      data-testid={testId}
      role={live ? 'status' : undefined}
      className={cn(CARD, 'flex flex-col items-center gap-3 rounded-[18px] px-4 pb-5 pt-6 text-center')}
    >
      {ring ? (
        <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full" style={{ background: `conic-gradient(#2f7a52 0 ${pct}%, #e5e7eb ${pct}% 100%)` }}>
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white text-[28px] font-extrabold tabular-nums">{ring.text}</span>
        </span>
      ) : I ? (
        <span className={cn('flex h-[76px] w-[76px] items-center justify-center rounded-full', HERO_TONE[tone])}>
          <I className="h-[38px] w-[38px]" strokeWidth={2} aria-hidden="true" />
        </span>
      ) : null}
      <span className="text-[22px] font-bold">{title}</span>
      {children ? <span className="flex flex-wrap justify-center gap-1.5">{children}</span> : null}
    </section>
  );
}

/* ── the bottom buttons ───────────────────────────────────────────────────── */

export function DockButton({
  children, icon: I, to, onClick, disabled, outline, testId, iconFlips,
}: {
  children: ReactNode;
  icon?: Icon;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  outline?: boolean;
  testId?: string;
  iconFlips?: boolean;
}) {
  const cls = cn(
    'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold',
    disabled ? 'bg-[#e5e7eb] text-[#9ca3af]' : outline ? 'border border-[#e5e7eb] bg-white text-[#1d2025]' : 'bg-[#33374a] text-white',
    FOCUS,
  );
  const icon = I ? <I className={cn('h-5 w-5', iconFlips && 'rtl:rotate-180')} strokeWidth={2.4} aria-hidden="true" /> : null;
  if (to && !disabled) return <Link to={to} data-testid={testId} className={cls}>{icon}{children}</Link>;
  return <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} className={cls}>{icon}{children}</button>;
}

export function DockRow({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-2.5">{children}</div>;
}

/* ── the question dots ────────────────────────────────────────────────────── */

export function Dots({ total, current, label }: { total: number; current: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={current + 1} aria-valuemin={1} aria-valuemax={total} className="flex gap-1.5 px-1">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={cn('h-1.5 flex-1 rounded-full', i <= current ? 'bg-[#33374a]' : 'bg-[#e5e7eb]')} />
      ))}
    </div>
  );
}

/* ── big answer choices ───────────────────────────────────────────────────── */

const LETTER = 'ABCDEFGH';
const CHOICE = {
  idle: 'border-[#e5e7eb] bg-white',
  picked: 'border-[#33374a] bg-[#f4f5f8]',
  correct: 'border-[#2f7a52] bg-[#eaf6ef]',
  wrong: 'border-[#c8331f] bg-[#fee4e2]',
} as const;
const KEY = {
  idle: 'bg-[#f3f4f6] text-[#33374a]',
  picked: 'bg-[#33374a] text-white',
  correct: 'bg-[#2f7a52] text-white',
  wrong: 'bg-[#c8331f] text-white',
} as const;

/**
 * One question's answers as big rows (A, B, C…). `multi` lets her pick several (a pick-all question); a
 * single question keeps one. `states` says how each is drawn (answerStates()).
 */
export function Choices({
  label, options, images, states, value, onChange, multi, disabled,
}: {
  label: string;
  options: string[];
  images?: Array<string | null> | null;
  states: AnswerState[];
  value: number[];
  onChange: (v: number[]) => void;
  multi?: boolean;
  disabled?: boolean;
}) {
  const pick = (i: number) => {
    if (disabled) return;
    if (!multi) { onChange([i]); return; }
    onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort((a, b) => a - b));
  };
  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-col gap-2.5">
      {options.map((text, i) => {
        const s = states[i] ?? 'idle';
        const img = images?.[i] || null;
        return (
          <button
            key={i}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={value.includes(i)}
            disabled={disabled}
            onClick={() => pick(i)}
            data-testid={`choice-${i}`}
            className={cn('flex min-h-16 w-full items-center gap-3.5 rounded-2xl border-2 py-2.5 pe-3.5 ps-2.5 text-start text-[16px] font-semibold leading-snug', CHOICE[s], FOCUS)}
          >
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-extrabold', KEY[s])}>
              {s === 'correct' ? <Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" /> : s === 'wrong' ? <X className="h-5 w-5" strokeWidth={3} aria-hidden="true" /> : LETTER[i]}
            </span>
            {img ? <img src={img} alt="" className="max-h-24 rounded-[8px] object-contain" /> : null}
            <span dir="auto" className="min-w-0 flex-1">{text}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── a written answer ─────────────────────────────────────────────────────── */

/** The box, and the server's character floor as a chip (amber until reached) — the new UI's WrittenField, restyled. */
export function WrittenBox({ value, floor, onChange, disabled, label }: { value: string; floor: number; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  const n = value.trim().length;
  return (
    <div className="flex flex-col gap-2">
      <textarea
        dir="auto"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={9}
        className={cn('min-h-[220px] w-full resize-none rounded-2xl border-2 border-[#33374a] bg-white p-3.5 text-[16px] leading-relaxed text-[#1d2025]', FOCUS)}
      />
      {floor > 0 ? (
        <span className="flex">
          <StatusChip text={T.of(n, floor)} tone={n >= floor ? 'done' : 'waiting'} tick={n >= floor} />
        </span>
      ) : null}
    </div>
  );
}

/** One question and her answer, read back (data): question, answer, a score chip, the feedback. */
export function AnswerBack({ question, answer, score, feedback }: { question: string; answer: string; score?: string | null; feedback?: string | null }) {
  return (
    <li className={cn(CARD, 'flex flex-col gap-1.5 p-3.5')}>
      <p dir="auto" className="whitespace-pre-line text-[15px] font-bold">{question}</p>
      <p dir="auto" className="whitespace-pre-wrap text-[15px]">{answer}</p>
      {score ? <span className="flex"><StatusChip text={score} tone="info" /></span> : null}
      {feedback ? <p dir="auto" className="text-[14px] text-[#6b7280]">{feedback}</p> : null}
    </li>
  );
}

/* ── the certificate a pass issued ────────────────────────────────────────── */

export function CertificateCardV2({ certificate }: { certificate: { certificate_code: string; level_name: string; issued_at?: string | null } }) {
  const day = certificate.issued_at ? shortDate(certificate.issued_at.slice(0, 10)) : null;
  return (
    <button
      type="button"
      data-testid="training-certificate-card"
      aria-label={T.download}
      onClick={() => downloadCertificate(certificateUrl(certificate.certificate_code))}
      className={cn(CARD, 'flex min-h-[84px] w-full items-center gap-3.5 px-3.5 py-3 text-start', FOCUS)}
    >
      <span aria-hidden="true" className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[#fdf3d7] text-[#d4a017]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="9" r="6.5" fill="#fff" /><path d="M8.6 14.6 7 22.5l5-3 5 3-1.6-7.9" /></svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span dir="auto" className="text-[16px] font-semibold">{certificate.level_name}</span>
        <span className="text-[13px] tabular-nums text-[#6b7280]">{[certificate.certificate_code, day].filter(Boolean).join(' · ')}</span>
      </span>
      <Download className="h-[22px] w-[22px] shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

