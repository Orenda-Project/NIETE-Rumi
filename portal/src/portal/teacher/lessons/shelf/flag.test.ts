import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/** bd-snkn32.42 — both switches are fail-closed: on only for a real `true` in /config. */
const cfg = vi.hoisted(() => ({ read: (): Promise<unknown> => Promise.resolve(null) }));
vi.mock('../../../lib/useNewUi', () => ({ readConfigShared: () => cfg.read() }));
import { LESSONS_CHECK, useLpOwnReviewer, useLpOwnShelf } from './flag';

const settle = async (hook: () => boolean | null) => {
  const { result } = renderHook(hook);
  expect(result.current).toBeNull();
  await waitFor(() => expect(result.current).not.toBeNull());
  return result.current;
};

beforeEach(() => { cfg.read = () => Promise.resolve(null); });

describe('the shelf switches', () => {
  it('each reads its own feature, true only for true', async () => {
    cfg.read = () => Promise.resolve({ features: { lpOwnShelf: true, lpOwnReviewer: 'yes' } });
    expect(await settle(useLpOwnShelf)).toBe(true);
    expect(await settle(useLpOwnReviewer)).toBe(false);
    cfg.read = () => Promise.resolve({ features: { lpOwnShelf: false, lpOwnReviewer: true } });
    expect(await settle(useLpOwnShelf)).toBe(false);
    expect(await settle(useLpOwnReviewer)).toBe(true);
  });

  it('no config, or a failed read: off', async () => {
    expect(await settle(useLpOwnShelf)).toBe(false);
    cfg.read = () => Promise.reject(new Error('down'));
    expect(await settle(useLpOwnReviewer)).toBe(false);
  });

  it('the check page sits under Lesson Plans', () => {
    expect(LESSONS_CHECK).toBe('/portal/teacher/lessons/check');
  });
});
