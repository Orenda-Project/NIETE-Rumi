/**
 * bd-qy7dm — "Remove a school" did nothing on production (Waheed, RM, 19 Aug:
 * "the deleted school is still there even after clicking the remove a school
 * option"). Adding worked; removing looked like a no-op.
 *
 * What was ruled OUT first, against PRODUCTION, so nobody re-chases them:
 *   · the DELETE itself — planted a row and deleted it: gone.
 *   · the ownership SELECT with a colon in school_ext_id ("niete:613") — returns
 *     the row, url-encoded or not.
 *   · removeSchoolForCoach — run against the prod DB: removes cleanly.
 *   · the `manage` and `remove_school` steps — run against the prod DB: return
 *     MANAGE_SCHOOLS then "School removed", and the row is genuinely gone.
 *   · RLS — the bot holds the service-role key.
 *   · OBSERVE_SCHEDULING_UI — 'true' on both prod services; the menu does serve
 *     "Add or remove a school".
 *
 * What was actually wrong: tapping "Remove a school" on the loop screen COMPLETES
 * the Flow and reopens it on MANAGE_SCHOOLS in navigate mode. That screen
 * DECLARES options of {id,title,description,metadata}, and navigate mode has no
 * endpoint round-trip to fill them — we send the data ourselves. We were sending
 * {id,title} only. A declared key the payload omits fails the screen, which is
 * the same payload-schema-error class that took scheduling down on 17 Aug — so
 * the coach tapped, nothing opened, and the school was still there.
 *
 * Second defect in the same call: both deletes ignored `error` and the function
 * returned ok:true unconditionally, so a blocked delete would still print
 * "Removed". That is what made this invisible instead of loud.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const flow = require('../../../docs/flows/observe-visit-v2.json');
const src = require('fs').readFileSync(
  require('path').join(__dirname, '../../shared/handlers/flow-response.handler.js'), 'utf8');

describe('bd-qy7dm · reopening a screen must satisfy the keys it declares', () => {
  const declared = (sid) => {
    const s = flow.screens.find((x) => x.id === sid);
    return Object.keys(s.data.options.items.properties);
  };

  it('MANAGE_SCHOOLS still declares all four option keys', () => {
    expect(declared('MANAGE_SCHOOLS').sort()).toEqual(['description', 'id', 'metadata', 'title']);
  });

  it('the reopen builds every declared key, not just id and title', () => {
    const block = src.slice(src.indexOf("target.screen === 'MANAGE_SCHOOLS'"), src.indexOf("target.screen === 'MANAGE_SCHOOLS'") + 1600);
    for (const k of declared('MANAGE_SCHOOLS')) {
      expect(block).toMatch(new RegExp(`\\b${k}\\s*:`));
    }
  });

  it('a coach is never stranded when the reopen fails — it falls back to the menu', () => {
    const fn = src.slice(src.indexOf('async function _continueObserveLoop'));
    expect(fn.slice(0, 1800)).toMatch(/reopenObserveVisitFlow\(user, phoneNumber, null\)/);
  });
});

describe('bd-qy7dm · a removal that removes nothing must not report success', () => {
  let deleted, failDelete;
  const mockDb = () => {
    deleted = []; 
    const q = (table) => {
      const filters = {};
      const self = {
        select: () => self, limit: () => self,
        eq: (c, v) => { filters[c] = v; return self; },
        delete: () => { deleted.push(table); return { eq: () => ({ eq: () => Promise.resolve({ error: failDelete ? { message: 'blocked' } : null, count: failDelete ? 0 : 3 }) }) }; },
        then: (res) => res({ data: table === 'leader_schools' ? [{ school_name: 'IMCB, I-8/3' }] : [], error: null }),
      };
      return self;
    };
    return { from: q };
  };
  beforeEach(() => { jest.resetModules(); jest.doMock('../../shared/config/supabase', () => mockDb(), { virtual: true }); });
  afterEach(() => jest.dontMock('../../shared/config/supabase'));

  it('reports success when the delete really happened', async () => {
    failDelete = false;
    const svc = require('../../shared/services/observe/observe-school-admin.service');
    const res = await svc.removeSchoolForCoach('coach-1', 'niete:613');
    expect(res.ok).toBe(true);
    expect(deleted).toEqual(['leader_teachers', 'leader_schools']);
  });

  it('reports FAILURE when the delete was blocked — never a false "Removed"', async () => {
    failDelete = true;
    const svc = require('../../shared/services/observe/observe-school-admin.service');
    const res = await svc.removeSchoolForCoach('coach-1', 'niete:613');
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
  });
});
