/**
 * bd-fmf24g.24 — the Urdu-fit harness: the teacher kit's components with REAL Urdu copy, on one page, in the page
 * language given by `?lang=ur|en` and the screen given by `?case=main|tray|nav`. scripts/urdu-fit/run.mjs loads it
 * in headless Chromium and measures every clipping box that holds Urdu. Local only: nothing here ships.
 */
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@/index.css';
import i18n from '@/i18n/config';
import {
  AttentionBanner, ButtonWithReason, NumberField, AudioCard, DateRangeBar, HomeGreeting, RatingScale, ScoreRing, SubjectTile, TimePicker, ChoiceChips, ChosenSoFar, ClassPicker, DayStrip, FeatureTile, GradeSubjectButton, HistoryList, HistoryRow,
  FeatureCard, MeterRow, KpiTiles, LeaveNote, ListRow, ProgressSteps, ReadyBanner, ReadyTray, SelectField, SlotGroup, StatStrip, StatusChip, StepBar,
  Tabs, TimeStamp, Tray, trayHeight, type TrayRow,
} from '@/portal/teacher/ui';
import { ROW_PX, ROW_PX_UR } from '@/portal/teacher/ui/ReadyTray';
import { OUTLINE_WIDE } from '@/portal/teacher/ui/styles';
import TeacherPage, { PageChip } from '@/portal/teacher/TeacherPage';
import TeacherNavigation from '@/portal/teacher/TeacherNavigation';

const params = new URLSearchParams(location.search);
const LANG = params.get('lang') === 'en' ? 'en' : 'ur';
const CASE = params.get('case') ?? 'main';

/** Urdu and English copy of the same shape: long, two-line, descender-heavy, with a diacritic. */
const T = LANG === 'ur'
  ? {
    short: 'کسری اعداد',
    long: 'مادّے کی حالتیں اور تبدیلی کے تجربات',
    deep: 'گھریلو پیشے اور ڈھیر سے بچے',
    extra: 'باب ۱ · ۲۰ سوالات',
    school: 'گورنمنٹ گرلز ہائی اسکول جی سکس فور اسلام آباد',
    chip: 'مکمل ہو گیا',
    chip2: 'تیاری میں',
    chip3: '۲۶ میں سے ۲۸',
    label: 'گھر کا کام',
    day: 'آج',
    day2: 'کل',
    kpi: 'استعمال شدہ سبق کے منصوبے',
    kpi2: 'مشاہدات',
    subject: 'ریاضی',
    subject2: 'اردو',
    subject3: 'عمومی سائنس',
    person: 'عائشہ بی بی',
    crumb: 'جماعت ۴ · عمومی سائنس',
    page: 'مادّے کی حالتیں',
    step: 'کلاس کا انتخاب',
    sub: 'جماعت ۴ · سیکشن اے',
    made: 'بن رہا ہے',
    lesson: 'سبق کا منصوبہ',
    paper: 'پرچہ',
  }
  : {
    short: 'Fractions',
    long: 'Adding fractions with like denominators using fraction strips and number lines',
    deep: 'Home trades and a crowd of children',
    extra: 'Chap 1 · 20 questions',
    school: 'Government Girls High School G-6/4 Islamabad',
    chip: 'Done',
    chip2: 'Writing',
    chip3: '26 of 28',
    label: 'Homework',
    day: 'Today',
    day2: 'Yesterday',
    kpi: 'Lesson plans used',
    kpi2: 'Observations',
    subject: 'Math',
    subject2: 'Urdu',
    subject3: 'General Science',
    person: 'Ayesha Bibi',
    crumb: 'Grade 4 · General Science',
    page: 'States of matter',
    step: 'Pick a class',
    sub: 'Grade 4 · Section A',
    made: 'Being made',
    lesson: 'Lesson plan',
    paper: 'Paper',
  };

const noop = () => {};
/** What NoticeHost reserves for the 2-row strip (+ the "more" row): run.mjs checks the strip really is that tall. */
(window as unknown as { __trayHeight: number }).__trayHeight = trayHeight(2, true, LANG === 'ur' ? ROW_PX_UR : ROW_PX);

function Case({ name, children }: { name: string; children: ReactNode }) {
  return <section data-case={name} className="mb-4">{children}</section>;
}

const trayRows: TrayRow[] = [
  { id: 'a', feature: 'lessons', what: T.lesson, gradeSubject: T.subject3, title: T.long, state: 'making', progress: 0.4, left: '', to: '/x' },
  { id: 'b', feature: 'assessment', what: T.paper, gradeSubject: T.subject, title: T.deep, state: 'failed', progress: 0, left: '', to: '/y' },
  { id: 'c', feature: 'lessons', what: T.lesson, gradeSubject: T.subject2, title: T.short, state: 'making', progress: 0.7, left: '', to: '/z' },
];

function Main() {
  return (
    <div className="mx-auto w-[390px] bg-[#f3f4f6] px-4 py-3 text-[#1d2025]">
      <Case name="TeacherPage header (inner)">
        <TeacherPage title={T.page} crumb={T.crumb} backTo="/x" feature="lessons" chips={<PageChip>{T.day}</PageChip>}>
          <span />
        </TeacherPage>
      </Case>
      <Case name="TeacherPage header (top-level)">
        <TeacherPage title={T.page} feature="coaching" chips={<PageChip>{T.school}</PageChip>}>
          <span />
        </TeacherPage>
      </Case>
      <Case name="HistoryList">
        <HistoryList
          heading={T.day}
          groups={[
            {
              day: T.day,
              items: [
                { subject: T.subject3, grade: 4, title: T.long, extra: T.extra, chip: { text: T.chip, tone: 'done' }, to: '/x', isNew: true },
                { subject: T.subject, grade: 7, title: T.deep, extra: T.extra, chip: { text: T.chip2, tone: 'waiting' }, to: '/x' },
                { subject: T.subject2, grade: 12, title: T.short, chip: { text: T.chip3, tone: 'score' }, action: 'download', onAction: noop },
              ],
            },
            { day: T.day2, items: [{ subject: T.subject2, grade: 1, title: T.deep, action: 'none' }] },
          ]}
        />
      </Case>
      <Case name="HistoryRow coach">
        <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
          <HistoryRow lead="person" title={T.person} extra={T.school} time="8:30" state="next" to="/x" chip={{ text: T.chip, tone: 'done' }} />
          <HistoryRow lead="school" title={T.school} wrapTitle time="10:00" first={false} to="/x" />
          <HistoryRow lead="person" leadText="87%" title={T.person} first={false} to="/x" chip={{ text: T.chip3, tone: 'score' }} />
        </div>
      </Case>
      <Case name="ListRow">
        <div className="flex flex-col gap-2">
          <ListRow label={T.long} subtitle={T.extra} number={3} icon="worksheet" chip={{ text: T.chip, tone: 'done' }} to="/x" />
          <ListRow label={T.short} prefix={LANG === 'ur' ? 'پلان #' : 'LP #'} number={12} to="/x" />
          <ListRow label={T.deep} prefix={LANG === 'ur' ? 'باب' : 'Ch'} number={4} state="used" chip={{ text: T.chip, tone: 'done' }} to="/x" />
        </div>
      </Case>
      <Case name="GradeSubjectButton">
        <div className="flex flex-col gap-2">
          <GradeSubjectButton grade={4} section="A" subject={T.subject3} sub={T.sub} chip={{ text: T.chip2, tone: 'waiting' }} to="/x" />
          <GradeSubjectButton grade={12} subject={T.long} to="/x" />
        </div>
      </Case>
      <Case name="StatusChip">
        <div className="flex flex-wrap gap-2">
          <StatusChip text={T.chip} tone="done" tick />
          <StatusChip text={T.chip2} tone="waiting" />
          <StatusChip text={T.chip3} tone="score" />
          <StatusChip text={T.deep} tone="error" />
          <StatusChip text={T.subject} tone="info" />
        </div>
      </Case>
      <Case name="KpiTiles">
        <KpiTiles
          items={[
            { value: 12, label: T.kpi, delta: 3, trend: [1, 3, 2, 5] },
            { value: 4, label: T.kpi2, delta: -1 },
            { value: '٨٥٪', label: T.deep },
          ]}
        />
      </Case>
      <Case name="FeatureKpiTiles">
        <KpiTiles
          items={[
            { value: 61, label: T.kpi, delta: 8, feature: 'lessons' },
            { value: 17, label: T.kpi2, delta: 0, feature: 'assessment' },
            { value: 7, label: T.deep, delta: -2, feature: 'observations' },
            { value: 38, label: T.kpi, delta: 11, feature: 'coaching' },
          ]}
        />
      </Case>
      <Case name="FeatureCard">
        <FeatureCard feature="attendance" title={T.deep} count={2}>
          <MeterRow feature="attendance" label={T.kpi2} value="93%" pct={93} />
          <MeterRow feature="observations" label={T.deep} pct={51} chips={[{ text: T.chip, tone: 'waiting' }]} />
        </FeatureCard>
      </Case>
      <Case name="StatStrip">
        <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
          <StatStrip items={[{ value: 12, label: T.kpi2 }, { value: 4, label: T.chip }, { value: 7, label: T.deep }]} />
        </div>
      </Case>
      <Case name="TimeStamp">
        <div className="flex flex-wrap items-center gap-4"><TimeStamp time="8:30" /><TimeStamp time="2:05 PM" size={15} /></div>
      </Case>
      <Case name="ProgressSteps">
        <ProgressSteps
          heading={T.made}
          steps={[
            { label: T.step, sub: T.sub, state: 'done' },
            { label: T.long, sub: T.extra, state: 'current', nowText: T.made },
            { label: T.deep, state: 'later' },
          ]}
          open
        />
      </Case>
      <Case name="ChosenSoFar">
        <ChosenSoFar items={[{ label: T.step, value: T.subject3, sub: T.sub, onChange: noop }, { label: T.label, value: T.long, to: '/x' }]} />
      </Case>
      <Case name="SelectField">
        <SelectField label={T.label} title={T.step} value="a" options={[{ value: 'a', label: T.long, sub: T.sub }, { value: 'b', label: T.deep }]} onChange={noop} />
      </Case>
      <Case name="ClassPicker">
        <ClassPicker
          label={T.step}
          combos={[
            { grade: 4, subject: T.subject3 }, { grade: 4, subject: T.long }, { grade: 7, subject: T.subject }, { grade: 12, subject: T.subject2 },
          ]}
        />
      </Case>
      <Case name="ChoiceChips + Tabs">
        <div className="flex flex-col gap-2">
          <ChoiceChips label={T.label} options={[{ key: 'a', label: T.subject3 }, { key: 'b', label: T.deep }]} value="a" onChange={noop} />
          <Tabs label={T.label} tabs={[{ key: 'a', label: T.subject3, count: 3 }, { key: 'b', label: T.chip }]} value="a" />
        </div>
      </Case>
      <Case name="AttentionBanner + LeaveNote">
        <div className="flex flex-col gap-2">
          <AttentionBanner text={T.long} to="/x" />
          <LeaveNote text={T.deep} sub={T.long} />
        </div>
      </Case>
      <Case name="ButtonWithReason + NumberField">
        <div className="flex flex-col gap-2">
          <ButtonWithReason label={T.step} reason={T.long} />
          <ButtonWithReason label={T.step} reason={null} onPress={noop} />
          <div className="flex gap-2.5">
            <NumberField label={T.short} value="12" onChange={noop} />
            <NumberField label={T.deep} value="8" error onChange={noop} />
          </div>
          <NumberField size="row" ariaLabel={T.short} value="0" dim onChange={noop} />
        </div>
      </Case>
      <Case name="FeatureTile">
        <div className="grid grid-cols-2 gap-2.5">
          <FeatureTile feature="lessons" label={T.long} to="/x" chip={{ text: T.chip, tone: 'done' }} />
          <FeatureTile feature="coaching" label={T.deep} to="/x" />
        </div>
      </Case>
      <Case name="SlotGroup">
        <SlotGroup time="8:30" count={2} defaultOpen people={[{ id: 1, name: T.person, sub: T.school, mine: true }, { id: 2, name: T.deep, sub: T.sub, done: true }]} />
      </Case>
      <Case name="DayStrip">
        <DayStrip value="2026-10-08" onChange={noop} week="2026-10-05" onWeekChange={noop} />
      </Case>
      <Case name="StepBar">
        <StepBar total={3} current={2} labels={[T.step, T.label, T.made]} />
      </Case>
      <Case name="OUTLINE_WIDE button">
        <button type="button" className={OUTLINE_WIDE}>{T.long}</button>
      </Case>
      <Case name="ReadyBanner">
        <ReadyBanner
          items={[{ id: 'lesson:a', feature: 'lessons', what: T.label, title: T.long, line: T.sub }]}
          onOpen={noop} onClose={noop} onExpire={noop} durationMs={3_600_000}
        />
      </Case>
      <Case name="ReadyBanner many">
        <ReadyBanner
          items={[
            { id: 'a', feature: 'lessons', what: T.label, title: T.long, line: T.sub },
            { id: 'b', feature: 'assessment', what: T.label, title: T.deep, line: T.sub },
            { id: 'c', feature: 'assessment', what: T.label, title: T.deep, line: T.sub },
          ]}
          onOpen={noop} onClose={noop} onExpire={noop} onSeeAll={noop} durationMs={3_600_000}
        />
      </Case>
      <Case name="SubjectTile + ScoreRing + RatingScale">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3"><SubjectTile subject={T.subject} /><SubjectTile subject={T.subject2} /><SubjectTile subject={T.subject3} /><ScoreRing value={86} label={T.label} /><ScoreRing value={null} label={T.label} /></div>
          <RatingScale value="2" onChange={noop} />
        </div>
      </Case>
      <Case name="TimePicker + DateRangeBar">
        <div className="flex flex-col gap-2">
          <TimePicker value="09:30" onChange={noop} caption={T.label} />
          <DateRangeBar />
        </div>
      </Case>
      <Case name="HomeGreeting + AudioCard">
        <div className="flex flex-col gap-2">
          <HomeGreeting title={T.page} date={T.day} school={T.school} brand={T.lesson} logoAlt={T.paper} />
          <AudioCard title={T.long} sub={T.sub} />
        </div>
      </Case>
      <Case name="ReadyTray">
        <ReadyTray items={trayRows} onOpenList={noop} />
      </Case>
    </div>
  );
}

function TrayCase() {
  return (
    <div className="h-[844px] w-[390px] bg-[#f3f4f6]">
      <Tray open title={`${T.made} (3)`} onClose={noop}>
        <p className="mx-1 text-[14px] text-[#6b7280]">{T.long}</p>
        <ReadyTray items={trayRows} maxRows={1} listOpen onOpenList={noop} onCloseList={noop} note={T.long} />
      </Tray>
    </div>
  );
}

function NavCase() {
  return (
    <div className="relative h-[200px] w-[390px] bg-[#f3f4f6]" style={{ transform: 'translateZ(0)' }}>
      <TeacherNavigation />
    </div>
  );
}

const Body = CASE === 'tray' ? TrayCase : CASE === 'nav' ? NavCase : Main;

async function start() {
  await i18n.changeLanguage(LANG);
  await document.fonts.load('16px "Noto Nastaliq Urdu"', 'اردو');
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode><MemoryRouter initialEntries={['/portal/teacher/lessons']}><Body /></MemoryRouter></StrictMode>,
  );
}
void start();
