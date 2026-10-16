/**
 * The web-quiz test double answers NULL the way PostgREST does: `neq` never returns a NULL cell (SQL `<>`), so a
 * product query that writes `.neq()` on a nullable column cannot pass its tests while the real read drops every
 * NULL row.
 */
const { makeFake } = require('./fake-supabase');

test('neq drops a NULL cell; is(null) is the only way to ask for one', async () => {
  const fake = makeFake({ quiz_share_codes: [{ id: 'a', parent_share_code_id: null }, { id: 'b', parent_share_code_id: 'r' }, { id: 'c', parent_share_code_id: 'x' }] });
  const { data: neq } = await fake.from('quiz_share_codes').select('id').neq('parent_share_code_id', 'r');
  expect(neq.map((r) => r.id)).toEqual(['c']);
  const { data: nul } = await fake.from('quiz_share_codes').select('id').is('parent_share_code_id', null);
  expect(nul.map((r) => r.id)).toEqual(['a']);
});
