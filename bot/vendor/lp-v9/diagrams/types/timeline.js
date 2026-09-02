// timeline — a dated spine with events, in two orientations.
//
// Horizontal: a rule with tick markers, dates above and labels below; when the
// labels are too wide for their slot the whole date+label pair alternates above
// and below the rule, which is what keeps a five-event century readable at LP
// column width. Vertical: a spine with the date in a chip and the label beside
// it — the layout to prefer for more than five events or for any long label.
//
// Layout invariants:
//   * orientation is chosen from the measured labels when the spec omits it
//   * era bands are drawn BEHIND the events, never over their text
//   * lang:'ur' runs the horizontal spine right-to-left (event 1 at the right
//     edge) and moves the vertical spine to the RIGHT with labels to its left

const { Svg, C, SIZE, LEADING, measure, wrap, hasUrdu } = require("../lib/svg");
const { SERIES } = require("../lib/tokens");

const isUr = (lang, s) => hasUrdu(String(s ?? ""));  // script decides, not the declared lang

// measure() carries a Nastaliq average of 0.40em/char; rendered Noto Nastaliq
// runs up to ~35% wider, and under-estimating drops text out of its box.
const UR_PAD = 1.35;
const tw = (s, size, o = {}) =>
  isUr(o.lang, s) ? measure(s, size, { lang: "ur" }) * UR_PAD : measure(s, size, o);

function blockH(s, size, w, lang) {
  if (s === undefined || s === null || s === "") return 0;
  if (isUr(lang, s)) {
    const nl = Math.max(1, Math.ceil(tw(s, size, { lang: "ur" }) / Math.max(20, w - 6)));
    return nl * size * LEADING.urdu + size * 0.45;
  }
  // measure BOLD: reserving the wider case is free, while under-reserving wraps
  // an extra line at draw time and the block spills out of the box kept for it
  return wrap(String(s), size, w, { weight: 700 }).length * size * LEADING.latin;
}

/** Draw a block with its TOP edge at y and the given anchor. Returns the height. */
function drawBlock(svg, x, y, w, s, o) {
  const h = blockH(s, o.size, w, o.lang);
  if (!h) return 0;
  if (isUr(o.lang, s)) {
    svg.text(x, y + h / 2, s, { ...o, baseline: "middle", w, h, lang: "ur" });
  } else {
    const lines = wrap(String(s), o.size, w, o);
    const lh = o.size * LEADING.latin;
    lines.forEach((ln, i) => svg.text(x, y + o.size * 0.82 + i * lh, ln, { ...o, lang: "en" }));
  }
  return h;
}

/** Resolve an era endpoint to an event index. */
function resolveIdx(v, events, fallback) {
  if (Number.isInteger(v) && v >= 0 && v < events.length) return v;
  if (typeof v === "string") {
    const k = events.findIndex((e) => String(e.date) === v);
    if (k >= 0) return k;
  }
  return fallback;
}

function render(spec) {
  const ur = spec.lang === "ur";
  const events = (Array.isArray(spec.events) ? spec.events : []).filter(Boolean);
  const list = events.length ? events : [{ date: "", label: "" }];
  const bodyW = spec.width || 656;
  const M = 6;

  const SZ = {
    date: ur ? 15 : 13.5,
    label: ur ? 14 : SIZE.small,
    detail: ur ? 13 : SIZE.tiny,
    era: ur ? 13 : SIZE.tiny,
  };
  const colourOf = (e, i) => e.color || SERIES[i % SERIES.length];

  // orientation: honour the spec, else pick from the measured labels
  const widest = Math.max(0, ...list.map((e) => tw(e.label, SZ.label, { lang: spec.lang })));
  const orientation =
    spec.orientation === "vertical" || spec.orientation === "horizontal"
      ? spec.orientation
      : list.length > 5 || widest > 150 || list.some((e) => e.detail)
        ? "vertical"
        : "horizontal";

  const eras = (Array.isArray(spec.eras) ? spec.eras : [])
    .filter(Boolean)
    .map((e, k) => ({
      label: e.label ?? "",
      color: e.color || SERIES[(k + 3) % SERIES.length],
      a: resolveIdx(e.from, list, 0),
      b: resolveIdx(e.to, list, list.length - 1),
    }))
    .map((e) => ({ ...e, a: Math.min(e.a, e.b), b: Math.max(e.a, e.b) }));

  /* ------------------------------------------------------------------ */
  /* vertical                                                            */
  /* ------------------------------------------------------------------ */
  if (orientation === "vertical") {
    const chipPadX = 9;
    const chipW = Math.min(
      170,
      Math.max(
        52,
        ...list.map((e) => Math.ceil(tw(e.date, SZ.date, { weight: 700, lang: spec.lang })) + chipPadX * 2)
      )
    );
    const spineX = ur ? bodyW - M - chipW - 18 : M + chipW + 18;
    const labelX = ur ? spineX - 18 : spineX + 18;
    const labelW = ur ? labelX - M - 2 : bodyW - labelX - M - 2;
    const anchor = ur ? "end" : "start";

    const rows = [];
    let y = 4;
    list.forEach((e, i) => {
      const openers = eras.filter((er) => er.a === i);
      if (openers.length) y += 20 * openers.length;
      const chipH = Math.max(24, blockH(e.date, SZ.date, chipW - chipPadX * 2, spec.lang) + 11);
      const lh = blockH(e.label, SZ.label, labelW, spec.lang);
      const dh = e.detail ? 3 + blockH(e.detail, SZ.detail, labelW, spec.lang) : 0;
      const h = Math.max(chipH, lh + dh);
      rows.push({ e, i, y, h, chipH, lh, dh, top: y });
      y += h + 16;
    });
    const bodyH = Math.max(40, y - 16 + 6);

    const svg = new Svg(bodyW, bodyH, {
      title: spec.title,
      caption: spec.caption,
      source: spec.source,
      note: spec.note,
      lang: spec.lang,
      spec,
    });

    // era bands, behind everything
    eras.forEach((er) => {
      const first = rows[Math.min(er.a, rows.length - 1)];
      const last = rows[Math.min(er.b, rows.length - 1)];
      const top = first.top - 20;
      const bot = last.top + last.h + 6;
      svg.rect(M, top, bodyW - M * 2, bot - top, { rx: 7, fill: er.color, opacity: 0.09 });
      // The label sits in the LABEL column, not the left margin: at the far left
      // it would be crossed by the spine on any era that does not start the map.
      svg.text(labelX, top + SZ.era * 1.15, er.label, {
        size: SZ.era,
        weight: 700,
        anchor,
        fill: er.color,
        lang: spec.lang,
        w: tw(er.label, SZ.era, { weight: 700, lang: spec.lang }) + 8,
      });
    });

    // spine
    const firstDot = rows[0].y + rows[0].chipH / 2;
    const lastDot = rows[rows.length - 1].y + rows[rows.length - 1].chipH / 2;
    svg.line(spineX, firstDot, spineX, lastDot, { stroke: C.rule, sw: 3, cap: "round" });

    rows.forEach((r) => {
      const colour = colourOf(r.e, r.i);
      const dotY = r.y + r.chipH / 2;
      // date chip
      const chipX = ur ? spineX + 18 : spineX - 18 - chipW;
      svg.rect(chipX, r.y, chipW, r.chipH, { rx: 6, fill: colour, opacity: 0.13 });
      svg.text(chipX + chipW / 2, dotY, r.e.date, {
        size: SZ.date,
        weight: 700,
        anchor: "middle",
        baseline: "middle",
        fill: colour,
        lang: spec.lang,
        w: chipW - 8,
        h: r.chipH - 4,
      });
      // marker
      svg.circle(spineX, dotY, 5.5, { fill: C.paper, stroke: colour, sw: 2.4 });
      // label + detail
      let ly = r.y + Math.max(0, (r.chipH - (r.lh + r.dh)) / 2);
      ly += drawBlock(svg, labelX, ly, labelW, r.e.label, {
        size: SZ.label,
        anchor,
        fill: C.text,
        lang: spec.lang,
      });
      if (r.e.detail) {
        ly += 3;
        drawBlock(svg, labelX, ly, labelW, r.e.detail, {
          size: SZ.detail,
          anchor,
          fill: C.muted,
          italic: true,
          lang: spec.lang,
        });
      }
    });

    return svg.toString();
  }

  /* ------------------------------------------------------------------ */
  /* horizontal                                                          */
  /* ------------------------------------------------------------------ */
  const n = list.length;
  // A centred label is `colW` wide, so the first and last events must sit at
  // least colW/2 + M in from the edge or their text is sliced off by the
  // viewBox. Solving sidePad = colW/2 + M for the two slot widths gives the
  // closed forms below; anything less clipped "Muslim League founded, Dhaka"
  // down to "eague founded, Dhaka" on the very first render.
  const LEAD = 14; // breathing room between adjacent slots
  const free = bodyW + LEAD - 2 * M;
  //   uncrowded: colW = step - LEAD,     sidePad = colW/2 + M  =>  step = free/n
  //   crowded:   colW = 2*step - LEAD,   sidePad = colW/2 + M  =>  step = free/(n+1)
  let step = n > 1 ? free / n : 0;
  const crowded = n > 1 && list.some((e) => tw(e.label, SZ.label, { lang: spec.lang }) > step - 12);
  if (crowded) step = free / (n + 1);
  const colW = Math.max(76, (crowded ? step * 2 : step) - LEAD);
  const sidePad = n > 1 ? Math.max(24, (bodyW - step * (n - 1)) / 2) : bodyW / 2;
  const xAt = (i) => {
    const t = n > 1 ? sidePad + step * i : bodyW / 2;
    return ur ? bodyW - t : t;
  };

  const parts = list.map((e, i) => {
    const dateH = blockH(e.date, SZ.date, colW, spec.lang);
    const labelH = blockH(e.label, SZ.label, colW, spec.lang);
    const above = crowded ? (i % 2 === 0 ? dateH + 3 + labelH : 0) : dateH;
    const below = crowded ? (i % 2 === 0 ? 0 : dateH + 3 + labelH) : labelH;
    return { e, i, dateH, labelH, above, below, up: crowded ? i % 2 === 0 : true };
  });

  const gapS = 15;
  const eraH = eras.length ? 26 : 0;
  const aboveMax = Math.max(0, ...parts.map((p) => p.above));
  const belowMax = Math.max(0, ...parts.map((p) => p.below));
  const spineY = 4 + aboveMax + gapS + eraH;
  const bodyH = spineY + gapS + belowMax + 6;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  // era ribbon, above the rule and behind nothing
  eras.forEach((er) => {
    const xa = xAt(Math.min(er.a, n - 1));
    const xb = xAt(Math.min(er.b, n - 1));
    const x0 = Math.max(M, Math.min(xa, xb) - 12);
    const x1 = Math.min(bodyW - M, Math.max(xa, xb) + 12);
    const top = spineY - eraH - 8;
    svg.rect(x0, top, x1 - x0, eraH, { rx: 5, fill: er.color, opacity: 0.12 });
    svg.text((x0 + x1) / 2, top + eraH / 2, er.label, {
      size: SZ.era,
      weight: 700,
      anchor: "middle",
      baseline: "middle",
      fill: er.color,
      lang: spec.lang,
      w: x1 - x0 - 8,
      h: eraH - 4,
    });
  });

  // the rule itself, with an arrowhead in the reading direction
  const x0 = ur ? bodyW - M : M;
  const x1 = ur ? M : bodyW - M;
  svg.line(x0, spineY, x1, spineY, { stroke: C.rule, sw: 3, cap: "round" });
  svg.head(x1, spineY, ur ? -1 : 1, 0, { stroke: C.faint, size: 10 });

  parts.forEach((p) => {
    const x = xAt(p.i);
    const colour = colourOf(p.e, p.i);
    svg.line(x, spineY - 7, x, spineY + 7, { stroke: colour, sw: 2 });
    svg.circle(x, spineY, 5.5, { fill: C.paper, stroke: colour, sw: 2.4 });

    if (crowded) {
      if (p.up) {
        let y = spineY - gapS - eraH - p.above;
        y += drawBlock(svg, x, y, colW, p.e.date, {
          size: SZ.date,
          weight: 700,
          anchor: "middle",
          fill: colour,
          lang: spec.lang,
        });
        y += 3;
        drawBlock(svg, x, y, colW, p.e.label, {
          size: SZ.label,
          anchor: "middle",
          fill: C.text,
          lang: spec.lang,
        });
      } else {
        let y = spineY + gapS;
        y += drawBlock(svg, x, y, colW, p.e.date, {
          size: SZ.date,
          weight: 700,
          anchor: "middle",
          fill: colour,
          lang: spec.lang,
        });
        y += 3;
        drawBlock(svg, x, y, colW, p.e.label, {
          size: SZ.label,
          anchor: "middle",
          fill: C.text,
          lang: spec.lang,
        });
      }
    } else {
      drawBlock(svg, x, spineY - gapS - eraH - p.dateH, colW, p.e.date, {
        size: SZ.date,
        weight: 700,
        anchor: "middle",
        fill: colour,
        lang: spec.lang,
      });
      drawBlock(svg, x, spineY + gapS, colW, p.e.label, {
        size: SZ.label,
        anchor: "middle",
        fill: C.text,
        lang: spec.lang,
      });
    }
  });

  return svg.toString();
}

module.exports = {
  type: "timeline",
  aliases: ["chronology"],
  summary: "Dated spine with events — horizontal rule or vertical chip-and-label, optional era bands.",
  render,
  examples: [
    {
      name: "timeline_pakistan_movement",
      spec: {
        type: "timeline",
        orientation: "horizontal",
        title: "FIVE DATES ON THE ROAD TO 1947",
        events: [
          { date: "1906", label: "Muslim League founded, Dhaka" },
          { date: "1930", label: "Allahabad Address" },
          { date: "1940", label: "Lahore Resolution" },
          { date: "1946", label: "Cabinet Mission Plan" },
          { date: "1947", label: "Pakistan, 14 August" },
        ],
        caption: "Forty-one years from a political party to a country. Note the gap between 1906 and 1940.",
      },
    },
    {
      name: "timeline_constitutions_vertical",
      spec: {
        type: "timeline",
        orientation: "vertical",
        title: "HOW PAKISTAN GOT ITS CONSTITUTION",
        events: [
          {
            date: "1947",
            label: "Independence on 14 August. The Government of India Act 1935 is kept on as an interim constitution.",
            detail: "borrowed rules, not our own",
          },
          {
            date: "1956",
            label: "The first Constitution is adopted on 23 March and Pakistan becomes an Islamic Republic.",
          },
          {
            date: "1962",
            label: "The second Constitution replaces it with a presidential system.",
          },
          {
            date: "1973",
            label: "An elected assembly frames the 1973 Constitution, in force from 14 August. It is still the one we use.",
            detail: "the constitution in force today",
          },
          {
            date: "2010",
            label: "The Eighteenth Amendment moves major subjects, including school education, to the provinces.",
          },
        ],
        eras: [{ from: 0, to: 2, label: "SEARCHING FOR A SETTLEMENT" }, { from: 3, to: 4, label: "THE 1973 ORDER" }],
        caption: "Three constitutions in twenty-six years, then one that has lasted fifty.",
      },
    },
    {
      name: "timeline_urdu_rtl",
      spec: {
        type: "timeline",
        lang: "ur",
        orientation: "horizontal",
        title: "چار تاریخیں",
        events: [
          { date: "۱۹۰۶", label: "مسلم لیگ کا قیام" },
          { date: "۱۹۴۰", label: "قرارداد لاہور" },
          { date: "۱۹۴۷", label: "قیام پاکستان" },
          { date: "۱۹۷۳", label: "آئین پاکستان" },
        ],
        caption: "تاریخ دائیں سے بائیں پڑھیں",
      },
    },
  ],
};
