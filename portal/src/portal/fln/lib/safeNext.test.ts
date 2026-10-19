import { describe, it, expect } from 'vitest';
import { safeNext } from './safeNext';

/**
 * bd-t7zk3t.12 — `next=` after sign-in: a same-origin PATH under /portal/fln/ or /portal/teacher/, or null (the caller
 * then goes home). Anything that could leave the site, or reach another part of it, is null.
 */
describe('safeNext — allowed', () => {
  it.each([
    ['/portal/fln/p/11156', '/portal/fln/p/11156'],
    ['/portal/fln/p/11156?src=wa', '/portal/fln/p/11156?src=wa'],
    ['/portal/fln/list/rh-en?grade=8&level=2', '/portal/fln/list/rh-en?grade=8&level=2'],
    ['/portal/fln/send', '/portal/fln/send'],
    ['/portal/teacher/lessons/open?plan=fln:11156', '/portal/teacher/lessons/open?plan=fln:11156'],
    ['/portal/teacher/home#top', '/portal/teacher/home#top'],
  ])('%s → %s', (raw, out) => {
    expect(safeNext(raw)).toBe(out);
  });
});

describe('safeNext — refused', () => {
  it.each([
    null,
    undefined,
    '',
    '   ',
    'portal/fln/p/1',
    '/portal/dashboard',
    '/portal/leader/teachers',
    '/portal/login?next=/portal/fln/p/1',
    '/portal/flnx/p/1',
    '/portal/fln',
    '/',
    '//evil.example/portal/fln/p/1',
    '///evil.example/portal/fln/p/1',
    '/\\evil.example/portal/fln/p/1',
    '\\\\evil.example/portal/fln/p/1',
    '/portal/fln/p/1\\..\\..\\x',
    'https://evil.example/portal/fln/p/1',
    'http://localhost/portal/fln/p/1',
    'javascript:alert(1)//portal/fln/',
    'JAVASCRIPT:alert(1)',
    'data:text/html,/portal/fln/p/1',
    ' /portal/fln/p/1',
    '/portal/fln/p/1\n',
    '/portal/fln/p/1\r\nSet-Cookie: x',
    '/portal/fln/p/1\u0000',
    '/portal/fln/p/\u0009/1',
    '/portal/fln/p/1\u007f',
    '%2F%2Fevil.example/portal/fln/p/1',
    '/%2F%2Fevil.example/portal/fln/p/1',
    '/portal/fln/p/%2F%2Fevil.example',
    '/portal/fln/p/%2f%2fevil.example',
    '/portal/fln/p/%252F%252Fevil.example',
    '/portal/fln/%5C%5Cevil.example',
    '/portal/fln/../dashboard',
    '/portal/fln/%2E%2E/dashboard',
    '/portal/fln/p/%E0%A4%A',
    '/portal/fln/p/\u2028',
    `/portal/fln/p/${'1'.repeat(3000)}`,
  ])('%j → null', (raw) => {
    expect(safeNext(raw as string)).toBeNull();
  });

  it('a non-string is null', () => {
    expect(safeNext(42 as unknown as string)).toBeNull();
    expect(safeNext({} as unknown as string)).toBeNull();
  });
});
