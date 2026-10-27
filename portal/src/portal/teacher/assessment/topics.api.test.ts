import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task 5 — loadTopics: the topic picker's list for one chapter, via portal.getAssessmentTopics
 * (GET /api/portal/assessment/topics). [] when the chapter has no topics loaded; a failure is thrown, never [].
 */
const { portal } = vi.hoisted(() => ({ portal: { getAssessmentTopics: vi.fn() } }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve({ features: {} }) }));

import { loadTopics } from './api';

const TOPIC = { topicId: '1-maths-3-m-01-as-01', name: 'How many more?', heading: null, headingOrder: null, sortOrder: 1 };

beforeEach(() => portal.getAssessmentTopics.mockReset());

describe('loadTopics', () => {
  it('asks for one chapter of one book and returns its topics', async () => {
    portal.getAssessmentTopics.mockResolvedValue({ success: true, topics: [TOPIC] });
    await expect(loadTopics(1, 'maths', 3)).resolves.toEqual([TOPIC]);
    expect(portal.getAssessmentTopics).toHaveBeenCalledWith(1, 'maths', 3);
  });

  it('a chapter with none loaded gives []', async () => {
    portal.getAssessmentTopics.mockResolvedValue({ success: true, topics: [] });
    await expect(loadTopics(5, 'science', 9)).resolves.toEqual([]);
  });

  it('a failed read is thrown, not turned into []', async () => {
    portal.getAssessmentTopics.mockRejectedValue(new Error('500'));
    await expect(loadTopics(1, 'maths', 3)).rejects.toThrow('500');
  });
});
