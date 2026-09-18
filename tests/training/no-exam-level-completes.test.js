/**
 * bd-2503 — a level with NO exam must have a terminal state.
 *
 * Oxbridge level 17 has no grand quiz and no capstone. `maybeIssueQuizScoreCertificate`
 * DOES certify it — for an all_modules vendor with no capstone, finishing every
 * module writes a real `training_certificates` row. But nothing read that row:
 * level state only reached 'certified' via a passed EXAM attempt, and
 * 'ready_for_quiz' fires whenever all courses are done regardless of whether an
 * exam exists.
 *
 * So a teacher at 7/7 was parked in ready_for_quiz permanently, and got two
 * contradictory screens (reported live 2026-08-02):
 *
 *   HOME         "7/7 courses ✓ · Ready for exam"
 *   LEVEL_DETAIL "🎓 No level exam — finish all sessions to complete this level."
 *
 * One promises an exam the other denies, and the second tells her to finish
 * what the line above says is 100% finished. She holds a certificate the
 * product never mentions.
 */
let supabaseFrom, tableStates;

function makeChain(t) {
  const st = tableStates[t] || {};
  const rec = { filters: {}, isCount: false, orderCol: null, orderDir: null };
  const c = {};
  const rows = () => {
    let r = st.rows || [];
    for (const [col, v] of Object.entries(rec.filters)) {
      if (v && typeof v === 'object' && Array.isArray(v.in)) r = r.filter(x => v.in.includes(x[col]));
      else if (!col.includes('.')) r = r.filter(x => x[col] === v || String(x[col]) === String(v));
    }
    return r;
  };
  const one = () => st.error ? { data: null, error: st.error } : (rec.isCount ? { count: rows().length, data: null, error: null } : { data: rows()[0] || null, error: null });
  const many = () => {
    if (st.error) return { data: null, error: st.error };
    if (rec.isCount) return { count: rows().length, data: null, error: null };
    let r = rows();
    if (rec.orderCol) { const d = rec.orderDir === 'asc' ? 1 : -1; r = [...r].sort((a,b)=> a[rec.orderCol]<b[rec.orderCol]?-d:a[rec.orderCol]>b[rec.orderCol]?d:0); }
    return { data: r, error: null };
  };
  c.select = jest.fn((_c,o)=>{ if(o&&o.count==='exact'&&o.head===true) rec.isCount=true; return c; });
  ['eq','neq','gt','gte','lt','lte','like','ilike','is','not'].forEach(m=>{ c[m]=jest.fn((col,v)=>{rec.filters[col]=v;return c;}); });
  c.in = jest.fn((col,v)=>{rec.filters[col]={in:v};return c;});
  c.order = jest.fn((col,o)=>{rec.orderCol=col;rec.orderDir=o&&o.ascending?'asc':'desc';return c;});
  c.limit=jest.fn(()=>c); c.range=jest.fn(()=>c);
  c.insert=jest.fn(()=>c); c.update=jest.fn(()=>c); c.upsert=jest.fn(()=>c);
  c.maybeSingle=jest.fn(async()=>one()); c.single=jest.fn(async()=>one());
  c.then=(res,rej)=>Promise.resolve(many()).then(res,rej);
  return c;
}

const UID='u1', VENDOR='v-ox', LEVEL=17;

/** An all_modules vendor level with NO exam row at all. */
function seed({ allDone = true, certified = false } = {}) {
  tableStates.users={rows:[{id:UID,name: 'A',phone_number:'92300'}]};
  tableStates.teacher_training_assignments={rows:[{user_id:UID,program_id:'p1',is_active:true}]};
  tableStates.training_program_scopes={rows:[{program_id:'p1',vendor_id:VENDOR,level_ids:null}]};
  tableStates.training_vendors={rows:[{id:VENDOR,key:'OXBRIDGE',name:'Oxbridge',unlock_logic:'all_modules',has_grand_quiz:false,passing_pct:70,module_passing_pct:70}]};
  tableStates.training_levels={rows:[{id:LEVEL,name:'Game-Based Teaching',order_index:4,vendor_id:VENDOR,is_active:true}]};
  tableStates.training_courses={rows:[{id:37,level_id:LEVEL,is_active:true,title:'C',order_index:1}]};
  tableStates.training_modules={rows:[
    {id:172,course_id:37,is_active:true,title:'S1',order_index:1},
    {id:173,course_id:37,is_active:true,title:'S2',order_index:2},
  ]};
  tableStates.teacher_training_progress={rows: allDone
    ? [{user_id:UID,module_id:172},{user_id:UID,module_id:173}]
    : [{user_id:UID,module_id:172}]};
  tableStates.training_assessment_attempts={rows:[]};
  tableStates.training_assessment_answers={rows:[]};
  tableStates.training_grand_quizzes={rows:[]};            // <-- NO exam, the whole point
  tableStates.training_questions={rows:[]};
  tableStates.training_certificates={rows: certified
    ? [{id:'c1',user_id:UID,level_id:LEVEL,certificate_code:'OXB-1',issued_at:'2026-08-02T00:00:00Z'}]
    : []};
}

beforeEach(()=>{
  jest.resetModules(); tableStates={};
  jest.doMock('dotenv',()=>({config:()=>({parsed:{}})}),{virtual:true});
  process.env.OPENROUTER_API_KEY=process.env.OPENROUTER_API_KEY||'test-key';
  ['@aws-sdk/client-s3','@aws-sdk/s3-request-presigner','exceljs','pdfkit','bullmq','aws-sdk'].forEach(m=>jest.doMock(m,()=>({}),{virtual:true}));
  jest.doMock('../../bot/shared/utils/logger',()=>({logToFile:jest.fn()}));
  jest.doMock('../../bot/shared/utils/structured-logger',()=>({logEvent:jest.fn(),getCurrentCorrelationId:()=>null,logger:{info:jest.fn(),error:jest.fn(),warn:jest.fn()}}));
  supabaseFrom=jest.fn(t=>makeChain(t));
  jest.doMock('../../bot/shared/config/supabase',()=>({from:supabaseFrom,rpc:jest.fn()}));
  jest.doMock('../../bot/shared/services/whatsapp.service',()=>({sendMessage:jest.fn(),sendInteractiveButtons:jest.fn(),sendInteractiveMessage:jest.fn()}));
});
afterEach(()=>jest.resetModules());

const ep=()=>require('../../bot/shared/routes/teacher-training-endpoint');

describe('bd-2503 — a certificate is what makes a no-exam level terminal', () => {
  it('a certified no-exam level is NOT stuck on ready_for_quiz', async () => {
    seed({ allDone: true, certified: true });
    const lv=(await ep().loadVisibleLevelsWithProgress(UID)).find(l=>l.id===LEVEL);
    expect(lv.state).not.toBe('ready_for_quiz');
    expect(lv.state).toBe('certified');
  });

  it('the HOME line says passed, not "Ready for exam"', async () => {
    seed({ allDone: true, certified: true });
    const lv=(await ep().loadVisibleLevelsWithProgress(UID)).find(l=>l.id===LEVEL);
    expect(ep().levelProgressLine(lv)).not.toMatch(/Ready for exam/);
  });

  it('LEVEL_DETAIL stops telling a finished teacher to finish', async () => {
    seed({ allDone: true, certified: true });
    const s=await ep().loadGrandQuizState(UID, LEVEL);
    expect(s.body).not.toMatch(/finish all sessions/i);
  });

  it('an UNfinished no-exam level shows NOTHING rather than explaining', async () => {
    seed({ allDone: false, certified: false });
    const s=await ep().loadGrandQuizState(UID, LEVEL);
    // bd-60130 — was /finish all sessions/i. A level with no exam now renders
    // a blank slot: the teacher's progress is already on the screen above, and
    // narrating the absence of an exam reads as breakage.
    expect(s.body.trim()).toBe('');
    expect(s.body).not.toMatch(/finish all sessions/i);
  });

  it('finished but not yet certified is not falsely marked certified', async () => {
    seed({ allDone: true, certified: false });
    const lv=(await ep().loadVisibleLevelsWithProgress(UID)).find(l=>l.id===LEVEL);
    expect(lv.state).not.toBe('certified');
  });
});
