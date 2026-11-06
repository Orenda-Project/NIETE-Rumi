# Grades 6–12 textbook import — dry-run report

Generated 2026-11-04 by
`python3 scripts/assessment/import-ict-textbooks.py --source corpus --all --dry-run --corpus-local <corpus> --report-md <this file>`
over the held page-truth corpus (`08_Grades 6-12 LP Build/languages/corpus/`, 11,151 records, 62 stems; the
chemistry practical book is never read). **Counts only; no page text.** Nothing was written to any database.

Columns: *records* = corpus records for the book; *pages with text* = `textbook_pages` rows the import writes;
*empty skipped* = records with no text (not imported; they show as *gaps*); *flagged* / *low-conf* = written pages whose
record has `needs_human_review` / `confidence == low` (these go into `textbooks.meta`); *poetry to review* = written
poetry/ghazal/nazm pages that are flagged or not high-confidence (r2-redteam F3: an OCR garble in a verse becomes a
wrong key); *chapters* = `textbook_toc` rows; *numbering* = `source` keeps the book's chapter numbers, `ordinal`
numbers runs 1..N because the book repeats or labels its numbers (corpus-import.md §4). `grade_10_urdu` and
`grade_12_urdu` are local-only (R2 cannot hold their duplicate printed pages).

Source: `08_Grades 6-12 LP Build/languages/corpus`. Books: 61. Records 11052, pages written 10919, empty skipped 130, flagged 1170, low-confidence 193, poetry pages to review 54, chapters 808, ordinal-numbered books 16.

| grade | code | book_stem | records | pages with text | empty skipped | flagged | low-conf | poetry to review | chapters | numbering | gaps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | computer_science | `grade_6_computer_science` | 95 | 95 | 0 | 0 | 0 | 0 | 8 | ordinal | 0 |
| 6 | english | `grade_6_english` | 150 | 150 | 0 | 13 | 0 | 0 | 11 | ordinal | 0 |
| 6 | general_science | `grade_6_general_science` | 161 | 161 | 0 | 9 | 0 | 0 | 12 | source | 0 |
| 6 | geography | `grade_6_geography` | 92 | 92 | 0 | 2 | 0 | 0 | 6 | source | 0 |
| 6 | history | `grade_6_history` | 88 | 87 | 1 | 6 | 0 | 0 | 5 | source | 1 |
| 6 | islamiat | `grade_6_islamiat` | 175 | 172 | 3 | 126 | 8 | 0 | 7 | source | 3 |
| 6 | maths | `grade_6_mathematics` | 225 | 223 | 2 | 6 | 1 | 0 | 10 | source | 2 |
| 6 | urdu | `grade_6_urdu` | 102 | 102 | 0 | 3 | 2 | 0 | 21 | source | 0 |
| 6 | zarai_taleem | `grade_6_zari_taleem` | 58 | 58 | 0 | 0 | 0 | 0 | 5 | source | 0 |
| 7 | computer_science | `grade_7_computer_science` | 120 | 119 | 1 | 4 | 1 | 0 | 6 | source | 1 |
| 7 | english | `grade_7_english` | 161 | 161 | 0 | 16 | 0 | 0 | 8 | source | 0 |
| 7 | general_science | `grade_7_general_science` | 171 | 170 | 1 | 3 | 0 | 0 | 12 | source | 1 |
| 7 | geography | `grade_7_geography` | 82 | 82 | 0 | 8 | 0 | 0 | 6 | source | 0 |
| 7 | history | `grade_7_history` | 116 | 116 | 0 | 1 | 0 | 0 | 6 | source | 0 |
| 7 | islamiat | `grade_7_islamiat` | 173 | 167 | 6 | 83 | 4 | 0 | 7 | source | 6 |
| 7 | maths | `grade_7_mathematics` | 246 | 246 | 0 | 12 | 0 | 0 | 13 | source | 0 |
| 7 | urdu | `grade_7_urdu` | 104 | 104 | 0 | 14 | 2 | 4 | 23 | ordinal | 4 |
| 7 | zarai_taleem | `grade_7_zari_taleem` | 74 | 74 | 0 | 4 | 0 | 0 | 7 | source | 0 |
| 8 | computer_science | `grade_8_computer_science` | 101 | 84 | 17 | 1 | 0 | 0 | 7 | ordinal | 17 |
| 8 | english | `grade_8_english` | 169 | 167 | 2 | 9 | 0 | 0 | 9 | source | 2 |
| 8 | general_science | `grade_8_general_science` | 198 | 197 | 1 | 11 | 0 | 0 | 12 | source | 1 |
| 8 | geography | `grade_8_geography` | 84 | 84 | 0 | 1 | 0 | 0 | 6 | source | 0 |
| 8 | history | `grade_8_history` | 107 | 107 | 0 | 1 | 0 | 0 | 6 | source | 0 |
| 8 | islamiat | `grade_8_islamiat` | 150 | 147 | 3 | 98 | 2 | 0 | 28 | ordinal | 3 |
| 8 | maths | `grade_8_mathematics` | 255 | 255 | 0 | 13 | 0 | 0 | 13 | source | 0 |
| 8 | urdu | `grade_8_urdu` | 103 | 103 | 0 | 10 | 8 | 3 | 22 | source | 0 |
| 9 | biology | `grade_9_biology` | 162 | 152 | 10 | 7 | 0 | 0 | 10 | source | 10 |
| 9 | chemistry | `grade_9_chemistry` | 247 | 247 | 0 | 11 | 0 | 0 | 20 | ordinal | 0 |
| 9 | computer_science | `grade_9_computer_science` | 67 | 66 | 1 | 2 | 0 | 0 | 11 | ordinal | 1 |
| 9 | english | `grade_9_english` | 163 | 162 | 1 | 15 | 11 | 0 | 16 | ordinal | 1 |
| 9 | islamiat | `grade_9_islamiat` | 150 | 150 | 0 | 62 | 1 | 0 | 23 | ordinal | 0 |
| 9 | maths | `grade_9_mathematics` | 260 | 255 | 5 | 13 | 0 | 0 | 11 | source | 5 |
| 9 | pakistan_studies_ur | `grade_9_pak_studies_urdu` | 152 | 150 | 2 | 20 | 12 | 0 | 9 | source | 2 |
| 9 | physics | `grade_9_physics` | 209 | 207 | 2 | 13 | 0 | 0 | 9 | source | 2 |
| 9 | urdu | `grade_9_urdu` | 135 | 135 | 0 | 14 | 10 | 6 | 20 | ordinal | 0 |
| 10 | biology | `grade_10_biology` | 157 | 157 | 0 | 4 | 0 | 0 | 11 | source | 0 |
| 10 | chemistry | `grade_10_chemistry` | 156 | 156 | 0 | 6 | 0 | 0 | 13 | source | 0 |
| 10 | computer_science | `grade_10_computer_science` | 247 | 246 | 1 | 13 | 0 | 0 | 8 | source | 1 |
| 10 | english | `grade_10_english` | 164 | 163 | 1 | 14 | 5 | 0 | 14 | ordinal | 1 |
| 10 | islamiat | `grade_10_islamiat` | 163 | 163 | 0 | 72 | 3 | 0 | 34 | ordinal | 0 |
| 10 | maths | `grade_10_mathematics` | 273 | 264 | 9 | 17 | 0 | 0 | 12 | source | 9 |
| 10 | pakistan_studies | `grade_10_pak_studies_english` | 125 | 125 | 0 | 1 | 0 | 0 | 6 | source | 0 |
| 10 | pakistan_studies_ur | `grade_10_pak_studies_urdu` | 137 | 137 | 0 | 21 | 2 | 0 | 6 | source | 0 |
| 10 | physics | `grade_10_physics` | 353 | 352 | 1 | 16 | 1 | 0 | 12 | source | 1 |
| 10 | urdu | `grade_10_urdu` | 171 | 167 | 1 | 27 | 24 | 8 | 23 | ordinal | 0 |
| 11 | biology | `grade_11_biology` | 425 | 422 | 3 | 25 | 0 | 0 | 15 | source | 2 |
| 11 | chemistry | `grade_11_chemistry` | 413 | 412 | 1 | 29 | 2 | 0 | 22 | source | 1 |
| 11 | computer_science | `grade_11_computer_science` | 215 | 214 | 1 | 12 | 0 | 0 | 8 | source | 1 |
| 11 | english | `grade_11_english` | 215 | 213 | 2 | 6 | 0 | 0 | 18 | source | 2 |
| 11 | islamiat | `grade_11_islamiat` | 143 | 143 | 0 | 73 | 8 | 0 | 27 | source | 0 |
| 11 | maths | `grade_11_mathematics` | 245 | 234 | 11 | 13 | 0 | 0 | 9 | source | 11 |
| 11 | physics | `grade_11_physics` | 277 | 275 | 2 | 10 | 0 | 0 | 14 | source | 2 |
| 11 | urdu | `grade_11_urdu` | 125 | 123 | 2 | 19 | 7 | 10 | 24 | ordinal | 2 |
| 12 | biology | `grade_12_biology` | 283 | 283 | 0 | 7 | 0 | 0 | 15 | source | 0 |
| 12 | chemistry | `grade_12_chemistry` | 353 | 341 | 12 | 17 | 0 | 0 | 23 | source | 12 |
| 12 | computer_science | `grade_12_computer_science` | 209 | 206 | 3 | 2 | 0 | 0 | 8 | source | 3 |
| 12 | english | `grade_12_english` | 186 | 183 | 3 | 37 | 35 | 0 | 21 | ordinal | 3 |
| 12 | maths | `grade_12_mathematics` | 244 | 242 | 2 | 20 | 0 | 0 | 8 | source | 2 |
| 12 | pakistan_studies | `grade_12_pak_studies_english` | 229 | 229 | 0 | 6 | 0 | 0 | 12 | source | 0 |
| 12 | pakistan_studies_ur | `grade_12_pak_studies_urdu` | 261 | 260 | 1 | 29 | 9 | 0 | 12 | source | 1 |
| 12 | urdu | `grade_12_urdu` | 178 | 162 | 16 | 63 | 35 | 23 | 28 | ordinal | 6 |
