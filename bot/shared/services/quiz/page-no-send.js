/**
 * The generate job's phone for a quiz made in the report's page (report-page-quiz.js): never a number, so no step
 * sends it anything. Its own file so the offer, generate and hand-off services can read it without requiring
 * report-page-quiz.js, which requires the offer service (no require cycle; tests/setup/circular-deps.test.js).
 */
module.exports = { PAGE_NO_SEND: 'report_page:no_send' };
