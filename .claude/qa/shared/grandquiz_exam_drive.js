/* Reusable Chrome-MCP browser helper to drive a NIETE training GRAND QUIZ (or any
 * in-chat multi-question module/level exam) to a deterministic pass.
 *
 * WHY: the grand quiz serves N questions from a bank, options SHUFFLE per attempt,
 * and rendering is mixed (long options -> inline lettered "A. .." in the message
 * body; short options -> dialog list rows with text). So you must match by TEXT,
 * never by letter/position. The answer key comes from the DB:
 *     python .claude/qa/shared/niete_training_db.py answer-key --level <id>
 * which prints [{q, correct}] (correct_option is 1-based -> resolved to option text).
 *
 * HOW TO USE (via mcp__chrome-devtools__evaluate_script, in order):
 *  1. Paste this whole file once (defines window.__gqInit + helpers).
 *  2. window.__gqInit(<the [{q,correct}] JSON array from answer-key>)   // loads key
 *  3. Per question: await window.__drive(expectedQnum)                  // one call/Q
 *     - returns {q, letter, sent:true} on success, or {noMatch|mismatch|waitFailed}
 *     - on a prefix-collision noMatch (two bank questions share a prefix, e.g. the
 *       rhyming-words sequence Qs), read the served options and pick the letter
 *       whose text matches the intended answer, then window.__pickLetterSend('C').
 *  4. After the last Q, the bot grades + (on pass) issues the certificate + PDF.
 *
 * Then verify #4 with:  /certificate <code-from-pass-message>  -> expect the PDF.
 */
(() => {
  window.__norm = s => (s || '').replace(/\s+/g, ' ').replace(/[“”"']/g, '').trim();

  window.__gqInit = (answers) => { window.__GQ = answers || []; return { loaded: window.__GQ.length }; };

  // Resolve the current question's correct answer + open its "Answer" dialog.
  window.__openAndResolve = () => {
    const rows = [...document.querySelectorAll('div[role="row"]')];
    let qtext = null, qnum = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const t = rows[i].innerText || ''; const m = t.match(/Q(\d+)\/\d+/);
      if (m && !/You:/.test(t)) { qtext = t; qnum = parseInt(m[1]); break; }
    }
    const nq = window.__norm(qtext); let best = null;
    for (const e of window.__GQ) { const k = window.__norm(e.k || e.q).slice(0, 45); if (k && nq.includes(k)) { best = e; break; } }
    window.__cur = best ? best.correct : null;
    const btns = [...document.querySelectorAll('button')].filter(b => /^Answer$/.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
    const ab = btns[btns.length - 1]; if (ab) ab.click();
    return { qnum, matched: !!best, correct: (window.__cur || '').slice(0, 60), clickedAnswer: !!ab };
  };

  // Options come from EITHER the chat message (long/inline) OR the open dialog (short).
  window.__getOpts = () => {
    const rows = [...document.querySelectorAll('div[role="row"]')];
    let qrow = null; for (let i = rows.length - 1; i >= 0; i--) { const t = rows[i].innerText || ''; if (/Q\d+\/\d+/.test(t) && !/You:/.test(t)) { qrow = t; break; } }
    const opts = {}; const re = /(?:^|\n)\s*([A-D])[\.\)]\s*([\s\S]*?)(?=\n\s*[A-D][\.\)]|\n\s*\d+%|$)/g; let m;
    while ((m = re.exec(qrow))) opts[m[1]] = window.__norm(m[2]);
    if (Object.keys(opts).length >= 2) return { mode: 'chat', opts };
    const dlg = document.querySelector('div[role="dialog"]'); if (!dlg) return { mode: 'none', opts: {} };
    const lines = dlg.innerText.split('\n').map(x => x.trim()).filter(Boolean); let cur = null; const o2 = {};
    for (const ln of lines) { if (/^[A-D]$/.test(ln)) { cur = ln; o2[ln] = ''; } else if (cur && ln !== 'Answer') o2[cur] = (o2[cur] ? o2[cur] + ' ' : '') + window.__norm(ln); }
    return { mode: 'dialog', opts: o2 };
  };

  window.__pickLetterSend = async (letter) => {
    const dlg = document.querySelector('div[role="dialog"]'); if (!dlg) return { noDialog: true };
    const radio = [...dlg.querySelectorAll('[role="radio"]')].find(r => r.getAttribute('aria-label') === letter);
    const chk = () => [...dlg.querySelectorAll('[role="radio"]')].find(r => r.getAttribute('aria-checked') === 'true')?.getAttribute('aria-label');
    for (let k = 0; k < 8 && chk() !== letter; k++) { radio.click(); await new Promise(r => setTimeout(r, 120)); }
    for (let k = 0; k < 3 && chk() !== letter; k++) { (radio.closest('button') || radio).click(); await new Promise(r => setTimeout(r, 120)); }
    if (chk() !== letter) return { mismatch: true, wanted: letter, checked: chk() };
    const s = document.querySelector('[data-icon="wds-ic-send-filled"], [data-icon="send"]');
    (s?.closest('button') || s?.parentElement)?.click();
    return { letter, sent: true };
  };

  window.__drive = async (expectQ) => {
    const latestQ = () => { const rows = [...document.querySelectorAll('div[role="row"]')]; for (let i = rows.length - 1; i >= 0; i--) { const t = rows[i].innerText || ''; const m = t.match(/Q(\d+)\/\d+/); if (m && !/You:/.test(t)) return parseInt(m[1]); } return null; };
    for (let i = 0; i < 50 && latestQ() !== expectQ; i++) await new Promise(r => setTimeout(r, 150));
    if (latestQ() !== expectQ) return { waitFailed: true, latest: latestQ() };
    const r = window.__openAndResolve();
    for (let i = 0; i < 30 && !document.querySelector('div[role="dialog"] [role="radio"]'); i++) await new Promise(res => setTimeout(res, 120));
    await new Promise(res => setTimeout(res, 300));
    const want = window.__norm(window.__cur); if (!want) return { q: r.qnum, noAnswer: true };
    const { opts } = window.__getOpts(); const chunk = want.slice(0, 18); let letter = null;
    for (const L of ['A', 'B', 'C', 'D']) { const t = opts[L]; if (t && (t.includes(chunk) || (t.length > 10 && want.includes(t.slice(0, Math.min(18, t.length)))))) { letter = L; break; } }
    if (!letter) { // token overlap (ASCII) fallback
      const wt = new Set(want.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)); let bs = 0;
      for (const L of ['A', 'B', 'C', 'D']) { const tt = (opts[L] || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3); let s = 0; for (const w of tt) if (wt.has(w)) s++; if (s > bs) { bs = s; letter = L; } }
    }
    if (!letter) return { q: r.qnum, noMatch: true, want: want.slice(0, 40), opts };
    return { q: r.qnum, ...(await window.__pickLetterSend(letter)) };
  };
  return 'grandquiz exam-drive helpers ready';
})();
