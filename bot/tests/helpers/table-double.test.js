'use strict';
/**
 * The shared table double answers as PostgREST would: every filter applies with SQL NULL rules, an unknown filter
 * throws, and a write answers the rows it wrote.
 */
const { tableDouble } = require('./table-double');

const kids = () => ({
  students: [
    { id: 's1', student_name: 'Ayla Testwala', grade: 4, list_id: 'l1', status: 'active', joined: '2026-10-01' },
    { id: 's2', student_name: 'Bilal Testwala', grade: 5, list_id: null, status: 'left', joined: '2026-10-03' },
    { id: 's3', student_name: 'Cora Testwala', grade: 6, list_id: 'l2', status: null, joined: '2026-10-05' },
    { id: 's4', student_name: 'dina testwala', grade: null, list_id: 'l1', status: 'active', joined: null },
  ],
});
const ids = (r) => (r.data || []).map((x) => x.id).sort();

describe('table double: filters', () => {
  let db;
  beforeEach(() => { db = tableDouble(kids()); });

  test('eq / neq — neq never returns a NULL cell (NULL <> x is not true)', async () => {
    expect(ids(await db.from('students').select('*').eq('status', 'active'))).toEqual(['s1', 's4']);
    expect(ids(await db.from('students').select('*').neq('status', 'active'))).toEqual(['s2']);
    expect(ids(await db.from('students').select('*').eq('grade', '4'))).toEqual(['s1']);
  });

  test('is null / not is null are the only tests that see NULL', async () => {
    expect(ids(await db.from('students').select('*').is('list_id', null))).toEqual(['s2']);
    expect(ids(await db.from('students').select('*').not('list_id', 'is', null))).toEqual(['s1', 's3', 's4']);
    expect(ids(await db.from('students').select('*').eq('list_id', null))).toEqual([]);
  });

  test('not over a comparison still drops NULL cells', async () => {
    expect(ids(await db.from('students').select('*').not('status', 'eq', 'active'))).toEqual(['s2']);
    expect(ids(await db.from('students').select('*').not('list_id', 'in', '(l1)'))).toEqual(['s3']);
  });

  test('in never matches a NULL cell', async () => {
    expect(ids(await db.from('students').select('*').in('list_id', ['l1', null]))).toEqual(['s1', 's4']);
  });

  test('gt / gte / lt / lte: numbers as numbers, text as text, NULL never', async () => {
    expect(ids(await db.from('students').select('*').gt('grade', 4))).toEqual(['s2', 's3']);
    expect(ids(await db.from('students').select('*').gte('grade', 5))).toEqual(['s2', 's3']);
    expect(ids(await db.from('students').select('*').lt('grade', 6))).toEqual(['s1', 's2']);
    expect(ids(await db.from('students').select('*').lte('grade', '10'))).toEqual(['s1', 's2', 's3']);
    expect(ids(await db.from('students').select('*').gte('joined', '2026-10-03'))).toEqual(['s2', 's3']);
    expect(ids(await db.from('students').select('*').lt('joined', '2026-10-03'))).toEqual(['s1']);
  });

  test('like is case-sensitive, ilike is not; % and _ are wildcards; NULL never', async () => {
    expect(ids(await db.from('students').select('*').like('student_name', '%Testwala'))).toEqual(['s1', 's2', 's3']);
    expect(ids(await db.from('students').select('*').ilike('student_name', '%testwala'))).toEqual(['s1', 's2', 's3', 's4']);
    expect(ids(await db.from('students').select('*').like('student_name', '_ora%'))).toEqual(['s3']);
    expect(ids(await db.from('students').select('*').ilike('status', '%'))).toEqual(['s1', 's2', 's4']);
  });

  test('or(): is / eq / neq / gt / gte / lt / lte terms, any one matching', async () => {
    expect(ids(await db.from('students').select('*').or('status.is.null,status.neq.active'))).toEqual(['s2', 's3']);
    expect(ids(await db.from('students').select('*').or('grade.gte.6,grade.lt.5'))).toEqual(['s1', 's3']);
    expect(ids(await db.from('students').select('*').or('grade.gt.5,grade.lte.4,id.eq.s2'))).toEqual(['s1', 's2', 's3']);
    expect(ids(await db.from('students').select('*').or('list_id.not.is.null').eq('status', 'active'))).toEqual(['s1', 's4']);
    expect(ids(await db.from('students').select('*').or('id.in.(s1,s3)'))).toEqual(['s1', 's3']);
  });

  test('a filter it does not implement throws — never passes rows through', () => {
    for (const m of ['contains', 'containedBy', 'filter', 'textSearch', 'overlaps']) {
      expect(() => db.from('students').select('*')[m]('x', 'y')).toThrow(`table-double: unsupported ${m}`);
    }
    expect(() => db.from('students').select('*').not('x', 'cs', '{1}')).toThrow('table-double: unsupported not cs');
    expect(() => db.from('students').select('*').or('x.cs.{1}')).toThrow('table-double: unsupported');
    expect(() => db.from('students').select('*').or('and(a.eq.1,b.eq.2)')).toThrow('table-double: unsupported');
  });
});

describe('table double: shape of the answer', () => {
  let db;
  beforeEach(() => { db = tableDouble(kids()); });

  test('order (several, ascending flag, NULLs last ascending / first descending), limit, range', async () => {
    const asc = await db.from('students').select('*').order('grade');
    expect(asc.data.map((r) => r.id)).toEqual(['s1', 's2', 's3', 's4']);
    const desc = await db.from('students').select('*').order('grade', { ascending: false });
    expect(desc.data.map((r) => r.id)).toEqual(['s4', 's3', 's2', 's1']);
    const two = await db.from('students').select('*').order('list_id').order('joined', { ascending: false }).limit(3);
    expect(two.data.map((r) => r.id)).toEqual(['s4', 's1', 's3']); // joined desc: the NULL first
    const page = await db.from('students').select('*').order('id').range(1, 2);
    expect(page.data.map((r) => r.id)).toEqual(['s2', 's3']);
  });

  test('count exact + head: the count, no rows', async () => {
    expect(await db.from('students').select('*', { count: 'exact', head: true }).eq('list_id', 'l1'))
      .toEqual({ data: null, count: 2, error: null });
    const counted = await db.from('students').select('*', { count: 'exact' }).order('id').limit(1);
    expect(counted.count).toBe(4);
    expect(counted.data).toHaveLength(1);
  });

  test('single: one row; zero or many is PGRST116. maybeSingle: zero is null with no error', async () => {
    expect((await db.from('students').select('*').eq('id', 's1').single()).data.student_name).toBe('Ayla Testwala');
    expect(await db.from('students').select('*').eq('id', 'nope').single()).toMatchObject({ data: null, error: { code: 'PGRST116' } });
    expect(await db.from('students').select('*').eq('list_id', 'l1').single()).toMatchObject({ data: null, error: { code: 'PGRST116' } });
    expect(await db.from('students').select('*').eq('id', 'nope').maybeSingle()).toMatchObject({ data: null, error: null });
  });

  test('reads come back as copies: changing one does not change the table', async () => {
    const { data } = await db.from('students').select('*').eq('id', 's1').single();
    data.status = 'changed';
    expect(db.tables.students[0].status).toBe('active');
  });
});

describe('table double: writes', () => {
  let db;
  beforeEach(() => { db = tableDouble(kids()); });

  test('insert().select().single() answers the row with a generated id, and the table holds it', async () => {
    const r = await db.from('students').insert({ student_name: 'Esa Testwala', list_id: 'l2' }).select().single();
    expect(r.error).toBeNull();
    expect(r.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(r.data.student_name).toBe('Esa Testwala');
    expect(db.tables.students.find((x) => x.id === r.data.id)).toBeTruthy();
  });

  test('insert keeps a given id; many rows answer many; without select() data is null', async () => {
    const many = await db.from('students').insert([{ id: 'n1' }, { id: 'n2' }]).select('id');
    expect(ids(many)).toEqual(['n1', 'n2']);
    expect(await db.from('students').insert({ id: 'n3' })).toEqual({ data: null, error: null, count: null });
    expect(db.tables.students).toHaveLength(7);
    const fresh = tableDouble();
    await fresh.from('quizzes').insert({ topic: 'Decimals' });
    expect(fresh.tables.quizzes).toHaveLength(1);
  });

  test('upsert merges on the conflict key, inserts otherwise', async () => {
    const r = await db.from('students').upsert([{ id: 's1', status: 'left' }, { id: 's9', status: 'active' }]).select();
    expect(ids(r)).toEqual(['s1', 's9']);
    expect(db.tables.students.find((x) => x.id === 's1')).toMatchObject({ student_name: 'Ayla Testwala', status: 'left' });
    await db.from('students').upsert({ student_name: 'Ayla Testwala', grade: 7 }, { onConflict: 'student_name' });
    expect(db.tables.students.find((x) => x.id === 's1').grade).toBe(7);
    await db.from('students').upsert({ id: 's1', grade: 1 }, { ignoreDuplicates: true });
    expect(db.tables.students.find((x) => x.id === 's1').grade).toBe(7);
  });

  test('update merges into the matching rows only and answers them', async () => {
    const r = await db.from('students').update({ status: 'moved' }).eq('list_id', 'l1').select('id');
    expect(ids(r)).toEqual(['s1', 's4']);
    expect(db.tables.students.map((x) => x.status)).toEqual(['moved', 'left', null, 'moved']);
  });

  test('delete removes the matching rows and answers them', async () => {
    const r = await db.from('students').delete().is('list_id', null).select();
    expect(ids(r)).toEqual(['s2']);
    expect(db.tables.students.map((x) => x.id)).toEqual(['s1', 's3', 's4']);
  });
});

describe('table double: records, failures, rpc', () => {
  test('reads and writes are recorded with their table, op and filters', async () => {
    const db = tableDouble(kids());
    await db.from('students').select('*').eq('list_id', 'l1').gte('grade', 4);
    await db.from('students').update({ status: 'x' }).eq('id', 's1');
    await db.from('quizzes').insert({ topic: 'Decimals' });
    expect(db.reads).toEqual([{ table: 'students', op: 'select', filters: [['eq', 'list_id', 'l1'], ['gte', 'grade', 4]] }]);
    expect(db.writes).toEqual([
      expect.objectContaining({ table: 'students', op: 'update', fields: { status: 'x' }, filters: [['eq', 'id', 's1']] }),
      expect.objectContaining({ table: 'quizzes', op: 'insert', rows: [{ topic: 'Decimals' }], filters: [] }),
    ]);
  });

  test('failTables: any op on that table answers the error; other tables read as before', async () => {
    const db = tableDouble(kids(), { failTables: { students: 'students down' } });
    expect(await db.from('students').select('*')).toEqual({ data: null, count: null, error: { message: 'students down' } });
    expect((await db.from('students').insert({ id: 'x' }).select()).error).toEqual({ message: 'students down' });
    expect(db.tables.students).toHaveLength(4);
    expect((await db.from('quizzes').select('*')).data).toEqual([]);
  });

  test('rpc answers nothing unless scripted', async () => {
    expect(await tableDouble().rpc('anything', {})).toEqual({ data: null, error: null });
    const db = tableDouble({}, { rpcs: { add: ({ a, b }) => ({ data: a + b, error: null }) } });
    expect(await db.rpc('add', { a: 2, b: 3 })).toEqual({ data: 5, error: null });
  });
});
