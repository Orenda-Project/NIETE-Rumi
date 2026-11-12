'use strict';
/**
 * bd-644bcx — the papers "Send on WhatsApp" button never sent a paper.
 *
 * The app names a paper by its assessment_papers.id: My papers lists `paper_id: latest.id` and the request page reads
 * `paperId: latest.id` (assessment-browse.service). The share's paper resolver looked that id up as an
 * assessment_requests.id, found nothing, answered not_found (HTTP 404), and the app showed the locked "Not available yet"
 * face on every tap. Prod niete-logs: 0 share_send events for kind=paper since the button shipped.
 *
 * These tests give the resolver a table-aware fake database, so an id of the wrong table finds nothing, as on prod.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendTemplate: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/assessment-browse.service', () => ({ listChapters: jest.fn(async () => []) }));

const Share = require('../../bot/shared/services/share-send.service');

const REQ = { id: 'req-1', user_id: 'u1', grade_code: 'grade_4', subject_code: 'science', chapter_number: null, question_count: 15 };
const OTHER_REQ = { id: 'req-2', user_id: 'u2', grade_code: 'grade_5', subject_code: 'english', chapter_number: null, question_count: 10 };
// Two versions of one request (the generated paper and her edit), and someone else's paper.
const PAPERS = [
  { id: 'pap-gen', request_id: 'req-1', status: 'ready', file_r2_key: 'papers/gen.pdf', question_count: 15 },
  { id: 'pap-edit', request_id: 'req-1', status: 'ready', file_r2_key: 'papers/edit.pdf', question_count: 12 },
  { id: 'pap-busy', request_id: 'req-1', status: 'generating', file_r2_key: null, question_count: null },
  { id: 'pap-other', request_id: 'req-2', status: 'ready', file_r2_key: 'papers/other.pdf', question_count: 10 },
];
const REQUESTS = [REQ, OTHER_REQ];

/** Rows as PostgREST returns them: each table with its embedded parent/children. */
const TABLES = {
  assessment_papers: () => PAPERS.map((p) => ({ ...p, assessment_requests: REQUESTS.find((r) => r.id === p.request_id) })),
  assessment_requests: () => REQUESTS.map((r) => ({ ...r, assessment_papers: PAPERS.filter((p) => p.request_id === r.id) })),
};

/** A dotted filter on an embedded resource: an embedded list keeps only its matching rows (an !inner join). */
function keep(row, col, val) {
  const [head, ...rest] = col.split('.');
  if (!rest.length) return row[head] === val ? row : null;
  const sub = row[head];
  if (Array.isArray(sub)) {
    const hits = sub.filter((s) => keep(s, rest.join('.'), val));
    return hits.length ? { ...row, [head]: hits } : null;
  }
  return sub && keep(sub, rest.join('.'), val) ? row : null;
}

function fakeDb() {
  return {
    from(table) {
      let rows = TABLES[table] ? TABLES[table]() : [];
      const c = {
        select: () => c, limit: () => c, order: () => c,
        eq: (col, val) => { rows = rows.map((r) => keep(r, col, val)).filter(Boolean); return c; },
        maybeSingle: async () => ({ data: rows[0] || null, error: null }),
        then: (res) => Promise.resolve({ data: rows, error: null }).then(res),
      };
      return c;
    },
  };
}

const presign = async (k) => `https://signed.example/${k}`;

describe('bd-644bcx: the paper share finds the paper by the id the app sends (assessment_papers.id)', () => {
  it('her paper, by its paper id, resolves to that paper and its own PDF', async () => {
    const item = await Share.itemResolvers(fakeDb(), { presign }).paper('u1', 'pap-gen');
    expect(item).toMatchObject({
      kind: 'paper', itemRef: 'paper:pap-gen', grade: 4, subject: 'Science', questions: 15,
      pdfUrl: 'https://signed.example/papers/gen.pdf',
    });
  });

  it('an edited version sends ITS file and count, not another version of the same request', async () => {
    const item = await Share.itemResolvers(fakeDb(), { presign }).paper('u1', 'pap-edit');
    expect(item).toMatchObject({ itemRef: 'paper:pap-edit', questions: 12, pdfUrl: 'https://signed.example/papers/edit.pdf' });
  });

  it("someone else's paper is not hers: not found", async () => {
    expect(await Share.itemResolvers(fakeDb(), { presign }).paper('u1', 'pap-other')).toBeNull();
  });

  it('a version still generating is not sendable: not found', async () => {
    expect(await Share.itemResolvers(fakeDb(), { presign }).paper('u1', 'pap-busy')).toBeNull();
  });

  it('end to end: a tap on her paper sends ONE share_paper_v1 with that PDF in the header', async () => {
    const calls = [];
    const resolvers = Share.itemResolvers(fakeDb(), { presign });
    const out = await Share.sendShare({ userId: 'u1', kind: 'paper', id: 'pap-edit' }, {
      templateName: (kind) => (kind === 'paper' ? 'share_paper_v1' : null),
      user: async () => ({ id: 'u1', phone_number: '923001112222', preferred_language: 'en' }),
      item: (kind, id, userId) => resolvers[kind](userId, id),
      now: () => new Date('2026-11-12T08:00:00Z'),
      sendTemplate: async (to, name, lang, components) => { calls.push({ to, name, lang, components }); return true; },
    });
    expect(out).toEqual({ status: 'sent', at: '2026-11-12T08:00:00.000Z' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: '923001112222', name: 'share_paper_v1', lang: 'en' });
    expect(calls[0].components[0].parameters[0].document.link).toBe('https://signed.example/papers/edit.pdf');
  });
});
