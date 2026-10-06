'use strict';
/**
 * Synthetic K-5 "v9" lesson-plan documents in the renderer's markup (the classes
 * the real documents carry: hero, slo, kwtab, board, the section bars, exq I-Do /
 * We-Do, mis, pr, exit, and `.a` answer spans). Invented lessons — no real
 * lesson text, no real names.
 */

const page = (lang, dir, body) => `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<title>fixture</title><style>@font-face{font-family:x;src:url(data:font/woff2;base64,AAAA)}</style></head><body>
<div class="page" id="t1" data-part="teach"><div class="pad">${body}</div></div></body></html>`;

const EN = page('en', 'ltr', `
<div data-atom class="hero sp-0"><div class="h-col"><div class="h-top"><div class="kicker">Grade 2 · Math</div>
<div class="h-loc">p.40 · <b>35 min</b></div></div><div class="h-title">Sharing pebbles into equal groups</div></div>
<div class="h-meta"><span>Ch.6 · The Pebble Market</span></div></div>
<div data-atom class="slo sp-2"><div class="lbl">Learning outcome &middot; M-02-DV-01</div>
<ul class="kp"><li>Sharing means putting the same number of things in every group.</li><li>Count each group to check it is equal.</li></ul></div>
<div data-atom class="rescard pc pc-a sp-1"><div class="rkw"><span class="lbl">Key words</span><div class="kwtab">
<div class="kr"><b>equal</b><span>the same amount in each group</span></div></div></div></div>
<div data-atom class="blk board pc pc-a sp-2"><div class="lbl">Write on the board</div><div class="bd"><div class="bp"><span class="bn">1</span>
<div class="bhd">TWELVE PEBBLES, THREE BAGS</div><div class="bb"><span class="bx">Four pebbles go in each bag.</span></div></div></div></div>
<div data-atom class="bar s-i sp-4" data-sec="introduction"><span class="badge">I</span><span class="nm">Opening</span></div>
<div data-atom class="opn ofirst blk wu sp-2"><div class="lbl g">Warm-up</div><div class="it"><span class="q">Count to twelve in twos.
<span class="a">&rarr; WARMUP-ANSWER-SECRET</span></span></div></div>
<div data-atom class="bar s-d sp-4" data-sec="development"><span class="badge">D</span><span class="nm">Explanation</span></div>
<div data-atom class="blk exq pc pc-a sp-2"><span class="mvt">I Do</span><span class="tag">Teacher models</span>
<div class="scr"><div class="tn k-do"><span class="tx">Put twelve pebbles on the desk.</span></div>
<div class="tn k-say"><span class="tx">Think aloud: one pebble for each bag, again and again, until the pebbles run out.</span></div></div></div>
<div data-atom class="blk exq sp-2"><span class="mvt">I Do</span><span class="tag">Worked example</span>
<ol><li>Share 8 pebbles into 2 bags: one each, one each, until none are left. Each bag has 4.</li></ol>
<div class="cfu"><span class="cl">Ask this</span><ul class="kp"><li>How do you know the bags are equal?</li></ul></div></div>
<div data-atom class="blk sp-3"><div class="grid3"><div class="mis"><div class="v"><span class="lbl">&#10003; You ask</span>
<p>Groups are only equal when every group is counted and gives the same number.</p></div></div></div></div>
<div data-atom class="bar s-we sp-4" data-sec="activity"><span class="badge">A</span><span class="nm">We Do</span></div>
<div data-atom class="blk exq we pc pc-a sp-2"><span class="mvt we">We Do</span><div class="scr"><div class="tn k-say"><span class="tx">WE-DO-LINE</span></div></div></div>
<div data-atom class="blk pr pc pc-a sp-2"><span class="mvt you">You Do</span><div class="items"><div class="it"><div class="qr"><span class="n">1.</span>
<span class="q">Share 10 pebbles into 2 bags. How many in each bag?</span></div>
<div class="arow"><span class="al">Answer</span><span class="a">PRACTICE-ANSWER-SECRET</span></div></div></div></div>
<div data-atom class="blk exit sp-2"><div class="lbl">Exit ticket</div><div class="it"><span>1.</span><span>EXIT-PROMPT-SECRET <span class="a">EXIT-ANSWER-SECRET</span></span></div></div>
`);

const UR = page('ur', 'rtl', `
<div data-atom class="hero sp-0"><div class="h-col"><div class="h-loc">صفحہ ⁦۱۲⁩ &middot; ۴۰ منٹ</div><div class="h-title">حروف جوڑ کر لفظ بنانا</div></div>
<div class="h-meta"><span>باب ۲ · باغ کی سیر</span></div></div>
<div data-atom class="slo sp-2"><div class="lbl">تدریسی مقصد &middot; U-01-RD-02</div>
<p>بچے دو حروف جوڑ کر ایک چھوٹا لفظ پڑھ سکیں گے۔</p></div>
<div data-atom class="bar s-d sp-4" data-sec="development"><span class="badge">D</span><span class="nm">وضاحت</span></div>
<div data-atom class="blk exq pc pc-a sp-2"><div class="scr"><div class="tn k-say"><span class="tx">دیکھو بچو، ب اور ا مل کر با بنتا ہے۔</span></div></div></div>
<div data-atom class="blk pr pc pc-a sp-2"><div class="items"><div class="it"><div class="qr"><span class="q">ج + ا = ___</span></div>
<div class="arow"><span class="al">جواب</span><span class="a">جا</span></div></div></div></div>
`);

module.exports = { EN, UR };
