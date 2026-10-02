'use strict';
/**
 * Meta bill cut NC4 — the classroom-photo step sends fewer bubbles, same words.
 *
 *   N2-C06  "📸 Would you like to add up to 3 photos?…" now carries the "send them
 *           one at a time — board first…" instruction, so the Yes tap sends no
 *           text (it keeps the 👍 every tap already gets).
 *   N2-C04  photos that arrive seconds apart get ONE debounced receipt prompt
 *           with the running count ("📸 2 of 3 photos received…"), not one each.
 *   N2-C08  the 3rd photo's "📸 Photo 3 received. Maximum reached." opens the
 *           lesson-plan prompt instead of being its own text.
 *   N2-C07  a photo that races the transcription gets a 📸 reaction instead of
 *           "📸 Got your classroom photo — I'll include it…".
 *   N2-C09  the "Add another" tap gets a 📸 reaction instead of "Send the next
 *           classroom photo — photo n of max" (the receipt prompt now carries
 *           "n of max").
 *   N2-C10  the prior-commitment reminder opens the photo offer's body.
 *
 * Fallbacks pinned: no wamid / a skipped reaction → the old text; no Redis → the
 * receipt prompt goes out at once, as before; a body over 1,024 code points →
 * the old separate text.
 *
 * Network edges mocked (supabase, Redis, whatsapp sends, R2); the services run.
 */
const SID = '11111111-2222-4333-8444-555555555555';
const FROM = '923001234567';
const WAMID = 'wamid.HER_MESSAGE';
const USER = { id: 'teacher-1', preferred_language: 'en' };

const sent = [];   // every outbound, in order: { kind, to, body|text|emoji|id }
const mockRedis = new Map();
let redisUp = true;
let sessionRow;
let userLang = 'en';

function waMock() {
  return {
    sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
    sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, body: p.body, buttons: p.buttons }); return true; }),
    sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ kind: 'list', to, body: p.body && p.body.text }); return true; }),
    sendReaction: jest.fn(async (to, id, emoji) => { sent.push({ kind: 'reaction', to, id, emoji }); return true; }),
    downloadMedia: jest.fn(async () => Buffer.from('JPEG')),
  };
}
function redisMock() {
  return {
    isAvailable: () => redisUp,
    setNX: jest.fn(async (k, v) => { if (!redisUp) return true; if (mockRedis.has(k)) return false; mockRedis.set(k, v); return true; }),
    set: jest.fn(async (k, v) => { if (!redisUp) return false; mockRedis.set(k, v); return true; }),
    get: jest.fn(async (k) => (redisUp && mockRedis.has(k) ? mockRedis.get(k) : null)),
    delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
    setexWithCeiling: jest.fn(async (k, _t, v) => { mockRedis.set(k, v); return true; }),
  };
}
function supabaseMock() {
  return {
    from: (table) => {
      const b = {};
      ['select', 'eq', 'order', 'limit', 'not', 'in', 'is', 'neq', 'or'].forEach((m) => { b[m] = () => b; });
      b.update = (patch) => {
        if (table === 'coaching_sessions') {
          sessionRow = { ...sessionRow, ...patch };
        }
        return b;
      };
      const settle = () => {
        if (table === 'users') return { data: { id: USER.id, preferred_language: userLang, region: 'ict' }, error: null };
        return { data: sessionRow, error: null };
      };
      b.single = async () => settle();
      b.maybeSingle = async () => settle();
      b.then = (ok, ko) => Promise.resolve(table === 'coaching_sessions'
        ? { data: [{ id: SID, ...sessionRow }], error: null }
        : settle()).then(ok, ko);
      return b;
    },
  };
}

function load() {
  jest.resetModules();
  sent.length = 0;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => waMock());
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => redisMock());
  jest.doMock('../../bot/shared/config/supabase', () => supabaseMock());
  jest.doMock('../../bot/shared/storage/r2', () => ({ uploadImageWithRetry: jest.fn(async (_b, _u, name) => `r2://${name}`) }));
  jest.doMock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => userLang), setUserLanguage: jest.fn() }));
  return {
    capture: require('../../bot/shared/services/coaching/classroom-photo/capture.service'),
    attach: require('../../bot/shared/services/coaching/media-attach.service'),
    photoYes: require('../../bot/shared/services/coaching/classroom-photo/photo-yes.service'),
    addAnother: require('../../bot/shared/services/coaching/classroom-photo/add-another.service'),
    prompt: require('../../bot/shared/services/coaching/classroom-photo/photo-prompt.service'),
    ux: require('../../bot/shared/config/ux-strings'),
  };
}

const PHOTOS = (n) => Array.from({ length: n }, (_, i) => ({ url: `r2://p${i}`, uploaded_at: '2026-10-01T00:00:00.000Z' }));
function onPhotoStep(n) {
  return {
    id: SID, user_id: USER.id, status: 'awaiting_classroom_photo', observation_type: null, observer_user_id: null,
    conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO', classroom_photos: PHOTOS(n) },
    classroom_photos: PHOTOS(n),
  };
}

beforeEach(() => {
  mockRedis.clear();
  redisUp = true;
  userLang = 'en';
  process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS = '40';
});
afterAll(() => { delete process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS; });

describe('N2-C06 — the offer carries the "send them now" instruction; Yes sends no text', () => {
  test.each(['en', 'ur'])('[%s] the offer body now ends with the instruction the Yes text carried', (lang) => {
    const { ux } = load();
    const offer = ux.resolveUx('coachingPhotoOffer', { language: lang });
    const marker = lang === 'en' ? 'one at a time — board first' : 'ایک ایک کر کے — پہلے بورڈ';
    expect(offer).toContain(marker);
    expect(offer.indexOf(marker)).toBeGreaterThan(offer.indexOf(lang === 'en' ? 'does not help the analysis' : 'مدد نہیں کرتی'));
    expect([...offer].length).toBeLessThanOrEqual(1024);
  });

  test('the Yes tap moves the session onto the photo step and sends NO text', async () => {
    const m = load();
    sessionRow = { ...onPhotoStep(0), status: 'awaiting_photo', conversation_state: { current_state: 'AWAITING_PHOTO' } };
    const ok = await m.photoYes.advanceToClassroomPhotoStep({ sessionId: SID, from: FROM, tapperUserId: USER.id });
    expect(ok).toBe(true);
    expect(sessionRow.status).toBe('awaiting_classroom_photo');
    expect(sent.filter((s) => s.kind === 'text')).toEqual([]);
  });
});

describe('N2-C04 — one receipt prompt per burst, with the running count', () => {
  test('two photos seconds apart → ONE prompt: "2 of 3 photos received", Add another / Done', async () => {
    const m = load();
    sessionRow = onPhotoStep(0);
    const first = m.capture.capturePhotoAndPrompt({ session: onPhotoStep(0), imageBuffer: Buffer.from('a'), mimeType: 'image/jpeg', from: FROM, user: USER });
    await new Promise((r) => setTimeout(r, 5));
    const second = m.capture.capturePhotoAndPrompt({ session: onPhotoStep(1), imageBuffer: Buffer.from('b'), mimeType: 'image/jpeg', from: FROM, user: USER });
    await Promise.all([first, second]);

    const prompts = sent.filter((s) => s.kind === 'buttons');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].body).toBe(m.ux.resolveUx('coachingPhotoReceivedMany', { language: 'en', params: { n: '2', max: '3' } }));
    expect(prompts[0].buttons.map((b) => b.id)).toEqual([`photo_more_${SID}`, `photo_done_${SID}`]);
    expect(sent.filter((s) => s.kind === 'text')).toEqual([]);
  });

  test('a single photo → one prompt that names its place: "Photo 1 of 3 received"', async () => {
    const m = load();
    sessionRow = onPhotoStep(0);
    await m.capture.capturePhotoAndPrompt({ session: onPhotoStep(0), imageBuffer: Buffer.from('a'), mimeType: 'image/jpeg', from: FROM, user: USER });
    const prompts = sent.filter((s) => s.kind === 'buttons');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].body).toBe(m.ux.resolveUx('coachingPhotoReceivedOne', { language: 'en', params: { n: '1', max: '3' } }));
  });

  test('[ur] Urdu prompt and Urdu buttons, Urdu digits', async () => {
    userLang = 'ur';
    const m = load();
    sessionRow = onPhotoStep(0);
    await m.capture.capturePhotoAndPrompt({ session: onPhotoStep(0), imageBuffer: Buffer.from('a'), mimeType: 'image/jpeg', from: FROM, user: { ...USER, preferred_language: 'ur' } });
    const p = sent.find((s) => s.kind === 'buttons');
    expect(p.body).toBe(m.ux.resolveUx('coachingPhotoReceivedOne', { language: 'ur', params: { n: '۱', max: '۳' } }));
    expect(/[؀-ۿ]/.test(p.buttons[0].title)).toBe(true);
    for (const b of p.buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
  });

  test('FALLBACK — no Redis: each photo is answered at once, as before', async () => {
    redisUp = false;
    const m = load();
    sessionRow = onPhotoStep(0);
    await m.capture.capturePhotoAndPrompt({ session: onPhotoStep(0), imageBuffer: Buffer.from('a'), mimeType: 'image/jpeg', from: FROM, user: USER });
    await m.capture.capturePhotoAndPrompt({ session: onPhotoStep(1), imageBuffer: Buffer.from('b'), mimeType: 'image/jpeg', from: FROM, user: USER });
    expect(sent.filter((s) => s.kind === 'buttons')).toHaveLength(2);
  });
});

describe('N2-C08 — "Photo 3 received. Maximum reached." opens the lesson-plan prompt', () => {
  test('3rd photo → ONE bubble: the LP prompt whose body opens with the max line', async () => {
    const m = load();
    sessionRow = onPhotoStep(2);
    await m.capture.capturePhotoAndPrompt({ session: onPhotoStep(2), imageBuffer: Buffer.from('c'), mimeType: 'image/jpeg', from: FROM, user: USER });
    const lead = m.ux.resolveUx('coachingPhotoMaxReached', { language: 'en', params: { n: '3' } });
    expect(sent.filter((s) => s.kind === 'text')).toEqual([]);
    const lp = sent.filter((s) => s.kind === 'buttons' || s.kind === 'list');
    expect(lp).toHaveLength(1);
    expect(lp[0].body.startsWith(`${lead}\n\n`)).toBe(true);
    expect(sessionRow.status).toBe('awaiting_lesson_plan');
  });

  test('a burst that ends at the cap: the pending "2 of 3" prompt is dropped, only the LP prompt goes', async () => {
    const m = load();
    sessionRow = onPhotoStep(1);
    const second = m.capture.capturePhotoAndPrompt({ session: onPhotoStep(1), imageBuffer: Buffer.from('b'), mimeType: 'image/jpeg', from: FROM, user: USER });
    await new Promise((r) => setTimeout(r, 5));
    const third = m.capture.capturePhotoAndPrompt({ session: onPhotoStep(2), imageBuffer: Buffer.from('c'), mimeType: 'image/jpeg', from: FROM, user: USER });
    await Promise.all([second, third]);
    expect(sent.filter((s) => (s.buttons || []).some((b) => b.id === `photo_more_${SID}`))).toHaveLength(0);
    expect(sent.filter((s) => s.kind === 'buttons' || s.kind === 'list')).toHaveLength(1);
  });
});

describe('N2-C07 — a photo that races the transcription gets a 📸 reaction', () => {
  const holding = () => ({ ...onPhotoStep(0), status: 'transcribing', conversation_state: { current_state: 'TRANSCRIBING' } });

  test('with their wamid → 📸 on their photo, no text', async () => {
    const m = load();
    sessionRow = holding();
    await m.attach.attachClassroomPhoto({ user: USER, from: FROM, mediaId: 'img-1', mimeType: 'image/jpeg', session: holding(), messageId: WAMID });
    expect(sent).toEqual([{ kind: 'reaction', to: FROM, id: WAMID, emoji: '📸' }]);
  });

  test('FALLBACK — no wamid (a parked photo re-attached later) → the text, as before', async () => {
    const m = load();
    sessionRow = holding();
    await m.attach.attachClassroomPhoto({ user: USER, from: FROM, mediaId: 'img-1', mimeType: 'image/jpeg', session: holding(), claim: false });
    expect(sent).toEqual([{ kind: 'text', to: FROM, text: m.ux.resolveUx('coachingPhotoHeld', { language: 'en' }) }]);
  });
});

describe('N2-C09 — the "Add another" tap gets a 📸 reaction', () => {
  test('with the tap wamid → 📸, no "send the next photo" text; the session is re-anchored', async () => {
    const m = load();
    sessionRow = onPhotoStep(1);
    await m.addAnother.handleAddAnotherPhotoTap({ sessionId: SID, from: FROM, user: USER, messageId: WAMID });
    expect(sent).toEqual([{ kind: 'reaction', to: FROM, id: WAMID, emoji: '📸' }]);
    expect(sessionRow.status).toBe('awaiting_classroom_photo');
  });

  test('FALLBACK — the reaction did not go out → the old text', async () => {
    const m = load();
    require('../../bot/shared/services/whatsapp.service').sendReaction.mockResolvedValueOnce(false);
    sessionRow = onPhotoStep(1);
    await m.addAnother.handleAddAnotherPhotoTap({ sessionId: SID, from: FROM, user: USER, messageId: WAMID });
    expect(sent.filter((s) => s.kind === 'text').map((s) => s.text))
      .toEqual([m.ux.resolveUx('photoAddAnotherNext', { language: 'en', params: { n: '2', max: '3' } })]);
  });

  test('at the cap: the "maximum" line opens the LP prompt instead of its own text', async () => {
    const m = load();
    sessionRow = onPhotoStep(3);
    await m.addAnother.handleAddAnotherPhotoTap({ sessionId: SID, from: FROM, user: USER, messageId: WAMID });
    const lead = m.ux.resolveUx('photoAddAnotherAtMax', { language: 'en', params: { max: '3' } });
    expect(sent.filter((s) => s.kind === 'text')).toEqual([]);
    const lp = sent.filter((s) => s.kind === 'buttons' || s.kind === 'list');
    expect(lp).toHaveLength(1);
    expect(lp[0].body.startsWith(`${lead}\n\n`)).toBe(true);
  });
});

describe('N2-C10 — the prior-commitment reminder opens the photo offer', () => {
  test('buildPhotoPromptWithLead merges a reminder that fits, and refuses one that would pass 1,024', () => {
    const m = load();
    const offer = m.ux.resolveUx('coachingPhotoOffer', { language: 'en' });
    const merged = m.prompt.buildPhotoPromptWithLead(SID, 'en', '💡 Quick reminder: try wait time.');
    expect(merged.leadMerged).toBe(true);
    expect(merged.prompt.body).toBe(`💡 Quick reminder: try wait time.\n\n${offer}`);
    const tooLong = m.prompt.buildPhotoPromptWithLead(SID, 'en', `💡 ${'x'.repeat(1000)}`);
    expect(tooLong.leadMerged).toBe(false);
    expect(tooLong.prompt.body).toBe(offer);
  });
});
