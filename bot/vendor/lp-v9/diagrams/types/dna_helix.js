// dna_helix — a double-helix ribbon: two strands wound around a shared axis,
// optionally carrying a real base sequence with Watson–Crick paired rungs.
// Registers as "dna_helix" (aliases "rna_helix", "nucleic_acid_helix", "helix")
// — kind is resolved from an explicit spec.kind, else from which alias was used,
// else sniffed from the sequence (a "U" and no "T" reads as RNA), else "dna".
//
// The geometry is a straight port of the math behind the matplotlib/numpy
// reference this was modelled on (svg_image_extraction/dna_libs/custom_helix.py):
// two sine waves 180° out of phase for the strands' x-position, cos(t) as a
// *simulated depth* (not a real 3D projection — it never moves a point in x,
// only how the stroke is painted) so the ribbon reads as twisting toward and
// away from the viewer. Ported natively to SVG rather than shelling out to
// Python/matplotlib: this engine's whole contract (see ../index.js) is pure and
// synchronous — no child process, no network. The one precedent (`circuit` +
// schemdraw) is opt-in and never the default path.
//
// Depth trick, translated: matplotlib faked it with a LineCollection whose
// per-segment linewidth/alpha follow depth, painted back-strand-then-front so
// alpha blending lets the "front" strand show through wherever the "back"
// strand's own segments are near-transparent. SVG's stroke-opacity does the same
// source-over compositing, so the same two-pass paint order (all of strand B,
// then all of strand A) with per-segment stroke-width/opacity reproduces it
// exactly — no per-segment z-sorting needed.
//
// Rung colour is the one place this deliberately does NOT mirror the reference
// script: the original alternates two arbitrary colours purely for visual
// rhythm. That is exactly the "rainbow labels" failure mode this engine's labels
// were fixed to avoid elsewhere (see bio_schematic.js, labelled_figure.js). So:
// with no sequence, every rung is ONE consistent colour (nothing to
// distinguish). With a sequence, each base gets a colour from a small FIXED
// 4-way legend (A/T·U/G/C) — a deliberate, deterministic category code, the same
// idea as the reactant/complex/product colouring in flow.js, not per-label
// variety for its own sake. The rung LABEL TEXT itself always renders in the one
// standard C.text colour.
//
// Two deliberate simplifications, checked against Watson–Crick base-pairing
// sources and confirmed acceptable for a grade 6-12 illustrative diagram rather
// than silently left out:
//   * No hydrogen-bond-count distinction. A-T/A-U pairs are really 2 H-bonds,
//     G-C is really 3 — every rung here uses the same width/opacity formula
//     regardless of base, varying only by depth. (One thing that IS correct
//     without trying: real base pairs are all the same physical width — a purine
//     always pairs with a pyrimidine — which is why rungs drawn at a fixed
//     length per t don't need to vary by base identity to be accurate there.)
//   * No antiparallel 5'/3' labelling on both strands. Real duplex strands run
//     in opposite directions; the caption names ONE strand's own direction
//     ("5′–SEQ–3′") but nothing in the drawing marks the second strand's ends,
//     so the antiparallel property is named, not shown.
// Same abstraction level as this engine's `atom` type (Bohr shells, not real
// electron orbitals) — a known, standard simplification, not an error.

const { Svg, C, SIZE } = require("../lib/svg");

const fin = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

const BASE_COLOR = { A: C.cool, T: C.clay, U: C.clay, G: C.leaf, C: C.plum };

function complementOf(base, kind) {
  switch (base) {
    case "A":
      return kind === "rna" ? "U" : "T";
    case "T":
    case "U":
      return "A";
    case "G":
      return "C";
    case "C":
      return "G";
    default:
      return "N";
  }
}

// Order matters and is pinned by an example: an explicit kind beats the alias,
// and the alias beats sniffing. Sniffing first would mean a "T" anywhere in the
// sequence silently rendered an `rna_helix` as DNA.
function resolveKind(spec, seq) {
  if (spec.kind === "dna" || spec.kind === "rna") return spec.kind;
  if (spec.type === "rna_helix") return "rna";
  const hasU = seq.includes("U");
  const hasT = seq.includes("T");
  if (hasU && !hasT) return "rna";
  if (hasT && !hasU) return "dna";
  return "dna";
}

function render(spec) {
  const seq = String(spec.sequence ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const hasSeq = seq.length > 0;
  const kind = resolveKind(spec, seq);

  // ~4-5 bases per turn keeps a long sequence's rungs from crowding; a short or
  // absent sequence falls back to the reference script's own 2.5 turns.
  const turns = fin(spec.turns, hasSeq ? Math.min(4, Math.max(1.5, seq.length / 4.5)) : 2.5);

  const bodyW = fin(spec.width, 250);
  const padT = 18;
  const padB = 18;
  const padX = 40; // room for rung labels to sit clear of the frame
  const plotW = bodyW - padX * 2;
  const ampPx = plotW / 2;
  const unitsPerTurn = 128;
  const plotH = Math.round(turns * unitsPerTurn);
  const bodyH = padT + plotH + padB;
  const cx = bodyW / 2;

  const Xpx = (xMath) => cx + xMath * ampPx;
  const Ypx = (yTurns) => padT + (yTurns / turns) * plotH;

  const kindLabel = kind === "rna" ? "RNA" : "DNA";
  const title = spec.title ?? `${kindLabel} double helix`;
  const caption =
    spec.caption ??
    (hasSeq
      ? `5′–${seq}–3′, paired by ${kind === "rna" ? "A–U and G–C" : "A–T and G–C"} base rules.`
      : "Two anti-parallel strands wound around a shared axis — illustrative shape, no sequence given.");

  const svg = new Svg(bodyW, bodyH, {
    title,
    caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  /* ---- strands: short segments; per-segment width/opacity encode depth ---- */
  const nSeg = Math.max(40, Math.min(220, Math.round(46 * turns)));
  function sampleStrand(phase) {
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const t = (i / nSeg) * turns * 2 * Math.PI;
      pts.push({
        x: Xpx(Math.sin(t + phase)),
        y: Ypx(t / (2 * Math.PI)),
        z: Math.cos(t + phase),
      });
    }
    return pts;
  }
  const strandA = sampleStrand(0);
  const strandB = sampleStrand(Math.PI);

  function drawStrand(pts, color) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const zn = ((p0.z + p1.z) / 2 + 1) / 2; // -1..1 -> 0..1
      svg.line(p0.x, p0.y, p1.x, p1.y, {
        stroke: color,
        sw: 1.5 + zn * 4.8,
        opacity: 0.45 + zn * 0.55,
        cap: "round",
      });
    }
  }

  /* ---- rungs: one per base with a sequence, else a decorative count ---- */
  const rungCount = hasSeq ? seq.length : Math.round(fin(spec.rungCount, 14));
  const marginT = 0.16 * 2 * Math.PI;
  const tSpan = turns * 2 * Math.PI - marginT * 2;

  function drawRungs() {
    for (let i = 0; i < rungCount; i++) {
      const t = marginT + (rungCount > 1 ? (i / (rungCount - 1)) * tSpan : tSpan / 2);
      const y = Ypx(t / (2 * Math.PI));
      const p1x = Xpx(Math.sin(t));
      const p2x = Xpx(Math.sin(t + Math.PI));
      const zn = (Math.cos(t) + 1) / 2;
      const sw = 2 + zn * 3;
      const op = 0.55 + zn * 0.45;
      const mx = (p1x + p2x) / 2;

      // A rung whose t lands near a strand crossing has p1x≈p2x — the halo line
      // then degenerates to a near-zero-length round-capped stroke, which
      // renders as a small solid dot sitting on the crossing rather than a halo
      // behind a line. Skip just the halo there; the (equally short) coloured
      // halves underneath don't have this problem, since they blend into the
      // crossing instead of standing out white against it.
      if (Math.abs(p2x - p1x) > 10) {
        svg.line(p1x, y, p2x, y, { stroke: C.paper, sw: sw + 2.4, opacity: 1, cap: "round" });
      }

      if (hasSeq) {
        const baseA = seq[i];
        const baseB = complementOf(baseA, kind);
        svg.line(p1x, y, mx, y, { stroke: BASE_COLOR[baseA] ?? C.muted, sw, opacity: op, cap: "round" });
        svg.line(mx, y, p2x, y, { stroke: BASE_COLOR[baseB] ?? C.muted, sw, opacity: op, cap: "round" });
        svg.plateText(mx, y, `${baseA}·${baseB}`, {
          size: SIZE.tiny,
          anchor: "middle",
          baseline: "middle",
          fill: C.text,
          padX: 2,
          padY: 1,
        });
      } else {
        svg.line(p1x, y, p2x, y, { stroke: C.accent, sw, opacity: op, cap: "round" });
      }
    }
  }

  // Paint order matters: back strand, then rungs, then front strand on top — see
  // the header comment for why per-segment opacity alone (not z-sorting) is what
  // makes this read correctly at every point along the twist.
  drawStrand(strandB, C.cool);
  drawRungs();
  drawStrand(strandA, C.ink);

  return svg.toString();
}

module.exports = {
  type: "dna_helix",
  aliases: ["rna_helix", "nucleic_acid_helix", "helix"],
  summary:
    'Double-helix ribbon — two anti-parallel strands wound around a shared axis, depth-shaded so the twist reads in 2D. With no sequence it is a decorative ribbon (same for dna_helix/rna_helix); given a real sequence (spec.sequence, e.g. "ATCGGA") each rung is labelled with its real base pair and coloured by base identity, and DNA vs RNA render distinguishably (T vs U, A-T/A-U pairing).',
  render,
  examples: [
    {
      name: "dna_helix_decorative",
      spec: {
        type: "dna_helix",
        title: "The double-helix shape",
        caption: "No sequence given — the twisting-ribbon shape only.",
      },
    },
    {
      name: "dna_helix_sequence",
      spec: {
        type: "dna_helix",
        sequence: "ATCGGA",
        caption: null,
      },
    },
    {
      name: "rna_helix_sequence",
      spec: {
        type: "rna_helix",
        sequence: "AUCGGA",
        caption: null,
      },
    },
    {
      // Regression pin (found in review): resolveKind() used to sniff the
      // sequence BEFORE checking the "rna_helix" alias, so a T anywhere in the
      // sequence made this render as DNA regardless of which alias was used to
      // invoke it — the alias could never win once sniffing had returned. Every
      // other example here uses "AUCGGA", which is exactly why that bug stayed
      // invisible. This one deliberately pairs the RNA alias with a T-bearing
      // sequence so a regression fails loudly.
      name: "rna_helix_alias_wins_over_sniff",
      spec: {
        type: "rna_helix",
        sequence: "ATCGGA",
        title: "RNA double helix (alias overrides a T in the sequence)",
        caption: null,
      },
    },
  ],
};
