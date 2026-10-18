import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import SendSheet from './SendSheet';
import { stubFetch, callsTo, PLAN_DATA, wholeText } from './testFetch';

/**
 * bd-t7zk3t.12 — "Send to teacher" (DESIGN v2 §4 L2a, §7): the leader's own teachers (keyed ids, never a phone), search,
 * multi-select up to 30, Send → POST /send; Sent ✓ / partial failure / rate limit / no teachers; and while the server
 * routes (PR-E) are not deployed, /teachers 404 → one calm line and a button to Share link.
 */
const TEACHERS = [
  { key: 'k1', name: 'Teacher One', school: 'School A', phone: '000-should-never-show' },
  { key: 'k2', name: 'Teacher Two', school: 'School B' },
  { key: 'k3', name: 'Teacher Three' },
];
const card = { id: 11156, title: PLAN_DATA.plan.title, lang: 'en' as const, dir: 'ltr' as const, subject: 'rh-en' as const, level: 1, pos: 24, count: 48 };

function mount(props: Partial<Parameters<typeof SendSheet>[0]> = {}) {
  const onShareLink = vi.fn();
  const onClose = vi.fn();
  render(<SendSheet lang="en" plan={card} onClose={onClose} onShareLink={onShareLink} {...props} />);
  return { onShareLink, onClose };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SendSheet', () => {
  it('lists the leader\'s teachers by name and school — never a phone number', async () => {
    const f = stubFetch({ '/api/portal/fln/teachers': { status: 200, body: { teachers: TEACHERS } } });
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Send to teacher' });
    await screen.findByText('Teacher One');
    expect(dialog.textContent).toContain('School A');
    expect(dialog.textContent).not.toContain('000-should-never-show');
    expect(callsTo(f, '/fln/teachers')[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
  });

  it('search asks the server with q=', async () => {
    const f = stubFetch({ '/api/portal/fln/teachers': { status: 200, body: { teachers: TEACHERS } } });
    mount();
    await screen.findByText('Teacher One');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search teachers' }), { target: { value: 'Two' } });
    await waitFor(() => expect(callsTo(f, '/fln/teachers?q=Two')).toHaveLength(1));
  });

  it('pick two, Send → POST /send {plan, teachers} → "Sent ✓ · 2 teachers"', async () => {
    const f = stubFetch({
      '/api/portal/fln/teachers': { status: 200, body: { teachers: TEACHERS } },
      '/api/portal/fln/send': { status: 200, body: { queued: 2, failed: [] } },
    });
    mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Teacher One/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Teacher Two/ }));
    expect(screen.getByText(wholeText('2 selected'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(wholeText('Sent ✓ · 2 teachers'))).toBeTruthy();
    const [, init] = callsTo(f, '/fln/send')[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ plan: 11156, teachers: ['k1', 'k2'] });
  });

  it('Send is off until a teacher is picked; every control is ≥48 px', async () => {
    stubFetch({ '/api/portal/fln/teachers': { status: 200, body: { teachers: TEACHERS } } });
    mount();
    await screen.findByText('Teacher One');
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    for (const el of [send, ...screen.getAllByRole('checkbox')]) expect(el.className).toContain('min-h-[48px]');
  });

  it('a partial failure names how many failed; the rest are sent', async () => {
    stubFetch({
      '/api/portal/fln/teachers': { status: 200, body: { teachers: TEACHERS } },
      '/api/portal/fln/send': { status: 200, body: { queued: 2, failed: ['k3'] } },
    });
    mount();
    for (const n of ['One', 'Two', 'Three']) fireEvent.click(await screen.findByRole('checkbox', { name: new RegExp(`Teacher ${n}`) }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(wholeText("Couldn't send to 1 teacher. Try again"))).toBeTruthy();
    expect(screen.getByText(wholeText('Sent ✓ · 2 teachers'))).toBeTruthy();
  });

  it('429 → the rate-limit line', async () => {
    stubFetch({
      '/api/portal/fln/teachers': { status: 200, body: { teachers: TEACHERS } },
      '/api/portal/fln/send': { status: 429, body: { error: 'rate_limited' } },
    });
    mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Teacher One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(wholeText('You can send to 30 teachers an hour. Try again later.'))).toBeTruthy();
  });

  it('no teachers in scope → "No teachers are assigned to you yet"', async () => {
    stubFetch({ '/api/portal/fln/teachers': { status: 200, body: { teachers: [] } } });
    mount();
    expect(await screen.findByText('No teachers are assigned to you yet')).toBeTruthy();
  });

  it('/teachers 404 (send not deployed) → one calm line and a button that opens Share link', async () => {
    stubFetch({ '/api/portal/fln/teachers': { status: 404, body: { error: 'not_found' } } });
    const { onShareLink } = mount();
    expect(await screen.findByText("Sending isn't available yet. Use Share link.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(onShareLink).toHaveBeenCalled();
  });

  it('at most 30 at a time: the 31st teacher cannot be picked', async () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, name: `T${i}` }));
    stubFetch({ '/api/portal/fln/teachers': { status: 200, body: { teachers: many } } });
    mount();
    await screen.findByText('T0');
    const boxes = screen.getAllByRole('checkbox');
    boxes.forEach((b) => fireEvent.click(b));
    expect(screen.getByText(wholeText('30 selected'))).toBeTruthy();
    expect((boxes[30] as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    expect((boxes[30] as HTMLButtonElement).disabled).toBe(true);
  });

  it('Urdu chrome: the sheet is rtl with Urdu words and digits; the plan title keeps its own direction', async () => {
    stubFetch({ '/api/portal/fln/teachers': { status: 200, body: { teachers: TEACHERS } } });
    mount({ lang: 'ur' });
    const dialog = await screen.findByRole('dialog', { name: 'استاد کو بھیجیں' });
    expect(dialog.getAttribute('dir')).toBe('rtl');
    const title = within(dialog).getByText(PLAN_DATA.plan.title);
    expect(title.getAttribute('dir')).toBe('ltr');
    expect(dialog.textContent).toContain('سطح ۱');
    expect(dialog.textContent).not.toContain('·');
  });
});
