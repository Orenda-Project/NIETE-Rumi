// flow-lib.cjs — native-Flow driving primitives on top of flow-drive.js.
// Every one of these fixes a bug that failed SILENTLY (clicked the wrong thing, or nothing,
// with no error) during the 2026-08-27 run.
const path = require('path');
const FD = require(path.join(__dirname, 'flow-drive.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEL = 'button,li,[role="option"],[role="radio"],[role="button"]';

// flow-drive's evaluate/probe never time out, so a stale iframe target makes them wait forever.
// Every helper in this file goes through this — a bounded failure is recoverable, a hang is not.
const OP_MS = 12000;
const bounded = (pr, label) => Promise.race([
  pr,
  new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT:' + label)), OP_MS)),
]);
const tryBounded = async (pr, label, fallback) => {
  try { return await bounded(pr, label); } catch (_) { return fallback; }
};

// Scroll AND measure in ONE evaluate. Split across round trips the coordinates came back
// from before the scroll settled (y=1244 in an 867px frame) and the click landed on
// whatever was under the pointer.
async function locateByText(c, text, opts) {
  opts = opts || {};
  const t = JSON.stringify(String(text).toLowerCase());
  const exact = opts.exact ? 'true' : 'false';
  const last = opts.last ? 'true' : 'false';
  const js = `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(SEL)})];
    const want = ${t};
    const hits = els.filter(e => { const s = (e.innerText || '').trim().toLowerCase();
      return ${exact} ? s === want : s.includes(want); })
      .filter(e => !(e.disabled || e.getAttribute('aria-disabled') === 'true'));
    const el = ${last} ? hits[hits.length - 1] : hits[0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2),
                            vh: innerHeight, label: (el.innerText || '').trim().slice(0, 40) });
  })()`;
  const j = await tryBounded(c.evaluate(js), 'locateByText', null);
  return j ? JSON.parse(typeof j === 'string' ? j : JSON.stringify(j)) : null;
}

// Always scroll into view before clicking — a control at cy=-619 swallowed every click and
// left the submit disabled with no visible cause.
async function clickText(c, text, opts) {
  opts = opts || {};
  const loc = await locateByText(c, text, opts);
  if (!loc) return { ok: false, err: 'NO_ITEM:' + text };
  if (!(loc.cy > 0 && loc.cy < loc.vh)) return { ok: false, err: 'OFFSCREEN:' + text + '@' + loc.cy };
  await c.clickAt(loc.cx, loc.cy);
  await sleep(opts.settleMs == null ? 1200 : opts.settleMs);
  return { ok: true, clicked: loc.label };
}

// Long dropdowns. Two traps, both of which silently pick the WRONG thing:
//   (a) the option label is ambiguous — "Other" exists in BOTH the Subjects list and the
//       Organization dropdown, so searching the whole document while the dropdown is SHUT
//       toggles a subject and leaves the real field empty (submit stays disabled, no error);
//   (b) the opener TOGGLES, so clicking it on an already-open list closes it.
// Fix: open first when the option is not already inside an OPEN listbox, and scope the search
// to that listbox so the ambiguous twin outside it can never match.
async function markListboxes(c) {
  // Grades and Subjects are ALSO role="listbox" and always visible, so "the last listbox in DOM
  // order" grabbed the wrong one and clicked the Subjects "Other" while Organization stayed
  // empty — ok:true, submit disabled, no error. Mark what exists BEFORE opening; the dropdown
  // that appears afterwards is the only unmarked one.
  // CLEAR first. The marks used to accumulate across picks, so a dropdown that had been open
  // earlier in the run was already marked and "the new one" matched nothing — the Organization
  // pick then silently fell back to the wrong listbox again.
  return c.evaluate(`(()=>{
    document.querySelectorAll('[data-e2e-pre]').forEach(b=>b.removeAttribute('data-e2e-pre'));
    const bs=[...document.querySelectorAll('[role="listbox"]')];
    bs.forEach(b=>b.setAttribute('data-e2e-pre','1'));
    return bs.length;})()`);
}
async function locateInListbox(c, want, opts) {
  opts = opts || {};
  const w = JSON.stringify(String(want).toLowerCase());
  const onlyNew = opts.onlyNew ? 'true' : 'false';
  const js = `(() => {
    let boxes = [...document.querySelectorAll('[role="listbox"]')]
      .filter(b => b.getBoundingClientRect().height > 0);
    if (${onlyNew}) {
      const fresh = boxes.filter(b => !b.hasAttribute('data-e2e-pre'));
      if (fresh.length) boxes = fresh;
    }
    for (let i = boxes.length - 1; i >= 0; i--) {
      const el = [...boxes[i].querySelectorAll('button,li,[role="option"],[role="radio"]')]
        .find(e => (e.innerText || '').trim().toLowerCase() === ${w});
      if (!el) continue;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2), vh: innerHeight });
    }
    return null;
  })()`;
  const j = await tryBounded(c.evaluate(js), 'locateInListbox', null);
  return j ? JSON.parse(typeof j === 'string' ? j : JSON.stringify(j)) : null;
}

async function pickOption(c, want, opts) {
  opts = opts || {};
  let loc = null;
  if (opts.open) {
    await markListboxes(c);                       // snapshot what is already on screen
    for (let attempt = 0; !loc && attempt < 2; attempt++) {
      const o = await clickText(c, opts.open, { settleMs: 1400 });
      if (!o.ok && attempt === 1) return o;
      loc = await locateInListbox(c, want, { onlyNew: true });
    }
  }
  if (!loc) loc = await locateInListbox(c, want);
  if (!loc) loc = await locateByText(c, want, { exact: true, last: opts.last });
  if (!loc) return { ok: false, err: 'OPTION_ABSENT:' + want };
  if (!(loc.cy > 0 && loc.cy < loc.vh)) { await sleep(400); loc = (await locateInListbox(c, want, { onlyNew: !!opts.open })) || loc; }
  if (!(loc.cy > 0 && loc.cy < loc.vh)) return { ok: false, err: 'OPTION_OFFSCREEN:' + want + '@' + loc.cy };
  await c.clickAt(loc.cx, loc.cy);
  await sleep(1200);
  return { ok: true, picked: want };
}

// Back / Cancel are icon buttons with no innerText.
async function clickAria(c, label, settleMs) {
  const js = `(() => {
    // The Flow header renders TWO aria-label="Cancel" buttons; the first has a zero-width box.
    // Clicking it "succeeds" and closes nothing (2026-09-02: a registration Flow survived three
    // resetFlow() calls, and training then drove the wrong iframe). Require a visible box.
    const e = [...document.querySelectorAll('button,[role="button"]')]
      .filter(x => (x.getAttribute('aria-label') || '') === ${JSON.stringify(label)})
      .find(x => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return JSON.stringify({ cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2) });
  })()`;
  const j = await c.evaluate(js);
  if (!j) return { ok: false, err: 'NO_ARIA:' + label };
  const p = JSON.parse(typeof j === 'string' ? j : JSON.stringify(j));
  await c.clickAt(p.cx, p.cy);
  await sleep(settleMs == null ? 1400 : settleMs);
  return { ok: true, label };
}

// The iframe target exists BEFORE its document renders; probing too early returns the
// bootstrap script text and every match fails.
async function waitReady(c, tries = 40, port) {
  // Three distinct not-ready states, each of which has silently produced a wrong assertion:
  //   1. the TARGET exists before the DOCUMENT does  -> probe throws on document.body
  //   2. the bootstrap script text is all that is there
  //   3. the chrome renders BEFORE the form does, so the probe returns only the footer
  //      ("Managed by Rumi niete. Learn more") and every screen assertion compares against it.
  // So: wait for a form with children AND for the text to STOP changing between polls.
  let prev = null;
  for (let i = 0; i < tries; i++) {
    // The iframe's execution context is REPLACED when the Flow navigates off its bootstrap
    // document, so a connection held from before that point answers nothing and each bounded
    // probe costs OP_MS. Re-attach on every poll when a port is given (2026-09-02: registration
    // opened in ~3s yet reported FLOW_READY_TIMEOUT at 75s for exactly this reason).
    if (port) { try { c.close(); } catch (_) {} const fresh = await FD.attach(port); if (!fresh) { await sleep(700); continue; } c = fresh; }
    let p = null;
    p = await tryBounded(c.probe(), 'probe', null);
    if (!p) { await sleep(700); continue; }
    const txt = (p && p.text) || '';
    const bootstrapping = /require|bootstrapWebSession|qplTag/.test(txt.slice(0, 120));
    let hasForm = false;
    hasForm = !!(await tryBounded(c.evaluate(`(()=>{const f=document.querySelector('form');return !!(f&&f.children.length);})()`), 'hasForm', false));
    if (!bootstrapping && hasForm && txt.length > 60 && txt === prev) { p.__conn = c; return p; }   // hand back the LIVE connection
    prev = txt;
    await sleep(700);
  }
  const fin = (await tryBounded(c.probe(), 'probe-final', null)) || { text: '', items: [] };
  fin.__conn = c;
  return fin;
}

module.exports = { FD, sleep, esc, locateByText, locateInListbox, markListboxes, clickText, pickOption, clickAria, waitReady };
