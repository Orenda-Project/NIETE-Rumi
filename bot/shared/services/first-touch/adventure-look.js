'use strict';
/**
 * The adventure look ("Explorer's Map") for the first pages a child sees: the role question, the "Is it <First>?" sheet,
 * the join screen and the way-back pages. Switch `web_quiz_adventure_look` (app_settings, JSON true only, default OFF),
 * drawn only while the one button system (`web_quiz_one_button`, JSON true only) is on too: the look paints the one
 * button's classes, so without it there is no look. Either OFF → every page is today's, byte for byte.
 *
 * TOKENS_CSS is the shared token layer of record, copied with its comments left out (a test pins its sha256).
 * Everything in it is scoped to `html.wq-adv`, so it matches nothing while the class is absent. These pages inline their
 * CSS (no stylesheet link), so the layer is inlined too; when the child pages ship one shared stylesheet, this is the
 * one place to point at it.
 */
const ADV_KEY = 'web_quiz_adventure_look';
const ONE_BUTTON_KEY = 'web_quiz_one_button';
/** Both keys, for the caller's existing settings read (`.in('key', [...theirs, ...KEYS])`): no read is added. */
const KEYS = Object.freeze([ADV_KEY, ONE_BUTTON_KEY]);
/** The stored value → ON only for JSON true (the string 'true', 1, 'yes' are all OFF). */
const advOn = (value) => value === true;
/** {key: stored value} → the look is drawn: both switches JSON true. */
const advDrawn = (by) => Boolean(by) && advOn(by[ADV_KEY]) && advOn(by[ONE_BUTTON_KEY]);
const TOKENS_CSS = "html.wq-adv{\n  --ground:#fbf3dc;--card:#fffdf6;--line:#e6d6ae;--tint:#fff1c9;\n  --muted:#6d6450;\n  --paper:var(--ground);--paper-2:var(--tint);\n  --gold:#ffc83a;--gold-d:#b28c29;--star:#ffb000;--star-off:#e6d6ae;--glow:rgba(255,200,58,.55);\n  --land-st:#e97f2e;--land-st-bg:#ffe7cf;--land-st-edge:#a35920;--land-st-on:var(--ink);\n  --land-gm:#3a9d4f;--land-gm-bg:#dff3d9;--land-gm-edge:#296e37;--land-gm-on:#ffffff;\n  --land-vd:#2a86de;--land-vd-bg:#dcefff;--land-vd-edge:#1d5e9b;--land-vd-on:#ffffff;\n  --land-sp:#8e5bd8;--land-sp-bg:#efe5ff;--land-sp-edge:#634097;--land-sp-on:#ffffff;\n  --land:var(--gold);--land-bg:var(--tint);--land-edge:var(--gold-d);--land-on:var(--ink);\n  --fs-1:13px;--fs-2:15px;--fs-3:17px;--fs-4:20px;--fs-5:24px;--fs-6:30px;\n  --lh:1.35;\n  --gutter:16px;\n  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--sp-6:32px;\n  --r-btn:999px;--r-card:22px;--r-chip:14px;\n  --edge:var(--land-edge);\n  --sh-btn:0 4px 0 var(--edge);\n  --sh-btn-soft:0 3px 0 var(--line);\n  --sh-card:0 4px 0 var(--line);\n  --sh-press:0 0 0 var(--edge);\n  --press-y:4px;\n  --tap:48px;--btn-h:56px;--btn-h2:52px;\n  --btn-fs:20px;--btn-fs2:17px;--btn-fs-ur:22px;--btn-fs2-ur:19px;\n  --dur-tap:90ms;--dur-pop:220ms;--dur-celebrate:900ms;--dur-shimmer:1.4s;--dur-bob:1.6s;\n  --ease-pop:cubic-bezier(.34,1.56,.64,1);\n  --stamp-delay:300ms;\n  --hold-steps:linear;\n}\nhtml.wq-adv[lang=ur]{\n  --fs-1:15px;--fs-2:17px;--fs-3:19px;--fs-4:22px;--fs-5:26px;--fs-6:32px;\n  --lh:2;\n}\nhtml.wq-adv [data-land=stories]{--land:var(--land-st);--land-bg:var(--land-st-bg);--land-edge:var(--land-st-edge);--land-on:var(--land-st-on)}\nhtml.wq-adv [data-land=games]{--land:var(--land-gm);--land-bg:var(--land-gm-bg);--land-edge:var(--land-gm-edge);--land-on:var(--land-gm-on)}\nhtml.wq-adv [data-land=videos]{--land:var(--land-vd);--land-bg:var(--land-vd-bg);--land-edge:var(--land-vd-edge);--land-on:var(--land-vd-on)}\nhtml.wq-adv .wq-btn--st{--land:var(--land-st);--land-edge:var(--land-st-edge);--land-on:var(--land-st-on)}\nhtml.wq-adv .wq-btn--gm{--land:var(--land-gm);--land-edge:var(--land-gm-edge);--land-on:var(--land-gm-on)}\nhtml.wq-adv .wq-btn--vd{--land:var(--land-vd);--land-edge:var(--land-vd-edge);--land-on:var(--land-vd-on)}\nhtml.wq-adv .wq-btn--primary{--fill:var(--land);--on:var(--land-on);--edge:var(--land-edge)}\nhtml.wq-adv .wq-btn--secondary,\nhtml.wq-adv .wq-btn--icon,\nhtml.wq-adv .wq-btn--home,\nhtml.wq-adv .wq-btn--hold{--fill:var(--card);--on:var(--ink);--edge:var(--line)}\nhtml.wq-adv .wq-btn{--sh-btn:0 4px 0 var(--edge);--sh-press:0 0 0 var(--edge)}\n@media (prefers-reduced-motion:reduce){\n  html.wq-adv{--dur-tap:0ms;--dur-pop:0ms;--dur-celebrate:0ms;--dur-shimmer:0ms;--dur-bob:0ms;--stamp-delay:0ms;--hold-steps:steps(4)}\n}\n";
module.exports = { ADV_KEY, ONE_BUTTON_KEY, KEYS, advOn, advDrawn, TOKENS_CSS };
