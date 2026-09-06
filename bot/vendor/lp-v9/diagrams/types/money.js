// money — coins and notes as labelled discs and rectangles.
//
// Grade 1-3 money is three different questions and this type serves all three:
// identify a denomination, add a handful up, or make a target from smaller
// pieces. It is DRAWN, never illustrated: a disc with its value struck on it
// and a rectangle with its value printed on it are what a coin and a note ARE
// to a child learning them, and drawing them abstractly is also the only way to
// stay clear of reproducing a real banknote.
//
// THE VALUE IS PRINTED ON THE PIECE, and that is correct — it is printed on the
// real thing. It means the picture DOES say the answer to "which one is 5
// rupees", and it should: the upstream leak rule then rejects that question,
// which is the right outcome. The questions this type earns are the ones where
// the answer is not on any single piece — the total, the count of pieces, the
// swap.
//
// Currency is a SYMBOL the caller supplies (`currency`, default "Rs"), never a
// hardcoded country: this engine serves several markets.
//
// Spec
//   items     [{value:10, kind:"coin"|"note", count:2}, …]   required
//   currency  "Rs"          the unit written beside each value
//   perRow    5
//   lang      "en" | "ur"

const { Svg, C, SIZE, measure } = require("../lib/svg");

const MAX_PIECES = 12;

function render(spec) {
  const isUr = spec.lang === "ur";
  const raw = Array.isArray(spec.items) ? spec.items : [];
  if (!raw.length) throw new Error("money: `items` needs at least one coin or note");
  const pieces = [];
  raw.forEach((it) => {
    const value = Number(it && it.value);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`money: a piece needs a positive \`value\` (got ${JSON.stringify(it && it.value)})`);
    const kind = it.kind === "note" ? "note" : "coin";
    const count = Math.max(1, Math.floor(Number(it.count) || 1));
    for (let i = 0; i < count; i += 1) pieces.push({ value, kind });
  });
  if (pieces.length > MAX_PIECES) throw new Error(`money: ${pieces.length} pieces is past counting; keep it to ${MAX_PIECES}`);

  const currency = spec.currency == null ? "Rs" : String(spec.currency);
  const size = Math.max(SIZE.big, 26);
  const GAP = 20;
  const PAD = 18;
  const perRow = Math.max(1, Math.floor(Number(spec.perRow) || Math.min(4, pieces.length)));

  // EVERY DIMENSION IS DERIVED FROM THE TEXT, not from a constant beside it.
  // The first draft laid the pieces out on a fixed 108/172-unit grid and let a
  // coin's radius grow to fit "Rs 20" — so at a larger type size the discs
  // outgrew their cells, overlapped each other and ran off the canvas. Nothing
  // caught it: `checkOverlaps` reconstructs rects, text, lines and paths, and a
  // <circle> is not on that list, so a coin is INVISIBLE to the collision
  // contract. It was found by rasterising the picture to 390px and looking at
  // it, which is the only gate that would have.
  const label = (p) => `${currency} ${p.value}`;
  const textW = Math.max(...pieces.map((p) => measure(label(p), size, { weight: 700 })));
  const coinR = Math.max((spec.coinSize ?? 108) / 2, textW / 2 + size * 0.55);
  const noteW = Math.max(spec.noteWidth ?? 172, textW + size * 1.4);
  const noteH = Math.max(Math.round(noteW * 0.46), size * 1.9);
  const cellW = Math.max(coinR * 2, noteW);
  const cellH = Math.max(coinR * 2, noteH);

  const rows = Math.ceil(pieces.length / perRow);
  const wide = Math.min(perRow, pieces.length);
  const bodyW = PAD * 2 + wide * cellW + (wide - 1) * GAP;
  const bodyH = PAD * 2 + rows * cellH + (rows - 1) * GAP;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: isUr ? "ur" : "en", spec,
  });

  pieces.forEach((p, i) => {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    // Urdu lays the row out right-to-left, like every other early-years type here.
    const inRow = Math.min(perRow, pieces.length - r * perRow);
    const slot = isUr ? inRow - 1 - c : c;
    const x = PAD + slot * (cellW + GAP);
    const y = PAD + r * (cellH + GAP);
    // The value stays in Latin digits with the unit beside it in both
    // languages: the quiz lane's rule is that numerals and units read
    // left-to-right even inside an Urdu figure.
    const text = label(p);
    const cx = x + cellW / 2;
    const cy = y + cellH / 2;
    if (p.kind === "coin") {
      svg.circle(cx, cy, coinR, { fill: C.paper, stroke: C.ink, sw: 3 });
      svg.circle(cx, cy, coinR - 7, { fill: "none", stroke: C.rule, sw: 1.6 });
    } else {
      svg.rect(cx - noteW / 2, cy - noteH / 2, noteW, noteH, { rx: 6, fill: C.paper, stroke: C.ink, sw: 3 });
      svg.rect(cx - noteW / 2 + 7, cy - noteH / 2 + 7, noteW - 14, noteH - 14, { fill: "none", stroke: C.rule, sw: 1.4 });
    }
    svg.text(cx, cy, text, { size, weight: 700, anchor: "middle", baseline: "middle", fill: C.ink });
  });
  return svg.toString();
}

module.exports = {
  type: "money",
  aliases: ["coins", "coins_and_notes", "currency"],
  summary: "Coins as labelled discs and notes as labelled rectangles — identifying, adding and swapping money.",
  render,
  examples: [
    { name: "money_three_coins_en", spec: { type: "money", items: [{ value: 10, kind: "coin" }, { value: 5, kind: "coin", count: 2 }] } },
    { name: "money_note_and_coins_ur", spec: { type: "money", lang: "ur", currency: "Rs", items: [{ value: 50, kind: "note" }, { value: 20, kind: "coin", count: 2 }] } },
  ],
};
