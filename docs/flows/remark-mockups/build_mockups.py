#!/usr/bin/env python3
"""
bd-2712 — two candidate shapes for the /remark rubric as a WhatsApp Flow.

Variant A: one indicator per screen (5 screens) + comment  → 6 taps per teacher
Variant B: all 5 indicators on one scrolling screen        → 1 screen per teacher

Copy discipline (html-mockups §1): indicator names, anchors and scale labels are
VERBATIM from bot/shared/services/remark/remark-rubric.js. Only the Flow-native
chrome copy (tap prompts, footer labels) is new — the catalog's existing strings
are chat-shaped ("Reply with 1, 2, 3 or 4") and would be wrong on a Flow.
"""
import json, subprocess, os, re, sys

OUT = os.path.dirname(os.path.abspath(__file__))
R = json.load(open('/tmp/rubric.json'))
SCALE, INDICATORS = R['SCALE'], R['INDICATORS']

NAVY, GOLD, WAGREEN = '#001F3F', '#F5B301', '#00A884'

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
URDU = "'Noto Nastaliq Urdu',serif"


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def radio(ind, lang, selected=None, compact=False):
    """A Meta RadioButtonsGroup: title = scale label, description = verbatim anchor."""
    rtl = lang == 'ur'
    rows = []
    for s in ('4', '3', '2', '1'):
        sel = (selected == s)
        title = esc(SCALE[s][lang])
        desc = esc(ind['anchors'][s][lang])
        dot = (f"<span class='dot sel'></span>" if sel else "<span class='dot'></span>")
        rows.append(
            f"<div class='opt{' optsel' if sel else ''}{' rtl' if rtl else ''}'>"
            f"{dot}<div class='optbody'><div class='opttitle'>{title}</div>"
            f"{'' if compact else f"<div class='optdesc'>{desc}</div>"}</div></div>")
    return "".join(rows)


def screen(title, inner, footer, lang='en', tall=False):
    rtl = lang == 'ur'
    return f"""
<div class="phone{' tallphone' if tall else ''}">
  <div class="scr">
    <div class="mhead"><span class="x">&#10005;</span><span class="mtitle">{esc(title)}</span></div>
    <div class="mbody{' rtl' if rtl else ''}">{inner}</div>
    <div class="mfoot"><div class="fbtn">{esc(footer)}</div></div>
  </div>
</div>"""


def ind_screen(ind, lang, selected=None, n=None):
    of = (f"Indicator {n} of 5" if lang == 'en' else f"شعبہ {n} از 5")
    name = esc(ind['name'][lang])
    inner = (f"<div class='eyebrow'>{esc(of)}</div>"
             f"<div class='h1'>{name}</div>"
             f"<div class='hint'>{'Choose the level that fits her best.' if lang=='en' else 'جو درجہ مناسب ہو منتخب کریں۔'}</div>"
             f"{radio(ind, lang, selected)}")
    return screen('Teacher Evaluation' if lang == 'en' else 'استاد کا جائزہ', inner,
                  'Continue' if lang == 'en' else 'آگے بڑھیں', lang)


def pick_screen(lang='en'):
    names = ['Ayesha Bibi', 'Bilal Ahmed', 'Sana Khan']
    rows = "".join(
        f"<div class='opt{' optsel' if i==0 else ''}'><span class='dot{' sel' if i==0 else ''}'></span>"
        f"<div class='optbody'><div class='opttitle'>{n}</div>"
        f"<div class='optdesc'>{'Not started this quarter' if i else 'Not started this quarter'}</div></div></div>"
        for i, n in enumerate(names))
    inner = (f"<div class='eyebrow'>Third Quarter 2026</div>"
             f"<div class='h1'>Which teacher?</div>"
             f"<div class='hint'>3 of 3 still to evaluate.</div>{rows}")
    return screen('Teacher Evaluation', inner, 'Continue', lang)


def comment_screen(lang='en'):
    if lang == 'en':
        inner = ("<div class='eyebrow'>Last step</div><div class='h1'>Anything to add?</div>"
                 "<div class='hint'>Optional — leave it blank if you have nothing to add.</div>"
                 "<div class='talabel'>Your comment</div>"
                 "<div class='ta'>She has grown a lot since the March observation, "
                 "especially in how she groups slower readers.<span class='caret'></span></div>"
                 "<div class='tacount'>112/600</div>")
    else:
        inner = ("<div class='eyebrow'>آخری مرحلہ</div><div class='h1'>کچھ اور کہنا چاہیں گی؟</div>"
                 "<div class='hint'>اختیاری — کچھ نہ کہنا ہو تو خالی چھوڑ دیں۔</div>"
                 "<div class='talabel'>آپ کی رائے</div>"
                 "<div class='ta'>مارچ کے مشاہدے کے بعد ان میں واضح بہتری آئی ہے۔<span class='caret'></span></div>"
                 "<div class='tacount'>0/600</div>")
    return screen('Teacher Evaluation' if lang == 'en' else 'استاد کا جائزہ', inner,
                  'Submit' if lang == 'en' else 'جمع کریں', lang)


def dense_screen(lang='en', sel=('4', '3', None, None, None)):
    parts = [f"<div class='eyebrow'>{'Third Quarter 2026 · Ayesha Bibi' if lang=='en' else 'تیسری سہ ماہی 2026 · عائشہ بی بی'}</div>",
             f"<div class='h1'>{'Rate all five' if lang=='en' else 'پانچوں شعبے'}</div>",
             f"<div class='hint'>{'One screen, then submit.' if lang=='en' else 'ایک ہی اسکرین، پھر جمع کریں۔'}</div>"]
    for i, ind in enumerate(INDICATORS):
        parts.append(f"<div class='grp'><div class='grplab'>{i+1}. {esc(ind['name'][lang])}</div>"
                     f"{radio(ind, lang, sel[i], compact=True)}</div>")
    parts.append(f"<div class='talabel'>{'Your comment (optional)' if lang=='en' else 'آپ کی رائے (اختیاری)'}</div>"
                 f"<div class='ta short'><span class='caret'></span></div>")
    return screen('Teacher Evaluation' if lang == 'en' else 'استاد کا جائزہ', "".join(parts),
                  'Submit' if lang == 'en' else 'جمع کریں', lang, tall=True)


CSS = f"""
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:radial-gradient(1200px 760px at 85% -14%,#12325a,{NAVY} 64%);
  font-family:{FONT};color:#fff;padding:44px 48px 40px}}
.kicker{{color:{GOLD};font-size:15px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}}
h1.t{{font-size:38px;font-weight:800;margin:10px 0 4px;letter-spacing:-.6px}}
h1.t .hl{{color:{GOLD}}}
.sub{{font-size:17px;color:#c8d6e8;max-width:1150px;line-height:1.5;margin-bottom:8px}}
.badges{{display:flex;gap:12px;margin:18px 0 26px;flex-wrap:wrap}}
.badge{{background:#0c2138;border-left:4px solid {GOLD};padding:11px 16px;border-radius:8px;
  font-size:14px;line-height:1.45;max-width:330px}}
.badge b{{display:block;color:{GOLD};font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px}}
.row{{display:flex;gap:26px;align-items:flex-start}}
.cap{{text-align:center;font-size:13.5px;color:#9fb4cd;margin-top:12px;font-weight:600}}
.cap b{{color:#fff;display:block;font-size:15px;margin-bottom:2px}}
.col{{width:375px;flex:0 0 375px}}

/* phone bezel */
.phone{{width:375px;height:760px;background:#08111c;border-radius:42px;padding:11px;
  box-shadow:0 26px 60px rgba(0,0,0,.55)}}
.tallphone{{height:1160px}}
.scr{{background:#fff;height:100%;border-radius:32px;overflow:hidden;display:flex;flex-direction:column;color:#111}}

/* Meta Flow modal chrome — white header, NOT the green chat bar */
.mhead{{height:56px;flex:0 0 56px;display:flex;align-items:center;gap:16px;padding:0 18px;
  border-bottom:1px solid #E9EDEF;background:#fff}}
.x{{font-size:19px;color:#54656F}}
.mtitle{{font-size:16.5px;font-weight:600;color:#111B21}}
.mbody{{flex:1;overflow:hidden;padding:20px 18px 8px}}
.mfoot{{flex:0 0 74px;border-top:1px solid #E9EDEF;padding:14px 18px;background:#fff}}
.fbtn{{background:{WAGREEN};color:#fff;border-radius:24px;height:46px;display:flex;
  align-items:center;justify-content:center;font-size:16px;font-weight:600}}

.eyebrow{{font-size:12.5px;color:#8696A0;font-weight:700;letter-spacing:.05em;text-transform:uppercase}}
.h1{{font-size:21px;font-weight:700;color:#111B21;margin:6px 0 6px;line-height:1.3}}
.hint{{font-size:13.5px;color:#667781;margin-bottom:16px;line-height:1.45}}

.opt{{display:flex;gap:12px;padding:13px 13px;border:1px solid #E9EDEF;border-radius:11px;margin-bottom:9px;align-items:flex-start}}
.optsel{{border-color:{WAGREEN};background:#F2FBF7}}
.dot{{width:19px;height:19px;border-radius:50%;border:2px solid #C4CDD5;flex:0 0 19px;margin-top:2px}}
.dot.sel{{border-color:{WAGREEN};background:radial-gradient(circle,{WAGREEN} 0 6px,#fff 7px 11px)}}
.optbody{{flex:1}}
.opttitle{{font-size:15px;font-weight:600;color:#111B21}}
.optdesc{{font-size:12.5px;color:#667781;line-height:1.5;margin-top:3px}}

.grp{{margin-bottom:14px;padding-bottom:4px}}
.grplab{{font-size:14px;font-weight:700;color:#111B21;margin:0 0 8px;line-height:1.35}}
.grp .opt{{padding:9px 12px;margin-bottom:6px}}
.grp .opttitle{{font-size:13.5px}}

.talabel{{font-size:13px;font-weight:600;color:#111B21;margin:14px 0 6px}}
.ta{{border:1px solid #C4CDD5;border-radius:10px;padding:12px;min-height:96px;font-size:13.5px;
  color:#111B21;line-height:1.55}}
.ta.short{{min-height:58px}}
.tacount{{text-align:right;font-size:11.5px;color:#8696A0;margin-top:5px}}
.caret{{display:inline-block;width:1.5px;height:15px;background:{WAGREEN};vertical-align:-2px;margin-left:1px}}

/* Urdu */
.rtl{{direction:rtl;text-align:right;font-family:{URDU}}}
.rtl .h1{{line-height:1.6}}
.rtl .optdesc,.rtl .hint,.rtl .ta{{line-height:2;word-spacing:.15em}}
.rtl .opttitle{{line-height:1.7}}
.rtl .eyebrow{{letter-spacing:0}}
.foot{{margin-top:30px;color:#7f95b0;font-size:13px}}
"""


def page(kicker, title_html, sub, badges, cols, foot):
    b = "".join(f"<div class='badge'><b>{k}</b>{v}</div>" for k, v in badges)
    c = "".join(f"<div class='col'>{s}<div class='cap'>{cap}</div></div>" for s, cap in cols)
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>
<div class="kicker">{kicker}</div>
<h1 class="t">{title_html}</h1>
<div class="sub">{sub}</div>
<div class="badges">{b}</div>
<div class="row">{c}</div>
<div class="foot">{foot}</div>
</body></html>"""


# ── Variant A ──────────────────────────────────────────────────────────────
A = page(
    "bd-2712 · variant A",
    "One indicator per screen — <span class='hl'>full anchors visible</span>",
    "Each of the 5 OECD indicators gets its own screen, so all four anchor descriptions are on screen at "
    "the moment she chooses. Screens chain with Navigate (no server round-trip), so nothing is written "
    "until the final Submit — a half-finished rubric cannot exist.",
    [("Taps per teacher", "6 screens: pick → 5 indicators → comment"),
     ("Anchors", "Full Appendix A text under every option"),
     ("Writes", "One atomic save at the end"),
     ("Names", "Verbatim — never clipped by the 30-char label cap")],
    [(pick_screen('en'), "<b>1 · Pick teacher</b>roster from her school"),
     (ind_screen(INDICATORS[0], 'en', selected='4', n=1), "<b>2 · Indicator 1 of 5</b>full anchors, one tap"),
     (ind_screen(INDICATORS[1], 'ur', selected='3', n=2), "<b>Urdu · شعبہ 2 از 5</b>same screen, her language"),
     (comment_screen('en'), "<b>7 · Comment, then Submit</b>optional, 600-char Meta cap")],
    "Indicator names, anchors and scale labels verbatim from remark-rubric.js (Appendix A, NIETE leadership 2026-07-24). "
    "Flow chrome copy is new — the catalog's current strings are chat-shaped. 🌱 Rumi · NIETE")

# ── Variant B ──────────────────────────────────────────────────────────────
B = page(
    "bd-2712 · variant B",
    "All five on one screen — <span class='hl'>one submit, long scroll</span>",
    "A single screen holds all 5 radio groups plus the comment box: 12 components against Meta's 50-per-screen "
    "cap, so it fits comfortably. The cost is that anchor descriptions must be dropped to keep the scroll "
    "usable — she picks from the scale label alone, without the Appendix A wording in front of her.",
    [("Taps per teacher", "2 screens: pick → rate all five"),
     ("Anchors", "NOT shown — no room; scale label only"),
     ("Writes", "One atomic save, same as A"),
     ("Risk", "Scale words alone invite drift between principals")],
    [(dense_screen('en'), "<b>Rate all five (English)</b>scrolls ~1.5 screens"),
     (dense_screen('ur'), "<b>Rate all five (Urdu)</b>Nastaliq needs line-height 2")],
    "Same rubric data, same atomic write — the difference is purely whether the anchors are on screen. 🌱 Rumi · NIETE")

files = {}
for name, html in (('variant_A_five_screens', A), ('variant_B_one_screen', B)):
    p = os.path.join(OUT, name + '.html')
    open(p, 'w').write(html)
    files[name] = p
print(json.dumps(files))
