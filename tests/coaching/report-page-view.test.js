'use strict';
/**
 * v10 coaching test (bd-v0toag.18, reshaped to Amena's ICT-3 template in bd-v0toag.55): the report page's
 * HTML, pure. The card screen and the detailed screen, escaping, https-only links, Urdu right to left,
 * and the bilingual message pages.
 */
const { renderReportPage, renderDetailPage, renderMessagePage, pktDate, COPY } = require('../../dashboard/services/coaching-report-page');
const { buildReportView } = require('../../dashboard/services/coaching-report-view');

const SESSION = {
  created_at: '2026-10-19T20:30:00Z',
  analysis_data: {
    grade: 1, subject: 'English', topic: 'Vowels "a" & \'e\'',
    scores: { overall_percentage: 61, overall_marks: 90, overall_max_marks: 148 },
    strengths: ['Clear <i>board</i> work'],
    domains: {
      lesson_plan_fidelity: { domain_score: 26, domain_max: 40 },
      student_engagement: { assessed: false },
    },
    report_narrative: { domain_whys: { lesson_plan_fidelity: 'Order kept; <game> not played.' } },
    lp_fidelity: { status: 'ok', moves: [{ move_id: 'm6', phase: 'guided', text: 'x' }] },
  },
  prioritized_action: { action: 'Ask two children by name.', thing_to_try: { move_id: 'm6', text: 'Pairs <b>read</b> aloud.', tag: 'C9' } },
  report_pdf_url: 'https://r2.example.com/r.PNG?v=2',
  voice_debrief_url: 'http://r2.example.com/v.ogg',
};
const TREND = [{ pct: 40 }, { pct: 72 }, { pct: 61 }];
const ENV = { WHATSAPP_BOT_NUMBER: '', REFERRAL_BOT_NUMBER: '+1 (555) 010-9999' };
const LINKS = { detail: '/cr/T/detail', card: '/cr/T' };
const v = (over = {}) => buildReportView({ session: SESSION, firstName: 'Sadia', language: 'en', trend: TREND, ...over });

test('date is the PKT day: 20:30Z on the 19th is the 20th in Pakistan', () => {
  expect(pktDate('2026-10-19T20:30:00Z')).toBe('20 Oct 2026');
  expect(pktDate('2026-10-19T18:59:59Z')).toBe('19 Oct 2026');
  expect(pktDate('nonsense')).toBe('');
  expect(pktDate(null)).toBe('');
});

test('card: name, grade · subject · topic · date, score, what went well', () => {
  const html = renderReportPage(v(), ENV, LINKS);
  expect(html).toContain('Sadia');
  expect(html).toContain('Grade 1 · English · Vowels &quot;a&quot; &amp; &#39;e&#39; · <bdi>20 Oct 2026</bdi>');
  expect(html).toContain('61%');
  expect(html).toContain(COPY.en.well);
  expect(html).toContain('Clear &lt;i&gt;board&lt;/i&gt; work');
});

test('card: the thing to try, its step chip, why it matters, and that we look for it next time', () => {
  const html = renderReportPage(v(), ENV, LINKS);
  expect(html).toContain(COPY.en.tryh);
  expect(html).toContain('<span class="chip s3">We Do</span>');
  expect(html).toContain('Pairs &lt;b&gt;read&lt;/b&gt; aloud.');
  expect(html).not.toContain('<b>read</b>');
  expect(html).toMatch(/partner/);
  expect(html).toContain(COPY.en.check);
});

test('card: no step known, no chip; no thing at all, no try section', () => {
  const s = { ...SESSION, prioritized_action: { action: 'Ask two children by name.' } };
  const fallback = renderReportPage(v({ session: s }), ENV, LINKS);
  expect(fallback).toContain('Ask two children by name.');
  expect(fallback).not.toContain('class="chip');
  expect(renderReportPage(v({ session: { ...SESSION, prioritized_action: null } }), ENV, LINKS)).not.toContain(COPY.en.tryh);
});

test('card: links to tomorrow\'s lesson on WhatsApp (digits only) and to the detailed screen', () => {
  const html = renderReportPage(v(), ENV, LINKS);
  expect(html).toContain('https://wa.me/15550109999?text=lesson%20plan');
  expect(html).toContain(COPY.en.open);
  expect(html).toContain('href="/cr/T/detail"');
  expect(html).toContain(COPY.en.more);
});

test('card: report image kept (png with a query string), http voice note dropped, quiz with a share link', () => {
  const html = renderReportPage(v({ quizMessage: 'Class 1 quiz' }), ENV, LINKS);
  expect(html).toContain('<img src="https://r2.example.com/r.PNG?v=2"');
  expect(html).not.toContain('<audio');
  expect(html).toContain(`https://wa.me/?text=${encodeURIComponent('Class 1 quiz')}`);
  expect(renderReportPage(v({ quizMessage: '   ' }), ENV, LINKS)).not.toContain(COPY.en.quiz);
});

test('detail: back to the card, marks, each section with its bar colour and why, not assessed shown as such', () => {
  const html = renderDetailPage(v(), LINKS);
  expect(html).toContain('href="/cr/T"');
  expect(html).toContain(COPY.en.back);
  expect(html).toContain('90/148');
  expect(html).toContain(COPY.en.made);
  expect(html).toContain('Lesson Plan Fidelity');
  expect(html).toContain('26/40');
  expect(html).toContain('class="bar amber" style="width:65%"');
  expect(html).toContain('Order kept; &lt;game&gt; not played.');
  expect(html).toContain(COPY.en.notAssessed);
});

test('detail: journey line with first, best and this lesson; one lesson only, no journey', () => {
  const html = renderDetailPage(v(), LINKS);
  expect(html).toContain(COPY.en.journey);
  expect(html).toContain('<svg');
  expect(html).toMatch(/First lesson[^]*40%[^]*Best[^]*72%[^]*This lesson[^]*61%/);
  expect(renderDetailPage(v({ trend: [{ pct: 61 }] }), LINKS)).not.toContain(COPY.en.journey);
});

test('no view at all still renders an English page', () => {
  expect(renderReportPage(undefined, {}, LINKS)).toContain('lang="en" dir="ltr"');
  expect(renderDetailPage(undefined, LINKS)).toContain('lang="en" dir="ltr"');
});

test('Urdu: right to left, Urdu copy, Urdu section names in brackets', () => {
  const ur = v({ language: 'ur' });
  const card = renderReportPage(ur, ENV, LINKS);
  expect(card).toContain('lang="ur" dir="rtl"');
  expect(card).toContain(COPY.ur.tryh);
  expect(card).toContain('جماعت 1');
  expect(renderDetailPage(ur, LINKS)).toContain('(سبق کے منصوبے پر عمل)');
});

test('message pages carry both languages and no data', () => {
  const nf = renderMessagePage('not_found');
  expect(nf).toContain('This link is not complete');
  expect(nf).toContain(COPY.ur.notFoundTitle);
  const err = renderMessagePage('error');
  expect(err).toContain('Something went wrong');
  expect(err).toContain(COPY.ur.errorTitle);
  expect(renderMessagePage('anything')).toContain('This link is not complete');
});

// bd-v0toag.62: the three phone-check findings (v12_iab_check).
test('date sits in <bdi> so an English date reads in order inside Urdu (card and detail)', () => {
  const ur = v({ language: 'ur' });
  expect(renderReportPage(ur, ENV, LINKS)).toMatch(/<bdi>20 Oct 2026<\/bdi>/);
  expect(renderDetailPage(ur, LINKS)).toMatch(/<bdi>20 Oct 2026<\/bdi>/);
});

test('after the coach ask, "Was this useful?" is not asked again', () => {
  const links = { ...LINKS, useful: '/cr/T/useful', coach: '/cr/T/coach' };
  for (const s of ['sent', 'already', 'failed', 'invalid', 'no_coach']) {
    const html = renderReportPage(v(), ENV, links, undefined, s);
    expect(html).not.toMatch(/name="useful"/);
    expect(html).not.toMatch(/<textarea/);
  }
  expect(renderReportPage(v(), ENV, links)).toMatch(/name="useful" value="yes"/);
});

test('Urdu links carry no ‹ › arrow: Nastaliq draws it like a comma (bd-v0toag.62)', () => {
  for (const k of ['open', 'more', 'back']) expect(COPY.ur[k]).not.toMatch(/[‹›]/);
});

// bd-v0toag.66: the coach ask must not promise a visit the coach may not make.
test('after the coach ping is sent, the card says the coach was told and does not ask again (bd-v0toag.38.9)', () => {
  const links = { ...LINKS, coach: '/cr/T/coach' };
  for (const s of ['sent', 'already']) {
    const en = renderReportPage(v(), ENV, links, undefined, s);
    expect(en).toContain('✓ Your coach has been told and will come to see your class.');
    expect(en).not.toContain('Do you agree with this report?');
    expect(renderReportPage(v({ language: 'ur' }), ENV, links, undefined, s))
      .toContain('✓ آپ کے کوچ کو بتا دیا گیا ہے، وہ آ کر آپ کی کلاس دیکھیں گے۔');
  }
  // Without the coach link (A, B, switch off) a stray ?coach= changes nothing.
  expect(renderReportPage(v(), ENV, LINKS, undefined, 'sent')).not.toContain('Your coach has been told');
});
