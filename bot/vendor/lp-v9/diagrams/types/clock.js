// clock — an analogue face with hands. Telling the time, and only that.
//
// THE TIME IS NOT WRITTEN ON THE PICTURE. A digital caption would answer the
// question the picture exists to ask, so `digital` is off by default and the
// upstream leak rule sees the caption if anyone turns it on.
//
// Hand geometry is the part a hand-drawn clock always gets wrong and a
// deterministic one must not: at 3:30 the hour hand is HALFWAY between 3 and 4,
// not on the 3. The hour hand angle is (h % 12 + m/60) * 30 degrees. A child
// asked to read 3:30 off a clock whose hour hand points at 3 is being taught
// something false.
//
// Spec
//   time      "3:30" | "15:30"      required; 24h is folded onto the 12h dial
//   numerals  "quarters" (default) | "all" | "none"
//   minuteTicks  true (default)     the 60 small marks
//   digital   false (default)       print the time under the face — a leak
//   lang      "en" | "ur"
//
// Numerals stay LATIN digits in both languages, deliberately: the quiz lane's
// own rule is that numerals, units and formulae read left-to-right even in an
// Urdu figure, and an Urdu digit on this engine goes through a foreignObject
// whose box is wider than the gap between two hour marks.

const { Svg, C, SIZE } = require("../lib/svg");

const HOUR_LABEL = { 12: "12", 3: "3", 6: "6", 9: "9" };

function parseTime(s) {
  const m = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(String(s ?? ""));
  if (!m) throw new Error(`clock: \`time\` must look like "3:30" (got ${JSON.stringify(s)})`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new Error(`clock: "${s}" is not a real time`);
  return { h: h % 12, m: mi };
}

function render(spec) {
  const { h, m } = parseTime(spec.time);
  const R = spec.radius ?? 168;
  const PAD = 16;
  const numerals = ["all", "none", "quarters"].includes(spec.numerals) ? spec.numerals : "quarters";
  const size = Math.max(SIZE.big, R * 0.16);
  const bodyW = (R + PAD) * 2;
  const digital = spec.digital === true;
  const bodyH = (R + PAD) * 2 + (digital ? size * 2.2 : 0);
  const cx = R + PAD;
  const cy = R + PAD;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: spec.lang === "ur" ? "ur" : "en", spec,
  });

  svg.circle(cx, cy, R, { fill: C.paper, stroke: C.ink, sw: 3.2 });

  const at = (deg, r) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];

  if (spec.minuteTicks !== false) {
    for (let i = 0; i < 60; i += 1) {
      if (i % 5 === 0) continue;
      const [x1, y1] = at(i * 6, R * 0.94);
      const [x2, y2] = at(i * 6, R * 0.99);
      svg.line(x1, y1, x2, y2, { stroke: C.rule, sw: 1.6 });
    }
  }
  for (let i = 0; i < 12; i += 1) {
    const [x1, y1] = at(i * 30, R * 0.88);
    const [x2, y2] = at(i * 30, R * 0.99);
    svg.line(x1, y1, x2, y2, { stroke: C.ink, sw: 3 });
  }

  // Numerals sit at 0.7R and the hands stop well inside them — 0.42R for the
  // hour, 0.56R for the minute. Two reasons, both learned by looking: a hand
  // that reaches the numeral ring covers the very numeral it is pointing at
  // (and, at some times, collides with it), and a child tells the two hands
  // apart by LENGTH before anything else, so the difference has to be obvious
  // rather than the 0.52/0.66 that read as the same stick twice.
  if (numerals !== "none") {
    for (let i = 1; i <= 12; i += 1) {
      const label = numerals === "all" ? String(i) : HOUR_LABEL[i];
      if (!label) continue;
      const [x, y] = at(i * 30, R * 0.7);
      svg.text(x, y, label, { size, weight: 700, anchor: "middle", baseline: "middle", fill: C.ink });
    }
  }

  const minuteDeg = m * 6;
  const hourDeg = ((h % 12) + m / 60) * 30;
  const [hx, hy] = at(hourDeg, R * 0.42);
  const [mx, my] = at(minuteDeg, R * 0.56);
  svg.line(cx, cy, hx, hy, { stroke: C.ink, sw: 7.5, cap: "round" });
  svg.line(cx, cy, mx, my, { stroke: C.accent, sw: 5, cap: "round" });
  svg.circle(cx, cy, 7.5, { fill: C.ink });

  if (digital) {
    svg.text(cx, (R + PAD) * 2 + size * 1.4, `${h === 0 ? 12 : h}:${String(m).padStart(2, "0")}`, {
      size, weight: 700, anchor: "middle", fill: C.ink,
    });
  }
  return svg.toString();
}

module.exports = {
  type: "clock",
  aliases: ["analogue_clock", "clock_face", "telling_time"],
  summary: "An analogue clock face with correctly-geared hour and minute hands — telling the time.",
  render,
  examples: [
    { name: "clock_330_en", spec: { type: "clock", time: "3:30" } },
    { name: "clock_915_all_ur", spec: { type: "clock", time: "9:15", numerals: "all", lang: "ur" } },
  ],
};
