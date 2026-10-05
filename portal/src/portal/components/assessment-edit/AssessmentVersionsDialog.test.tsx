import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../services/api', () => ({
  portal: {
    getAssessmentVersions: vi.fn().mockResolvedValue({ versions: [
      { paperId: 'vf', version: null, status: 'failed', createdAt: '2026-10-01T10:00:00Z', questionCount: null, marks: null, editedFrom: 'v2', latest: false },
      { paperId: 'v2', version: 2, status: 'ready', createdAt: '2026-09-30T10:00:00Z', questionCount: 14, marks: 28, editedFrom: 'v1', latest: true },
      { paperId: 'v1', version: 1, status: 'ready', createdAt: '2026-09-29T10:00:00Z', questionCount: 15, marks: 30, editedFrom: null, latest: false },
    ] }),
    getAssessmentDownload: vi.fn().mockResolvedValue({ available: true, url: 'https://x' }),
  },
}));
import AssessmentVersionsDialog from './AssessmentVersionsDialog';

it('lists every version; v1 says as generated; a failed one says Not made and has no Edit', async () => {
  const onEdit = vi.fn();
  render(<AssessmentVersionsDialog paperId="v2" open onOpenChange={() => {}} onEdit={onEdit} />);
  expect(await screen.findByText(/Version 2 · latest/)).toBeTruthy();
  expect(screen.getByText(/Version 1 · as generated/)).toBeTruthy();
  expect(screen.getByText(/Not made/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Edit$/ })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: /^Edit$/ })[1]);
  expect(onEdit).toHaveBeenCalledWith('v1');
});
