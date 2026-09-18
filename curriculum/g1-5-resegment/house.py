"""The §5 house-formatting numbers, in one place, imported by every painter.

`sheet.md §5.1` fixes the top of every tab: row 1 a title band in Arial 16
bold over about 42px, row 2 a subtitle in gray #4B5563 at 11pt saying what the
tab is and where its facts come from, row 3 column headers in Arial 10 bold,
centred. Six modules paint that band — `sheetio.format_grid` for the ordinary
header-plus-rows tabs, and bespoke passes in `calfmt` (the calendar and the
assumptions tab), `covfmt`, `skillfmt`, `reviewtab` and `navtab`, whose tabs
merge, freeze or band in ways the generic grid cannot express.

Each of those six used to carry its own copy of the size, and the copies had
diverged: three tabs shipped a 13pt title and three a 14pt one, against a spec
asking 16, and no test compared them because none of them was wrong on its
own terms. The numbers live here so a tab cannot ship at a different size from
the tab beside it.

This module imports nothing on purpose. Five of its six readers are kept free
of the Google SDK so they stay testable without credentials, and a constant
that pulled `sheetio` in behind it would undo that.

ONE DELIBERATE DEVIATION, kept visible rather than silently conformed:
`DATA_PT` is 10 where §5.2 asks for 9. Nine fits more rows on a screen, and
the person reviewing this workbook reads it on a laptop and has asked more
than once for an easier read, not a denser one. The colour, wrap and
alignment of §5.2 are all honoured; only the size is held. `sheetio`'s header
row is likewise 46px rather than §5.1's 36, because headers here WRAP and a
two-line header clips at 36.
"""

TITLE_PT = 16          # §5.1 — row 1, Arial 16 bold on #0F4C5C
TITLE_PX = 42          # §5.1 — "~42px"; 34 was sized for the old 13pt
SUB_PT = 11            # §5.1 — row 2, gray #4B5563 prose
SUB_PX = 28
HEAD_PT = 10           # §5.1 — row 3, Arial 10 bold, centred
BAND_PT = 12           # §5.4 — a coral section band, white 12 bold
DATA_PT = 10           # §5.2 asks 9 — see the deviation note above
