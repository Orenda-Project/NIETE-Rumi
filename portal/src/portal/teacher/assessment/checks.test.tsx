import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { newUiSourceFiles, scanCopy, scanStyle } from '../../newui/checks/source';
import { collectCopy, copyProblem, tapProblems } from '../../newui/checks/rules';

/**
 * bd-fmf24g.6 — the teacher v2 Assessment pages keep the kit's rules (teacher/ui/checks.test.tsx), with the
 * same checkers: start/end only, motion only under motion-safe:, no lying theme classes; every word from
 * copy.ts (≤4 words, never a sentence); every target 56px. And the registry: every page under the v2 base.
 */

vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { ASSESSMENT_V2_COPY } from './copy';
import routes from './routes';
import { ASSESSMENT_V2_BASE } from './paths';
import { CheckRow, Choice, StepFrame, Stepper, SwitchRow, Tabs, LoadState } from './ui';
import { QuestionForm } from './QuestionForm';
import { blankValues, valuesFromFields } from './editForm';

const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe('assessment: style', () => {
  it('reads the pages\' source', () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(['AssessmentHub.tsx', 'NewPaperSteps.tsx', 'EditPages.tsx']));
  });

  it('no left/right utilities, no motion outside motion-safe:, no lying theme classes', () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== 'raw-colour' && p.rule !== 'feature-colour');
    expect(problems).toEqual([]);
  });
});

describe('assessment: copy', () => {
  it('every word is a label: at most 4 words, never a sentence', () => {
    const bad = collectCopy(ASSESSMENT_V2_COPY).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it('no words written into a page (they come from copy.ts)', () => {
    const problems = files().filter((f) => f.rel !== 'copy.ts').flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe('assessment: every target is 56px or more', () => {
  it('the step frame, tabs, stepper, choices, tick rows, switch and the retry', () => {
    const { container } = render(
      <MemoryRouter>
        <StepFrame step="types" backTo="/x" next={{ label: 'N', ready: true, to: '/y' }}>
          <Tabs label="T" value="a" onChange={() => {}} options={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} />
          <Stepper value={3} lessLabel="L" moreLabel="M" onLess={() => {}} onMore={() => {}} />
          <Stepper compact value={3} lessLabel="L" moreLabel="M" onLess={() => {}} onMore={() => {}} />
          <Choice picked onPick={() => {}} icon={<span />} name="C" />
          <CheckRow checked onToggle={() => {}} label={<span />} />
          <SwitchRow on onFlip={() => {}} icon={<span />} name="S" />
          <LoadState status="error" onRetry={() => {}} />
        </StepFrame>
        <StepFrame step="check" backTo="/x" next={{ label: 'N', ready: false }}><span /></StepFrame>
      </MemoryRouter>,
    );
    expect(tapProblems(container)).toEqual([]);
  });

  it('the question boxes, every shape', () => {
    const base = { question: 'Q', marks: '1', answer: 'A', lines: '2', lines_default: 2, lines_options: [{ id: '2', title: '2' }], show_lines: true };
    const shapes = [
      { ...base, shape: 'standard' as const },
      { ...base, shape: 'options' as const, slots: ['a', 'b'], correct: '0', show_correct: true },
      { ...base, shape: 'columns' as const, pairs: [{ left: 'x', right: 'y' }] },
      { ...base, shape: 'words' as const, slots: ['w'] },
      { ...base, shape: 'passage' as const, passage: 'P' },
    ];
    const { container } = render(
      <>
        {shapes.map((f) => <QuestionForm key={f.shape} fields={f} values={valuesFromFields(f)} onChange={() => {}} rtl={false} />)}
        {(['standard', 'options', 'words', 'columns', 'comprehension'] as const).map((layout) => {
          const k = { kind: layout, label: layout, layout, section: 'subjective' as const, marks: 1, lines: 2, meanings: layout === 'words' };
          return <QuestionForm key={`add-${layout}`} kind={k} values={{ ...blankValues(k), subs: [{ question: '', answer: '', marks: '' }, { question: '', answer: '', marks: '' }] }} onChange={() => {}} rtl={false} />;
        })}
      </>,
    );
    expect(tapProblems(container)).toEqual([]);
  });
});

describe('assessment: routes', () => {
  it('registers the main page and every assessment screen under the v2 base', () => {
    const paths = routes.map((r) => r.path);
    expect(paths[0]).toBe(ASSESSMENT_V2_BASE);
    expect(paths.every((p) => p.startsWith(ASSESSMENT_V2_BASE))).toBe(true);
    for (const suffix of ['/new/class', '/new/cover', '/new/questions', '/new/types', '/new/extras', '/new/check',
      '/request/:requestId', '/paper/:paperId', '/paper/:paperId/versions', '/paper/:paperId/edit',
      '/paper/:paperId/edit/q/:key', '/paper/:paperId/edit/add/:kind']) {
      expect(paths).toContain(`${ASSESSMENT_V2_BASE}${suffix}`);
    }
  });
});
