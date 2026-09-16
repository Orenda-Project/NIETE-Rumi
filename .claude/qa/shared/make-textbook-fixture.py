#!/usr/bin/env python3
"""Regenerate the pic-to-LP textbook-page fixture.

Run from the repo root:  python3 .claude/qa/shared/make-textbook-fixture.py

WHY THIS EXISTS. The first version of this fixture was abstract grey bars — it
LOOKED like a page at a glance but carried no readable text, so the image
analysis simply invented content ("a classroom setup with student seating and
tables"). A fixture that forces a hallucination cannot tell you whether the
feature works.

The content is real and deliberately MATCHED TO THE LIVE CATALOG: Grade 3
Mathematics, Chapter 3 "Multiplication Mountain", Topic 1 "Multiplication using
Tables", page 47 — the same chapter/topic/pages the Pick Class Flow serves for
Grade 3 Math (Ch3 Day 1, p.47-48). So pic-to-LP has a real grade + subject +
topic to extract, and the extraction can be checked against a lesson plan that
actually exists.

Generated rather than photographed on purpose: deterministic, ~130 kB, no
copyright question, and no real classroom or child in a file that gets
committed and sent through a live WhatsApp account.
"""
from PIL import Image, ImageDraw, ImageFont
import os

S = "/System/Library/Fonts/Supplemental/"
def f(name, size):
    for p in (S + name, "/Library/Fonts/" + name):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    raise SystemExit("font not found: " + name)

serif   = lambda s: f("Times New Roman.ttf", s)
serif_b = lambda s: f("Times New Roman Bold.ttf", s)
serif_i = lambda s: f("Times New Roman Italic.ttf", s)
sans_b  = lambda s: f("Arial Bold.ttf", s)

W, H = 1240, 1754                       # A4 @150dpi
PAPER, INK, RULE = (253, 252, 248), (26, 26, 28), (176, 176, 180)
ACCENT = (23, 74, 122)
img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)

M = 96
y = 78

# running head
d.text((M, y), "MATHEMATICS  ·  GRADE 3", font=sans_b(19), fill=ACCENT)
d.text((W - M, y), "Unit 3", font=serif(19), fill=(110,110,115), anchor="ra")
y += 30
d.line([(M, y), (W - M, y)], fill=ACCENT, width=2); y += 34

d.text((M, y), "Chapter 3  Multiplication Mountain", font=serif_b(31), fill=INK); y += 46
d.text((M, y), "Topic 1 — Multiplication using Tables", font=serif_b(25), fill=INK); y += 44

body = serif(21); lh = 33
para = [
 "Multiplication is a short way of adding the same number again and again.",
 "When we add 4 + 4 + 4, we are adding the number 4 three times. Instead of",
 "writing a long addition, we can write 3 × 4 = 12. We read this as “three",
 "times four equals twelve”. The sign × means “multiplied by”.",
]
for ln in para:
    d.text((M, y), ln, font=body, fill=INK); y += lh
y += 16

# worked example box
bx0, bx1 = M, W - M
bh = 172
d.rectangle([bx0, y, bx1, y + bh], outline=RULE, width=2)
d.rectangle([bx0, y, bx0 + 7, y + bh], fill=ACCENT)
d.text((bx0 + 28, y + 18), "Worked Example", font=sans_b(19), fill=ACCENT)
ex = [
 "A shopkeeper puts 6 mangoes in each basket. He fills 5 baskets.",
 "How many mangoes are there altogether?",
 "Repeated addition:  6 + 6 + 6 + 6 + 6 = 30",
 "Multiplication:  5 × 6 = 30       Answer: 30 mangoes",
]
ey = y + 50
for i, ln in enumerate(ex):
    d.text((bx0 + 28, ey), ln, font=(serif_i(20) if i < 2 else serif(20)), fill=INK); ey += 28
y += bh + 34

# times table
d.text((M, y), "Table of 6", font=serif_b(23), fill=INK); y += 36
cw, rh = 168, 34
for i in range(10):
    col, row = i // 5, i % 5
    d.text((M + col * cw * 2, y + row * rh), "6  ×  %-2d  =  %2d" % (i + 1, 6 * (i + 1)),
           font=serif(21), fill=INK)
y += 5 * rh + 30

d.line([(M, y), (W - M, y)], fill=RULE, width=1); y += 26
d.text((M, y), "Exercise 3.1", font=sans_b(21), fill=ACCENT); y += 36
qs = [
 "1.   Write as multiplication:  8 + 8 + 8 + 8 = ______",
 "2.   Find the product:  7 × 6 = ______        9 × 4 = ______",
 "3.   There are 4 wheels on one car. How many wheels on 7 cars?",
 "4.   Complete the table of 6 up to 6 × 12.",
 "5.   A packet holds 5 biscuits. Salma buys 8 packets. How many biscuits?",
]
for q in qs:
    d.text((M, y), q, font=body, fill=INK); y += lh
y += 20

d.text((M, y), "Remember:  changing the order does not change the product.",
       font=serif_i(20), fill=(70,70,75)); y += 28
d.text((M, y), "3 × 4  =  4 × 3  =  12", font=serif_b(21), fill=INK); y += 50

# ── array diagram: 3 rows x 4 columns, the standard Grade-3 visual ──────────
d.text((M, y), "Arrays help us see multiplication", font=serif_b(23), fill=INK); y += 40
r, gap, rad = 3, 52, 15
gx, gy = M + 30, y + 8
for row in range(3):
    for col in range(4):
        cx, cy = gx + col * gap, gy + row * gap
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(214, 226, 238), outline=ACCENT, width=2)
# brace labels
d.text((gx + 4 * gap + 24, gy + gap - 10), "3 rows", font=serif(20), fill=(70,70,75))
d.text((gx - 6, gy + 3 * gap + 14), "4 in each row", font=serif(20), fill=(70,70,75))
d.text((gx + 4 * gap + 24, gy + gap + 22), "3 × 4 = 12", font=serif_b(21), fill=INK)
y = gy + 3 * gap + 60

d.line([(M, y), (W - M, y)], fill=RULE, width=1); y += 24
d.text((M, y), "Activity", font=sans_b(21), fill=ACCENT); y += 34
act = [
 "Work in pairs. Use bottle caps or pebbles to make an array for 2 × 7.",
 "Draw your array in your copy and write the multiplication sentence.",
]
for ln in act:
    d.text((M, y), ln, font=body, fill=INK); y += lh

# folio
d.line([(M, H - 96), (W - M, H - 96)], fill=RULE, width=1)
d.text((W // 2, H - 74), "47", font=serif(20), fill=(110,110,115), anchor="ma")

out = ".claude/qa/fixtures/whatsapp/niete/media/textbook_page.png"
img.save(out, "PNG", optimize=True)
print("wrote %s  %dx%d  %d bytes" % (out, W, H, os.path.getsize(out)))
