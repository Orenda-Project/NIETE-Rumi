import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import ShareSheet from './ShareSheet';
import { PLAN_DATA } from './testFetch';

/**
 * The Share link sheet follows the K-5 switch (bd-s0ccn5.1): when features.lpWhatsappSend is a real false
 * (lp_whatsapp_pdf_off lists her programme) the wa.me "Send on WhatsApp" button is gone; Copy link stays.
 * Absent, unread or failed config keeps today's sheet.
 */
const cfg = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock('../../lib/useNewUi', () => ({
  peekConfig: () => (cfg.fail ? null : cfg.value),
  readConfigShared: () => (cfg.fail ? Promise.reject(new Error('down')) : Promise.resolve(cfg.value)),
}));

const URL = 'https://example.test/fln/p/abc';
function mount() {
  return render(<ShareSheet plan={PLAN_DATA.plan as never} url={URL} lang="en" onClose={() => {}} />);
}
const waLink = () => screen.queryByRole('link', { name: 'Send on WhatsApp' });
const copyBtn = () => screen.getByRole('button', { name: /copy link/i });

beforeEach(() => { cfg.value = null; cfg.fail = false; });
afterEach(() => { cleanup(); });

describe('ShareSheet — the WhatsApp text option follows features.lpWhatsappSend', () => {
  it('false → no Send on WhatsApp, Copy link stays', async () => {
    cfg.value = { features: { lpWhatsappSend: false } };
    mount();
    await waitFor(() => expect(waLink()).toBeNull());
    expect(copyBtn()).toBeTruthy();
    expect(screen.getByText(URL)).toBeTruthy();
  });
  it('false arriving after first paint removes the button', async () => {
    let resolve!: (v: unknown) => void;
    cfg.value = null;
    const p = new Promise((r) => { resolve = r; });
    const mod = await import('../../lib/useNewUi');
    vi.spyOn(mod, 'readConfigShared').mockReturnValueOnce(p as never);
    mount();
    expect(waLink()).toBeTruthy();
    resolve({ features: { lpWhatsappSend: false } });
    await waitFor(() => expect(waLink()).toBeNull());
  });
  it.each([
    ['true', { features: { lpWhatsappSend: true } }],
    ['field absent', { features: {} }],
    ['no config', null],
  ])('%s → Send on WhatsApp shown', async (_l, value) => {
    cfg.value = value;
    mount();
    await waitFor(() => expect(waLink()).toBeTruthy());
    expect(copyBtn()).toBeTruthy();
  });
  it('config read fails → Send on WhatsApp shown', async () => {
    cfg.fail = true;
    mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(waLink()).toBeTruthy();
  });
});
