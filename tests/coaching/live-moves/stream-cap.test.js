/**
 * Live moves (bd-v0toag.31): at most 5 live streams at once. A slot is held by a live id until it is released or
 * goes 180 s without a touch; the same id asking again keeps its slot.
 */
const { createStreamCap } = require('../../../bot/shared/services/coaching/live-moves/stream-cap');

describe('createStreamCap', () => {
  test('sixth acquire refused', () => {
    const cap = createStreamCap({ limit: 5 });
    for (let i = 1; i <= 5; i++) expect(cap.acquire(`l${i}`, 0)).toBe(true);
    expect(cap.acquire('l6', 0)).toBe(false);
    expect(cap.size(0)).toBe(5);
  });

  test('same liveId re-acquires', () => {
    const cap = createStreamCap({ limit: 1 });
    expect(cap.acquire('l1', 0)).toBe(true);
    expect(cap.acquire('l1', 10)).toBe(true);
    expect(cap.size(10)).toBe(1);
  });

  test('idle slot expires after 180 s', () => {
    const cap = createStreamCap({ limit: 1 });
    cap.acquire('l1', 0);
    expect(cap.acquire('l2', 179_999)).toBe(false);
    expect(cap.acquire('l2', 180_000)).toBe(true);
  });

  test('touch keeps a slot alive', () => {
    const cap = createStreamCap({ limit: 1 });
    cap.acquire('l1', 0);
    cap.touch('l1', 170_000);
    expect(cap.acquire('l2', 200_000)).toBe(false);
  });

  test('release frees a slot', () => {
    const cap = createStreamCap({ limit: 1 });
    cap.acquire('l1', 0);
    cap.release('l1');
    expect(cap.acquire('l2', 1)).toBe(true);
  });
});
