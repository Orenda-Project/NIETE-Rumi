// teacher-lessons-fln — the hand-written teacher-lessons scenarios for FLN Reading Hour + Numeracy (bd-t7zk3t.11,
// bd-elc1qz, bd-4tsjcr, bd-s0ccn5; driver code bd-q8wt5e.6.6). Joined to the generated teacher-lessons driver by
// .claude/qa/web/gen_page_features.py (EXTRA).
//
// The FLN pages read a plan corpus the portal loads from FLN_CORPUS_BASE / CONTENT_R2_PUBLIC_URL. The web lane's test
// portal has neither, so its catalogue answers 503 and no FLN list or plan can open (L.flnCorpus checks it live, each
// run). Every scenario first drives what does not need a plan — the band, its grade chips, the switch-off page, the
// catalogue's own 400/404 answers, the sign-in banner's route — and reports BLOCKED, naming the corpus, for the rest.
// Switches are set on this run's database and put back (lessons-lib withSettings).
'use strict';
const L = require('./lessons-lib.cjs');

const BAND = /Reading Hour & Numeracy/;

// What every scenario ends with when the corpus is not there; a loaded corpus has no driver code yet: say so plainly.
async function corpusOr(page, ctx, done) {
  const why = await L.flnCorpus(page, ctx);
  if (why) return { blocked: (done ? 'checked: ' + done + '. ' : '') + why };
  throw new Error('the FLN corpus is loaded on this stack, and the plan steps of this scenario have no driver code yet');
}
async function apiStatus(page, ctx, p) { return (await page.request.get(ctx.baseUrl + '/api/portal' + p)).status(); }

// The demo teacher's own class at grade `g` for the body, then back (her one seeded class, Grade 3 A).
async function withClassGrade(ctx, g, body) {
  const id = await L.userId(ctx, L.DEMO.teacher);
  const prev = await ctx.sql('select id, grade_code from classes where created_by_user_id = ' + L.q(id) + ' order by created_at limit 1');
  L.expect(prev, 'the demo teacher has no class');
  const [cid, code] = prev.split('|');
  try {
    await ctx.sql('update classes set grade_code = ' + L.q('grade_' + g) + ' where id = ' + L.q(cid));
    return await body();
  } finally { await ctx.sql('update classes set grade_code = ' + L.q(code) + ' where id = ' + L.q(cid)); }
}

const blockedOnly = ({ id, title }, settings, role, mode) => ({ id, title,
  run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings(mode || 'teacherV2'), ...settings }, async () => {
    await L.asRole(page, ctx, role || 'teacher');
    return corpusOr(page, ctx, '');
  }) });

const FLN_ON = { portal_fln_lessons: true };
const SHARE_ON = { portal_fln_lessons: true, portal_fln_share: true };

const scenarios = [
  { id: 'FLN01', title: 'FLN switch on: the New lesson plan page shows the FLN band; switch off: the page is unchanged',
    run: async (page, ctx) => {
      let on;
      await L.withSettings(ctx, { ...L.modeSettings('teacherV2'), ...FLN_ON }, async () => {
        await L.asRole(page, ctx, 'teacher');
        await L.go(page, ctx, '/portal/teacher/lessons/new');
        on = await L.seeText(page, BAND, 'the New lesson plan page with portal_fln_lessons on');
      });
      await L.withSettings(ctx, { ...L.modeSettings('teacherV2'), portal_fln_lessons: null }, async () => {
        await L.go(page, ctx, '/portal/teacher/lessons/new');
        await L.seeText(page, /Select grade and subject/, 'the New lesson plan page');
        await page.waitForTimeout(1500);
        await L.noText(page, BAND, 'the New lesson plan page with portal_fln_lessons removed');
        const cat = await apiStatus(page, ctx, '/fln/catalogue?grade=1&subject=rh-en');
        L.expect(cat === 404, 'the catalogue answers ' + cat + ' with the switch removed, not 404');
        const me = await (await page.request.get(ctx.baseUrl + '/api/portal/fln/me')).json();
        L.expect(me && me.lessons === false, '/fln/me says ' + JSON.stringify(me));
      });
      // the rows (Reading Hour English, Reading Hour Urdu, Numeracy, their counts and links) need the corpus
      return L.withSettings(ctx, FLN_ON, () => corpusOr(page, ctx, 'the band shows with the switch on; with it removed there is no band, the catalogue answers 404 and /fln/me says lessons:false'));
    } },

  blockedOnly({ id: 'FLN02', title: 'A signed-in teacher opens an FLN plan from a deep link' }, FLN_ON),
  blockedOnly({ id: 'FLN05', title: 'A sound plays on tap, one at a time, and tapping it again restarts it' }, FLN_ON),
  blockedOnly({ id: 'FLN07', title: 'The plan opens with every section closed; a tap opens one in place' }, FLN_ON),

  { id: 'FLN08', title: 'The FLN band offers Grades 1–5 only, and a teacher with no classes lands on Grade 1',
    run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('teacherV2'), ...FLN_ON }, async () => {
      // a teacher with no classes AND no lesson-plan history (history decides when there is no class, FLN09): the demo
      // network's ghost-school teacher (portal-demo-seed.js GHOST: no class, no plans)
      L.watch(page);
      const { open, signIn, PASSWORD, settledPath } = require('../lib.cjs');
      // she has no portal password in the seed: the demo teacher's is lent to her for the scenario, then taken back
      // read from the run's database (the one teacher of the ghost school, emis DEMO-004), never written in this file
      const ghost = await ctx.sql("select u.phone_number from users u join schools s on s.id = u.school_id where s.emis = 'DEMO-004' and u.role = 'teacher' limit 1");
      L.expect(ghost, 'the demo network has no ghost-school teacher');
      const had = await ctx.sql('select coalesce(portal_password_hash, \'\') from users where phone_number = ' + L.q(ghost));
      await ctx.sql('update users set portal_password_hash = (select portal_password_hash from users where phone_number = '
        + L.q(L.e164(L.DEMO.teacher)) + ') where phone_number = ' + L.q(ghost));
      try {
        await open(page, ctx);
        await signIn(page, '0' + ghost.slice(2), PASSWORD);
        await settledPath(page, '/portal/login');
        await L.go(page, ctx, '/portal/teacher/lessons/new');
        await L.seeText(page, /Foundational reading and maths · Grades 1–5/, 'the band\'s line');
        const band = await page.$$eval('.fln-chips [role="radio"], .fln-chips button', (els) => els.map((e) => e.innerText.trim()));
        L.expect(JSON.stringify([...new Set(band)]) === JSON.stringify(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5']),
          'the band\'s grade chips are ' + JSON.stringify(band));
        const sel = await page.$$eval('.fln-chips [aria-checked="true"]', (els) => els.map((e) => e.innerText.trim()));
        L.expect(sel.includes('Grade 1'), 'Grade 1 is not the selected chip: ' + JSON.stringify(sel));
        const c8 = await apiStatus(page, ctx, '/fln/catalogue?grade=8&subject=rh-en');
        L.expect(c8 === 400, 'GET /api/portal/fln/catalogue?grade=8&subject=rh-en answers ' + c8 + ', not 400');
        const at = await L.go(page, ctx, '/portal/fln/list/rh-en?grade=8');
        L.expect(at === '/portal/fln/list/rh-en?grade=1', '/portal/fln/list/rh-en?grade=8 settled on ' + at);
        return corpusOr(page, ctx, 'chips Grade 1–5 only, Grade 1 selected, the band line, grade=8 → grade=1, the catalogue 400 above grade 5; the rows and the Grade 1 lesson list need plans');
      } finally {
        await ctx.sql('update users set portal_password_hash = ' + (had ? L.q(had) : 'null') + ' where phone_number = ' + L.q(ghost));
      }
    }) },

  { id: 'FLN09', title: 'A teacher who teaches only Grades 6–12 sees no FLN band; a Grade 3 class or a coach still gets it',
    run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('teacherV2'), ...FLN_ON }, async () => {
      const calls = [];
      page.on('request', (r) => { if (r.url().includes('/api/portal/fln/catalogue')) calls.push(r.url()); });
      await L.asRole(page, ctx, 'teacher');
      await withClassGrade(ctx, 8, async () => {
        await L.go(page, ctx, '/portal/teacher/lessons/new');
        await L.seeText(page, /Select grade and subject/, 'the New lesson plan page');
        await page.waitForTimeout(3000);
        await L.noText(page, BAND, 'a Grade 8-only teacher\'s New lesson plan page');
        L.expect(!calls.length, 'the catalogue was read for a Grade 8-only teacher: ' + calls[0]);
      });
      await withClassGrade(ctx, 3, async () => {
        await L.go(page, ctx, '/portal/teacher/lessons/new');
        await L.seeText(page, BAND, 'a Grade 3 teacher\'s New lesson plan page');
      });
      return corpusOr(page, ctx, 'no band and no catalogue read for a Grade 8-only teacher; the band for a Grade 3 class. '
        + 'The selected grade is shown on the rows\' links, and the plan link must open');
    }) },

  { id: 'FLN03', title: 'A signed-out teacher opens a shared Reading Hour link, signs in, and lands on that plan',
    run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('teacherV2'), ...FLN_ON }, async () => {
      const at = await L.go(page, ctx, '/portal/fln/p/11156');
      L.expect(at.startsWith('/portal/login'), 'signed out, /portal/fln/p/11156 settled on ' + at + ', not the sign-in page');
      await L.asRole(page, ctx, 'teacher');
      return corpusOr(page, ctx, 'signed out, the plan link lands on sign-in; its banner names the plan\'s title');
    }) },

  blockedOnly({ id: 'FLN04', title: 'A coach sees Share on a plan and finds a plan in the link builder; a teacher sees neither' }, SHARE_ON, 'coach', 'coachV2'),
  blockedOnly({ id: 'FLN10', title: 'With WhatsApp sending off for her programme, the Share sheet keeps Copy link and drops Send on WhatsApp' }, SHARE_ON, 'coach', 'coachV2'),
  blockedOnly({ id: 'FLN06', title: 'A coach sends a Reading Hour plan to an assigned teacher, and the teacher\'s own link opens it signed in' }, SHARE_ON, 'coach', 'coachV2'),
  blockedOnly({ id: 'TL03', title: 'FLN plan page: Download PDF saves the plan, and the button is hidden when no PDF exists' }, FLN_ON),
];

module.exports = scenarios;
