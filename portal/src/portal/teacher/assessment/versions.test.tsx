import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';

/**
 * Versions of a board-pattern paper (SPEC v2 §8.2 PaperPage/VersionsPage): the FDE chip, and each ready version
 * offers its Marking scheme beside the paper (the key artifact, labelled as the scheme). A plain paper's Versions
 * page is unchanged (golden snapshot).
 */

const { portal } = vi.hoisted(() => ({
  portal: {
    getAssessmentPapers: vi.fn(),
    getAssessmentVersions: vi.fn(),
    getAssessmentDownload: vi.fn(),
  },
}));
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { forgetPapers } from './paperCache';
import { VersionsPage } from './VersionsPage';
import { ASSESSMENT_V2_BASE as B, versionsPath } from './paths';

const plain = (t: string | null | undefined) => (t || '').replace(/[⁦⁩]/g, '');

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={`${B}/paper/:paperId/versions`} element={<VersionsPage />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const FIXED_DAY = '2026-10-01T05:00:00.000Z';
const VERSIONS = [
  { paperId: 'v2', version: 2, status: 'ready', createdAt: FIXED_DAY, questionCount: 30, marks: 100, editedFrom: 'v1', latest: true },
  { paperId: 'v1', version: 1, status: 'ready', createdAt: FIXED_DAY, questionCount: 31, marks: 100, editedFrom: null, latest: false },
  { paperId: 'v3', version: 3, status: 'generating', createdAt: FIXED_DAY, questionCount: null, marks: null, editedFrom: 'v2', latest: false },
];
const row = (paperId: string, pattern: string | null) => ({
  paper_id: paperId, grade: 5, subject_key: 'maths', subject: 'Mathematics', chapter_number: null, question_count: 30,
  total_marks: 100, ready_at: FIXED_DAY, version: 2, has_answer_key: true, pattern,
});

beforeEach(async () => {
  vi.clearAllMocks();
  forgetPapers();
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  portal.getAssessmentVersions.mockResolvedValue({ success: true, versions: VERSIONS });
  portal.getAssessmentDownload.mockResolvedValue({ available: true, url: 'https://files.example/scheme.pdf' });
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

describe('versions of an FDE paper', () => {
  it('shows the FDE chip and a Marking scheme row on each ready version, which opens the key file', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ papers: [row('v2', 'fde_g5_2027')], total: 1 });
    at(versionsPath('v2'));
    await screen.findByTestId('versions-list');
    await screen.findByText('FDE pattern');
    const schemes = await screen.findAllByTestId('version-scheme');
    expect(schemes).toHaveLength(2); // the two ready versions; not the one still being written
    expect(schemes[0].textContent).toContain('Marking scheme');
    fireEvent.click(schemes[1]);
    await waitFor(() => expect(portal.getAssessmentDownload).toHaveBeenCalledWith('v1', 'answer_key'));
  });

  it('in Urdu: the chip and the row are Urdu', async () => {
    await act(async () => { await i18n.changeLanguage('ur'); });
    portal.getAssessmentPapers.mockResolvedValue({ papers: [row('v2', 'fde_g5_2027')], total: 1 });
    at(versionsPath('v2'));
    const schemes = await screen.findAllByTestId('version-scheme');
    expect(plain(schemes[0].textContent)).toContain('مارکنگ اسکیم');
    expect(plain(document.body.textContent)).toContain('FDE pattern');
    expect(document.body.textContent).not.toContain('Marking scheme');
  });
});

describe('a plain paper is unchanged', () => {
  it('no chip, no Marking scheme rows', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ papers: [row('v2', null)], total: 1 });
    at(versionsPath('v2'));
    await screen.findByText('Version 1');
    await waitFor(() => expect(portal.getAssessmentPapers).toHaveBeenCalled());
    expect(screen.queryByText('FDE pattern')).toBeNull();
    expect(screen.queryByTestId('version-scheme')).toBeNull();
  });

  it('golden: the plain Versions page renders byte-identical to the branch point', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ papers: [row('v2', null)], total: 1 });
    const { container } = at(versionsPath('v2'));
    await screen.findByText('Version 1');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // The list is the golden; the QA handle around its card (display:contents, no box) is unwrapped here.
    const handle = container.querySelector('[data-testid="versions-list"]');
    expect(handle?.className).toBe('contents');
    handle?.replaceWith(...Array.from(handle.childNodes));
    expect(container.innerHTML).toMatchSnapshot();
  });
});
