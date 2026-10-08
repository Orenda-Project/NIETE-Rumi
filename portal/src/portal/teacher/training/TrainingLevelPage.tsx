import { Link, useParams } from 'react-router-dom';
import { Check, ChevronRight, Lock, Play, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CapstoneRow, hoursLeft, LevelCertificate } from '../../newui/training/TrainingLevel';
import {
  courseDone, isExamless, isLadder, lockedBehind, providerLabel, statusOf, trainingPaths, useGet,
  type Course, type GrandQuizGate, type Level, type Vendor,
} from '../../newui/training/trainingApi';
import { ListRow, StatusChip, type ChipData } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { TRAINING_V2_COPY as C } from './copy';
import { journey, type JourneyNode, TRAINING_V2_BASE } from './model';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.5 — a level (v28 canvas TrainingLevel, option A): the provider's ladder as a journey path on
 * top (done ✓ green, the level she is on bigger with its parts ring, locked grey), then the level exam, the
 * level's courses, and — kept from the new UI's level page, logic and all — Beacon House's written quiz
 * result and I-SAPS's level certificate. Every gate and lock is the server's (GET /training/levels,
 * /courses, /level/:id/grand-quiz); a locked level answers 403 and says which level to pass.
 */
const paths = trainingPaths(TRAINING_V2_BASE);

export function TrainingLevelPage() {
  const { vendorKey = '', levelId = '' } = useParams();
  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);
  const courses = useGet<Course[]>('/training/courses', { level_id: levelId }, (d) =>
    [...((d as { courses?: Course[] })?.courses || [])].sort((a, b) => a.order_index - b.order_index));

  const level = levels.data?.find((l) => String(l.id) === String(levelId)) ?? null;
  const examless = isExamless(vendorKey);
  const ladder = level ? isLadder(level) : true;
  const open = level ? level.state !== 'locked' : false;
  const gate = useGet<GrandQuizGate | null>(
    level && open && !examless ? `/training/level/${levelId}/grand-quiz` : null,
    undefined,
    (d) => (d as { grand_quiz?: GrandQuizGate })?.grand_quiz ?? null,
  );

  const provider = providerLabel(vendorKey, vendors.data);
  const title = level ? C.levelTitle(ladder ? level.order_index + 1 : null, level.name) : provider;
  const path = levels.data ? journey(levels.data, vendorKey, levelId, paths) : null;

  const locked = statusOf(courses.error) === 403;
  const behind = lockedBehind(courses.error);
  const list = courses.data || [];
  const doneCount = list.filter(courseDone).length;
  const next = list.find((c) => !courseDone(c));

  return (
    <TrainingPageV2 crumb={C.crumb(provider)} title={title} backTo={paths.home}>
      {path ? <Journey nodes={path.nodes} fill={path.fill} /> : null}

      {gate.data && level ? <ExamRow gate={gate.data} level={level} to={paths.levelExam(vendorKey, levelId)} /> : null}

      <LoadState loading={courses.loading || levels.loading} failed={!courses.loading && !!courses.error && !locked} onRetry={courses.reload} />
      {locked ? (
        <div className={cn(CARD, 'flex flex-col items-center gap-2 p-5 text-center')} data-testid="training-level-locked">
          <Lock className="h-7 w-7 text-[#6b7280]" aria-hidden="true" />
          <p className="text-[16px] font-semibold">{C.locked}</p>
          {behind != null ? <StatusChip text={C.passLevel(behind + 1)} tone="info" /> : null}
        </div>
      ) : null}

      {courses.data && list.length ? (
        <>
          <h2 className="mx-1 mt-2 flex items-center gap-2 text-[20px] font-light">
            {C.courses}
            <StatusChip text={C.of(doneCount, list.length)} tone="info" />
          </h2>
          <div className="flex flex-col gap-2.5" data-testid="training-level-courses">
            {list.map((c, i) => {
              const done = courseDone(c);
              const chip: ChipData | null = done ? { text: C.done, tone: 'done' } : null;
              return (
                <ListRow
                  key={c.id}
                  number={i + 1}
                  label={c.title}
                  subtitle={C.partsOf(Math.min(c.completed_count, c.module_count), c.module_count)}
                  chip={chip}
                  to={paths.course(vendorKey, levelId, c.id)}
                />
              );
            })}
          </div>
        </>
      ) : null}

      {level && !ladder ? <CapstoneRow levelId={level.id} /> : null}
      {level && examless && open ? <LevelCertificate levelId={level.id} onIssued={levels.reload} /> : null}

      {next && open ? (
        <Link
          to={paths.course(vendorKey, levelId, next.id)}
          data-testid="training-level-continue"
          className={cn('mt-2 flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white', FOCUS)}
        >
          <Play className="h-[18px] w-[18px] rtl:rotate-180" fill="currentColor" aria-hidden="true" />
          {C.continue}
        </Link>
      ) : null}
    </TrainingPageV2>
  );
}

/* ── the journey path ─────────────────────────────────────────────────────── */

function Journey({ nodes, fill }: { nodes: JourneyNode[]; fill: number }) {
  // Four fit the column; more scroll sideways, the level she is on kept in view.
  const many = nodes.length > 4;
  const width = many ? nodes.length * 76 : undefined;
  return (
    <nav aria-label={C.levels} data-testid="training-journey" className={cn(CARD, 'relative overflow-x-auto rounded-[18px]')}>
      <div className="relative flex px-1.5 pb-3 pt-3.5" style={width ? { width } : undefined}>
        <div aria-hidden="true" className="absolute top-[44px] h-1 rounded-full bg-[#e5e7eb]" style={{ insetInlineStart: `calc(${100 / nodes.length / 2}%)`, insetInlineEnd: `calc(${100 / nodes.length / 2}%)` }}>
          <i className="absolute inset-y-0 start-0 rounded-full bg-[#2f7a52]" style={{ width: `${Math.round(fill * 100)}%` }} />
        </div>
        {nodes.map((n) => <Node key={n.id} node={n} />)}
      </div>
    </nav>
  );
}

function Node({ node: n }: { node: JourneyNode }) {
  const label = C.level(n.n);
  const dot = (
    <span className="flex h-16 items-center justify-center">
      {n.state === 'current' ? (
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full shadow-[0_0_0_4px_#fff,0_6px_16px_rgba(51,55,74,.22)]"
          style={{ background: `conic-gradient(#2f7a52 0 ${n.pct}%, #dfe2e8 ${n.pct}% 100%)` }}
        >
          <b className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#33374a] text-[21px] font-extrabold text-white">{n.n}</b>
        </span>
      ) : n.state === 'done' ? (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f7a52] text-white shadow-[0_0_0_4px_#fff]">
          <Check className="h-[22px] w-[22px]" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : n.state === 'locked' ? (
        <span className="flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-[#e5e7eb] bg-[#f3f4f6] text-[#9ca3af] shadow-[0_0_0_4px_#fff]">
          <Lock className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
        </span>
      ) : (
        <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#33374a] bg-white text-[17px] font-extrabold text-[#33374a] shadow-[0_0_0_4px_#fff]">{n.n}</span>
      )}
    </span>
  );
  const text = (
    <span className={cn(
      'text-center text-[13px] font-semibold leading-tight',
      n.state === 'current' ? 'font-extrabold text-[#33374a]' : n.state === 'locked' ? 'text-[#9ca3af]' : 'text-[#374151]',
    )}>
      {label}
      {n.state === 'current' ? <span className="block text-[11.5px] font-semibold text-[#6b7280]">{C.of(n.partsDone, n.partsTotal)}</span> : null}
    </span>
  );
  const box = 'relative z-[1] flex min-h-[56px] min-w-0 flex-1 flex-col items-center gap-1.5 pb-0.5';
  const name = n.state === 'locked' ? `${label}, ${C.locked}` : n.state === 'done' ? `${label}, ${C.done}` : label;
  if (n.to) return <Link to={n.to} aria-label={name} className={cn(box, FOCUS, 'rounded-xl')}>{dot}{text}</Link>;
  return (
    <span aria-label={name} aria-current={n.state === 'current' ? 'step' : undefined} className={box}>{dot}{text}</span>
  );
}

/* ── the level exam ──────────────────────────────────────────────────────── */

function ExamRow({ gate, level, to }: { gate: GrandQuizGate; level: Level; to: string }) {
  if (gate.state === 'no_quiz') return null;
  const left = Math.max(1, (level.courses_total || 0) - (level.courses_completed || 0));
  const chip: ChipData =
    gate.state === 'courses_incomplete' ? { text: C.moreCourses(left), tone: 'info' }
      : gate.state === 'ready' ? { text: C.ready, tone: 'done' }
        : gate.state === 'cooldown' ? { text: C.waitHours(hoursLeft(gate.cooldown_until)), tone: 'waiting' }
          : { text: C.passed, tone: 'done' };
  const inner = (
    <>
      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">
        <Trophy className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-[16px] font-semibold">{C.levelExam}</span>
      <StatusChip text={chip.text} tone={chip.tone} />
    </>
  );
  const box = cn(CARD, 'flex min-h-[76px] items-center gap-3.5 py-2.5 pe-3.5 ps-3');
  if (gate.state === 'courses_incomplete') {
    return <div data-testid="level-exam-row" aria-disabled="true" className={cn(box, 'text-[#6b7280]')}>{inner}<Lock className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" /></div>;
  }
  return (
    <Link to={to} data-testid="level-exam-row" className={cn(box, FOCUS)}>
      {inner}
      <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}
