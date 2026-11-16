'use strict';
/**
 * bd-snkn32.12 — synthetic grades 1–5 v9/v10 lesson-plan documents in the renderer's real markup: pages with a
 * continuation strip and footer, the section bars (s-i Opening, s-d Explanation/I Do, s-we We Do, s-a You Do,
 * s-c Check, s-h Homework; We Do and You Do BOTH carry data-sec="activity"), "continued" bars on a new page, warm-up,
 * hook, I-Do / We-Do script turns, CFU, mistakes, You-Do practice with answers, differentiation cards, exit ticket,
 * re-teach rule, homework and the coaching corner. Invented lessons: no real lesson text, no real names.
 */

const page = (n, body) => `<div class="page"><div class="pad">${n > 1 ? '<div class="contstrip"><span class="ct">T</span><span class="cc">· continued</span></div>' : ''}
${body}<div class="foot"><div class="fl">FOOTER-LINE</div><div class="fr">page ${n} of 3</div></div></div></div>`;

const doc = (lang, dir, pages) => `<!doctype html><html lang="${lang}" dir="${dir}" class="pri"><head><meta charset="utf-8">
<title>fixture</title><style>@font-face{font-family:x;src:url(data:font/woff2;base64,AAAA)}</style></head><body>
${pages.map((b, i) => page(i + 1, b)).join('\n')}</body></html>`;

const bar = (s, sec, name, mins, cont = false) => `<div class="bar ${s}${cont ? ' cont' : ' sp-4'}" data-sec="${sec}"><span class="badge">X</span>`
  + `<span class="nm">${name}</span>${mins ? `<span class="mins">${mins}</span>` : ''}</div>`;
const turn = (k, t) => `<div class="blk exq pc pc-m sp-0"><div class="scr"><div class="tn ${k}"><span class="tx">${t}</span></div></div></div>`;
const weTurn = (k, t) => `<div class="blk exq we pc pc-m sp-0"><div class="scr"><div class="tn ${k}"><span class="tx">${t}</span><div class="rp"><span class="wait"></span></div></div></div></div>`;

const EN = doc('en', 'ltr', [
  `<div class="hero sp-0"><div class="h-col"><div class="h-top"><div class="kicker">Grade 2 · Math</div><div class="h-loc">p.40 · <b>35 min</b></div></div>
<div class="h-title">Sharing pebbles into equal groups</div></div><div class="h-meta"><span>Ch.6 · The Pebble Market</span></div></div>
<div class="drail sp-2"><span class="d on">1</span><span class="d">2</span></div>
<div class="slo sp-2"><div class="lbl">Learning outcome · M-02-DV-01</div><p>Sharing means the same number in every group.</p></div>
<div class="rescard sp-2"><div class="rmat"><span class="lbl">To prepare</span><div class="mlist"><span class="mi">twelve pebbles</span><span class="mi">three bags</span></div></div></div>
<div class="rescard pc pc-a sp-1"><div class="rkw"><span class="lbl">Key words</span><div class="kwtab"><div class="kr"><b>equal</b>the same amount in each group</div></div></div></div>
<div class="blk board pc pc-a sp-2"><div class="lbl">Write on the board</div><div class="bd"><div class="bp"><span class="bn">1</span><div class="bb"><span class="bx">TWELVE PEBBLES, THREE BAGS</span><span class="bk">12 ÷ 3</span><span class="bg">4 in each</span></div></div></div></div>
${bar('s-i', 'introduction', 'Opening', '4 min')}
<div class="opn ofirst blk wu sp-2"><div class="lbl g">Warm-up</div><div class="it"><span class="n">1.</span><span class="q">Count to twelve in twos.<span class="a">→ 2, 4, 6, 8, 10, 12</span></span><span class="kind">spaced review</span></div></div>
<div class="opn olast blk hook sp-0"><div class="lbl">Open with this question</div><div class="q">HOOK-QUESTION: three friends, twelve sweets — fair?</div></div>`,
  `${bar('s-i', 'introduction', 'Opening · continued', null, true)}
<div class="blk sp-2"><div class="lbl g">Then</div><ul class="kp"><li>OPENING-STEP: children guess aloud.</li></ul></div>
${bar('s-d', 'development', 'Explanation', '9 min')}
<div class="blk exq pc pc-a sp-2"><span class="mvt">I Do</span><span class="dct">Explain</span><span class="tag">Teacher models</span><div class="scr"><div class="tn k-do"><span class="tx">IDO-ACTION: put twelve pebbles on the desk.</span></div></div></div>
${turn('k-say', 'IDO-SAY: one pebble for each bag, again and again.')}
<div class="blk exq pc pc-z sp-0"><div class="scr"><div class="tn k-ask"><span class="tx">IDO-ASK: are the bags equal?</span></div></div><div class="cfu"><span class="cl">Ask this</span>IDO-CFU: how do you know?</div></div>
<figure class="dg sp-3"><span class="mvt">I Do</span><div class="ftop"><span class="ftag">Number line</span></div><svg><text>SVG-TEXT</text></svg></figure>
<div class="blk sp-3"><div class="lbl g">Common mistakes</div><div class="grid3"><div class="mis"><div class="x"><span class="lbl">✗ What children say</span><p>MIS-SLIP: the last bag gets the rest.</p></div>
<div class="v"><span class="lbl">✓ You ask</span><p>MIS-FIX: count every bag again.</p></div></div></div></div>
${bar('s-we', 'activity', 'We Do', '10 min')}
<div class="blk exq we pc pc-a sp-2"><span class="mvt we">We Do</span><span class="dct">Guided</span><span class="tag">WE DO · class practises together</span>
<ul class="setup"><li>WEDO-SETUP: circulate and ask where they started.</li></ul><div class="scr"><div class="tn k-do"><span class="tx">WEDO-ACTION: share 8 pebbles into 2 bags together.</span></div></div></div>
${weTurn('k-frame', 'WEDO-FRAME: each bag has ___ pebbles.')}`,
  `${bar('s-we', 'activity', 'We Do · continued', null, true)}
${weTurn('k-routine', '')}
<div class="blk exq we pc pc-m sp-0"><div class="scr"><div class="tn k-routine"><span class="rn">PARTNER CHECK · 2 minutes</span><ol class="rs"><li>ROUTINE-1: A shares.</li><li>ROUTINE-2: B counts.</li></ol></div></div></div>
${bar('s-a', 'activity', 'You Do', '9 min')}
<div class="blk sp-2"><span class="mvt you">You Do</span><span class="dct">Independent</span><div class="lbl g">Set the task going</div><ul class="kp"><li>YOUDO-TASK: pairs do p.41 Q2.</li></ul></div>
<div class="blk pr pc pc-a sp-2"><span class="mvt you">You Do</span><span class="tag">YOU DO · pupils work alone</span><div class="items"><div class="it"><div class="qr"><span class="n">1.</span><span class="q">PRACTICE-1: share 10 into 2.</span></div><div class="arow"><span class="al">Answer</span><span class="a">PRACTICE-1-ANSWER 5</span></div></div></div></div>
<div class="blk askb sp-2"><span class="mvt you">You Do</span><div class="lbl">Ask this</div><div class="q">YOUDO-ASK: how did you check?</div></div>
${bar('s-a', 'activity', 'You Do · continued', null, true)}
<div class="blk sp-3"><div class="lbl g">Differentiation</div><div class="grid3"><div class="card"><span class="lbl">If stuck</span><ul class="kp"><li>BEHIND: use six pebbles first.</li></ul></div></div></div>
<div class="grid3 sp-2"><div class="card"><span class="lbl">If they finish early</span><p>AHEAD: share 15 into 3.</p></div></div>
${bar('s-c', 'conclusion', 'Check', '3 min')}
<div class="blk exit sp-2"><div class="lbl">Exit ticket</div><div class="it">1. EXIT-PROMPT: share 6 into 3. <span class="a">→ EXIT-ANSWER 2</span></div></div>
<div class="blk reteach sp-2"><div class="lbl">Re-teach rule</div><div class="t">RETEACH: if under 2 of 3, redo the bags.</div></div>
${bar('s-h', 'homework', 'Homework', null)}
<div class="blk sp-2"><div class="lbl g">Homework</div><ul class="kp"><li>HOMEWORK-1: share spoons at home.</li></ul></div>
<div class="coach sp-4"><div class="lbl">Coaching corner</div><p class="ask"><span class="lbl">Ask yourself</span>COACH-TEXT</p><p class="offer">OFFER-TEXT 0300 0000000</p></div>`,
]);

const UR = doc('ur', 'rtl', [
  `<div class="hero sp-0"><div class="h-col"><div class="h-loc">صفحہ ⁦۱۲⁩ · ۴۰ منٹ</div><div class="h-title">حروف جوڑ کر لفظ بنانا</div></div></div>
<div class="slo sp-2"><div class="lbl">تدریسی مقصد · U-01-RD-02</div><p>بچے دو حروف جوڑ کر ایک چھوٹا لفظ پڑھ سکیں گے۔</p></div>
${bar('s-i', 'introduction', 'تعارف', '۵ منٹ')}
<div class="opn olast blk hook sp-0"><div class="lbl">اس سوال سے آغاز کریں</div><div class="q">آپ نے باغ میں کیا دیکھا؟</div></div>
${bar('s-d', 'development', 'تدریس', '۱۰ منٹ')}
${turn('k-say', 'دیکھو بچو، ب اور ا مل کر با بنتا ہے۔')}
${bar('s-we', 'activity', 'مل کر کریں', '۱۲ منٹ')}
${weTurn('k-say', 'سب مل کر بولیں: ج اور ا، جا۔')}
${bar('s-a', 'activity', 'خود کریں', '۱۰ منٹ')}
<div class="blk pr pc pc-a sp-2"><div class="items"><div class="it"><div class="qr"><span class="q">ج + ا = ___</span></div><div class="arow"><span class="al">جواب</span><span class="a">جا</span></div></div></div></div>
<div class="grid3 sp-2"><div class="card"><span class="lbl">اگر بچے اٹک جائیں</span><p>ایک حرف سے شروع کریں۔</p></div></div>
<div class="grid3 sp-2"><div class="card"><span class="lbl">اگر جلد فارغ ہو جائیں</span><p>تین حروف جوڑیں۔</p></div></div>
${bar('s-c', 'conclusion', 'اختتام', '۳ منٹ')}
<div class="blk exit sp-2"><div class="lbl">ایگزٹ ٹکٹ</div><div class="it">۱. با پڑھیں۔ <span class="a">با</span></div></div>`,
]);

/** A v9 document cut short: Opening and I Do only (no We Do, You Do or Check). */
const PARTIAL = doc('en', 'ltr', [
  `<div class="hero sp-0"><div class="h-title">Half a lesson</div></div>
${bar('s-i', 'introduction', 'Opening', '4 min')}
<div class="opn olast blk hook sp-0"><div class="q">A question.</div></div>
${bar('s-d', 'development', 'Explanation', '9 min')}
${turn('k-say', 'Explain it.')}`,
]);

module.exports = { EN, UR, PARTIAL };
