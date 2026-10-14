'use strict';
/**
 * v10 coaching test (bd-v0toag.18): the report page's HTML, pure. Escaping, https-only links,
 * the PKT date, the move fallback, Urdu right-to-left, and the bilingual message pages.
 */
const { renderReportPage, renderMessagePage, pktDate, COPY } = require('../../dashboard/services/coaching-report-page');

const SESSION = {
  created_at: '2026-10-19T20:30:00Z',
  analysis_data: { subject: 'English', topic: 'Vowels "a" & \'e\'' },
  prioritized_action: { action: 'Ask two children by name.', thing_to_try: { text: 'Pairs <b>read</b> aloud.' } },
  report_pdf_url: 'https://r2.example.com/r.PNG?v=2',
  voice_debrief_url: 'http://r2.example.com/v.ogg',
};
const ENV = { WHATSAPP_BOT_NUMBER: '', REFERRAL_BOT_NUMBER: '+1 (555) 010-9999' };

test('date is the PKT day: 20:30Z on the 19th is the 20th in Pakistan', () => {
  expect(pktDate('2026-10-19T20:30:00Z')).toBe('20 Oct 2026');
  expect(pktDate('2026-10-19T18:59:59Z')).toBe('19 Oct 2026');
  expect(pktDate('nonsense')).toBe('');
  expect(pktDate(null)).toBe('');
});

test('every value is escaped, quotes included', () => {
  const html = renderReportPage({ language: 'en', session: SESSION, quizMessage: null }, ENV);
  expect(html).toContain('Pairs &lt;b&gt;read&lt;/b&gt; aloud.');
  expect(html).toContain('Vowels &quot;a&quot; &amp; &#39;e&#39;');
  expect(html).not.toContain('<b>read</b>');
});

test('thing to try wins over the action; the action is the fallback; neither: no try section', () => {
  expect(renderReportPage({ session: SESSION }, ENV)).not.toContain('Ask two children');
  const fallback = renderReportPage({ session: { prioritized_action: { action: 'Ask two children by name.' } } }, ENV);
  expect(fallback).toContain('Ask two children by name.');
  expect(renderReportPage({ session: {} }, ENV)).not.toContain(COPY.en.tryNext);
});

test('png with a query string is an image; an http voice note is dropped', () => {
  const html = renderReportPage({ session: SESSION }, ENV);
  expect(html).toContain('<img src="https://r2.example.com/r.PNG?v=2"');
  expect(html).not.toContain('<audio');
});

test('plan link falls back to the referral number, digits only', () => {
  const html = renderReportPage({ session: SESSION }, ENV);
  expect(html).toContain('https://wa.me/15550109999?text=lesson%20plan');
});

test('a blank quiz message adds no quiz section', () => {
  expect(renderReportPage({ session: SESSION, quizMessage: '   ' }, ENV)).not.toContain(COPY.en.quiz);
});

test('no view at all still renders an English page', () => {
  const html = renderReportPage(undefined, {});
  expect(html).toContain('lang="en" dir="ltr"');
  expect(html).toContain(COPY.en.title);
});

test('unknown language is English; Urdu is right to left with Urdu copy', () => {
  expect(renderReportPage({ language: 'fr', session: {} }, {})).toContain('lang="en" dir="ltr"');
  const ur = renderReportPage({ language: 'ur', session: SESSION }, ENV);
  expect(ur).toContain('lang="ur" dir="rtl"');
  expect(ur).toContain(COPY.ur.tryNext);
  expect(ur).toContain(COPY.ur.title);
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
