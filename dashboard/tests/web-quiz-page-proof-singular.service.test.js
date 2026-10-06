/**
 * Web quiz page: the landing's "N children in Islamabad played today" line says "1 child" when the count is
 * one (right after the PKT day rolls over the count is small, so "1 children" was the first thing the morning's
 * children saw). The whole shipped page runs in the shared vm harness; only the boot data is faked.
 */
const { page } = require('./wq-page-harness');

describe('the landing count line, singular and plural', () => {
  test('EN: 1 child / 2 children', () => {
    expect(page({ lang: 'en', live: { ict_today_floor: 1 } }).html()).toMatch(/1 child (in .+ )?played today/);
    expect(page({ lang: 'en', live: { ict_today_floor: 1 } }).html()).not.toContain('1 children');
    expect(page({ lang: 'en', live: { ict_today_floor: 2 } }).html()).toMatch(/2 children (in .+ )?played today/);
  });
  test('UR: 1 بچے نے / 2 بچوں نے', () => {
    expect(page({ lang: 'ur', live: { ict_today_floor: 1 } }).html()).toContain('1 بچے نے کھیلا');
    expect(page({ lang: 'ur', live: { ict_today_floor: 1 } }).html()).not.toContain('1 بچوں');
    expect(page({ lang: 'ur', live: { ict_today_floor: 2 } }).html()).toContain('2 بچوں نے کھیلا');
  });
});
