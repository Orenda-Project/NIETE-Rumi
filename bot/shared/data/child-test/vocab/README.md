# Word lists for the passage readability number

Six lists, one word per line (`word<TAB>count`), used by `shared/services/child-test/passage-gate.js` to compute a
passage's `readability`: the share of its word TYPES (character names left out, English case-folded) found in the
list named by `readability_list`.

| File | Source list | Used for |
|---|---|---|
| `fed-cum-g2-2026.en.tsv` | English, cumulative to grade 2, top 1,000 | band 1 (own list) |
| `fed-cum-g3-2026.en.tsv` | English, cumulative to grade 3, top 1,000 | band 2 (own list); band 1's band-above check (≥ 0.95) |
| `fed-cum-g5-2026.en.tsv` | English, cumulative to grade 5, top 1,000 | band 3 (own list) |
| `fed-cum-g2-2026.ur.tsv` | Urdu, cumulative to grade 2, top 1,000 | band 1 |
| `fed-cum-g3-2026.ur.tsv` | Urdu, cumulative to grade 3, top 1,000 | band 2 |
| `fed-cum-g5-2026.ur.tsv` | **Urdu, cumulative to grade 4**, top 1,000 | band 3 — see the note below |

**Urdu grade 5:** there is no Urdu cumulative-to-grade-5 file from the same derivation, so `fed-cum-g5-2026.ur.tsv`
is the cumulative-to-grade-4 list. A band-3 Urdu passage is therefore checked against a slightly smaller list than
its English counterpart (stricter, never looser). Replace it with a true grade-5 list as a new `readability_list` name.

**Method** (the derivation that produced these files): the federal ICT textbooks' page text (OCR page-truth, Urdu
and English, grades 1–5) is tokenised — Urdu diacritics U+064B–U+0652 and U+0670 stripped, Urdu on Arabic-script
runs, English on letter runs lower-cased — and counted cumulatively up to each grade; each file is the 1,000 most
frequent words of that cumulative count. Textbook text only; no child data. Caveats: OCR errors in Nastaliq pages
add noise to the Urdu lists; inflected forms count as separate words (no lemmatiser); the lists measure familiarity,
not decodability. Because each file is cut at 1,000 words, a list for a higher grade is not a strict superset of a
lower grade's list.
