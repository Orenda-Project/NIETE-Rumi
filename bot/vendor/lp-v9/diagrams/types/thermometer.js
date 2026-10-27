// thermometer — 1-4 upright Celsius thermometers side by side, each a tube and bulb on a numbered scale.
//
// bd-yggj4o.1 (Amena, 8 Oct: "pictures for Maths - we should create them, words wont do"). G2 ch11 and G3 ch11
// teach reading and comparing temperatures; lessons drew a numberline instead and its labels piled up.
//
// Spec
//   thermometers  1-4 of {value, name}: value in [min, max] (omit with blank: true); name prints under it
//   min, max, step  the scale; step must divide max - min. minor (optional): unlabelled ticks every `minor`
//   unit (default "°C"), showValue (print the reading under each), blank (no red column: a "shade to" item)

const { Svg, C, SIZE } = require("../lib/svg");

const TUBE_W = 16;
const BULB_R = 15;
const SLOT = 120;
const SCALE_H_MAX = 230;

function check(spec) {
  const ts = Array.isArray(spec.thermometers) ? spec.thermometers : [];
  if (ts.length < 1 || ts.length > 4) throw new Error("thermometer: needs 1-4 thermometers");
  const min = Number(spec.min ?? 0), max = Number(spec.max);
  if (!(max > min)) throw new Error("thermometer: max must be above min");
  const step = Number(spec.step);
  const n = (max - min) / step;
  if (!(step > 0) || Math.abs(n - Math.round(n)) > 1e-9 || n > 12) {
    throw new Error("thermometer: step must divide max - min into at most 12 parts");
  }
  if (!spec.blank) {
    ts.forEach((t, i) => {
      if (!(t.value >= min && t.value <= max)) throw new Error(`thermometer: value ${t.value} (#${i + 1}) is outside ${min}-${max}`);
    });
  }
  return { ts, min, max, step };
}

function render(spec) {
  const { ts, min, max, step } = check(spec);
  const unitLabel = spec.unit || "°C";
  const minor = Number(spec.minor) > 0 && Number(spec.minor) < step ? Number(spec.minor) : 0;
  const unit = SCALE_H_MAX / (max - min);
  const TOP = 34, scaleH = unit * (max - min);
  const nameH = ts.some((t) => t.name) || spec.showValue ? 56 : 14;
  const bodyW = SLOT * ts.length + 48;
  const bodyH = TOP + scaleH + 14 + BULB_R * 2 + nameH;
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note, lang: spec.lang === "ur" ? "ur" : "en", spec,
  });
  const yOf = (v) => TOP + scaleH - (v - min) * unit;
  const yBase = TOP + scaleH + 14;
  ts.forEach((t, i) => {
    const cx = 20 + SLOT * i + SLOT / 2 + 14;
    const xl = cx - TUBE_W / 2, xr = cx + TUBE_W / 2;
    const yTop = TOP - 12;
    svg.add(`<rect x="${xl}" y="${yTop}" width="${TUBE_W}" height="${(yBase - yTop).toFixed(1)}" rx="${TUBE_W / 2}" fill="${C.paper}" stroke="${C.ink}" stroke-width="2"/>`);
    if (!spec.blank) {
      const yv = yOf(t.value);
      svg.add(`<rect data-fill="${String(t.name ?? i + 1).replace(/"/g, "&quot;")}" x="${(xl + 4).toFixed(1)}" y="${yv.toFixed(1)}" width="${TUBE_W - 8}" height="${((t.value - min) * unit).toFixed(1)}" fill="#d64545"/>`);
      svg.rect(xl + 4, yOf(min), TUBE_W - 8, yBase - yOf(min), { fill: "#d64545", stroke: "none" }); // stem into the bulb
    }
    svg.circle(cx, yBase + BULB_R - 2, BULB_R, { stroke: C.ink, sw: 2, fill: spec.blank ? C.paper : "#d64545" });
    for (let v = min; v <= max + 1e-9; v += step) {
      const y = yOf(v);
      svg.line(xl - 12, y, xl, y, { stroke: C.ink, sw: 1.6 });
      svg.text(xl - 16, y + 5, String(+v.toFixed(2)), { size: SIZE.small, anchor: "end", fill: C.ink });
    }
    if (minor) {
      for (let v = min; v < max - 1e-9; v += step) {
        for (let m = v + minor; m < v + step - 1e-9; m += minor) {
          const y = yOf(m);
          svg.add(`<line data-tick="minor" x1="${(xl - 6).toFixed(1)}" y1="${y.toFixed(1)}" x2="${xl}" y2="${y.toFixed(1)}" stroke="${C.ink}" stroke-width="1"/>`);
        }
      }
    }
    if (i === 0) svg.text(xl - 16, TOP - 16, unitLabel, { size: SIZE.small, weight: 700, anchor: "end", fill: C.ink });
    let ny = yBase + BULB_R * 2 + 22;
    if (t.name) { svg.text(cx, ny, t.name, { size: SIZE.label, weight: 700, anchor: "middle", fill: C.ink }); ny += 24; }
    if (spec.showValue && !spec.blank) svg.text(cx, ny, `${t.value}${unitLabel}`, { size: SIZE.label, anchor: "middle", fill: C.ink });
  });
  return svg.toString();
}

module.exports = {
  type: "thermometer",
  aliases: ["thermometers"],
  summary: "1-4 Celsius thermometers on a numbered scale: read, compare, or blank:true to shade a given temperature.",
  render,
  examples: [
    {
      name: "thermometer_compare_three",
      spec: { type: "thermometer", min: 0, max: 50, step: 10, minor: 2,
        thermometers: [{ value: 33, name: "A" }, { value: 29, name: "B" }, { value: 45, name: "C" }] },
    },
    {
      name: "thermometer_one_shown",
      spec: { type: "thermometer", min: 0, max: 40, step: 10, minor: 1, showValue: true, thermometers: [{ value: 25 }] },
    },
    {
      name: "thermometer_blank",
      spec: { type: "thermometer", min: 0, max: 50, step: 10, minor: 2, blank: true, thermometers: [{ name: "Shade to 30°C" }] },
    },
  ],
};
