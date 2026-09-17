"""bd-60118 — split the M1 item 1.6 option grid into four numbered panels.

The source workbook embeds all four options as ONE 630x388 image: a 2x2 grid of
lesson-plan drafts, each cell labelled A./B./C./D. in a band beneath it.
WhatsApp quiz options are text buttons, so the grid cannot be an option list —
instead each panel is sent as its own image, captioned and stamped with the
OPTION NUMBER the teacher will actually press.

The number, not the letter, is stamped: correct_option holds a 1-based index
(bd-60116) and the buttons are numbered, so a panel reading "A" while the button
reads "1" is exactly the mismatch that made every answer grade wrong before.
"""
from PIL import Image, ImageDraw, ImageFont
import os

SRC = "/tmp/cert-art/qimg/Module1_image1.png"
OUT = "/tmp/cert-art/qopts"
os.makedirs(OUT, exist_ok=True)

# Measured from the rules in the source: v-split 315, h-rules 187/205 and 369/387.
# Each cell's content stops at the label band; we keep the content only.
CELLS = {
    1: (4, 6, 314, 186),      # A -> option 1
    2: (316, 6, 626, 186),    # B -> option 2
    3: (4, 206, 314, 368),    # C -> option 3
    4: (316, 206, 626, 368),  # D -> option 4
}

BAR_H = 46
GREEN = (47, 174, 95)
SLATE = (50, 65, 79)
PAD = 10


def font(size):
    for p in ("/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


src = Image.open(SRC).convert("RGB")
made = []
for num, box in CELLS.items():
    cell = src.crop(box)
    w, h = cell.size
    canvas = Image.new("RGB", (w + PAD * 2, h + PAD + BAR_H), "white")
    canvas.paste(cell, (PAD, PAD))
    d = ImageDraw.Draw(canvas)
    # thin frame around the draft so the panel reads as a discrete card
    d.rectangle([PAD - 1, PAD - 1, PAD + w, PAD + h], outline=(205, 214, 220), width=1)
    # the option bar
    by0 = PAD + h + 4
    d.rectangle([0, by0, canvas.size[0], canvas.size[1]], fill=GREEN)
    label = f"OPTION {num}"
    f = font(24)
    tw = d.textlength(label, font=f)
    d.text(((canvas.size[0] - tw) / 2, by0 + (BAR_H - 30) / 2), label, font=f, fill="white")
    p = os.path.join(OUT, f"m1-item-1-6-option-{num}.png")
    canvas.save(p, optimize=True)
    made.append((num, p, canvas.size, os.path.getsize(p)))

for n, p, size, b in made:
    print(f"  option {n}: {os.path.basename(p)}  {size}  {b // 1024}KB")
