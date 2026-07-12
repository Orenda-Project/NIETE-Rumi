# NIETE Branding — Design System for the NIETE-Rumi Fork

**Source of truth**: [niete.edu.pk](https://niete.edu.pk/) — the official NIETE website. Assets, colors, and typography below are extracted from the live site (2026-07-11).

**Official name**: **NIETE** — National Institute for Excellence in Teacher Education (Islamabad, Pakistan). Federal Directorate of Education.
**Tagline**: *"Transforming Education at Scale"* (page `<title>`).
**Longer descriptor**: *"NIETE is revolutionizing education in Pakistan with innovative, cost-effective solutions. Explore our services in teacher training, assessments, policy support, and more."*

---

## Logos

Three variants stored in this folder:

| File | Dimensions | Use case |
|---|---|---|
| `niete-logo-300.png` | 300 × 300 | Primary square mark — green "N" + off-white (`#F0F0F0`) "J" corner element on transparent background. Use on colored / gradient backgrounds. **Do NOT use on white** — the off-white J vanishes. |
| `niete-logo-300-dark-fill.png` | 300 × 300 | **WhatsApp / white-background variant.** Identical to `niete-logo-300.png` except the off-white `#F0F0F0` pixels are replaced with NIETE charcoal `#32373C` so the J stays visible on WhatsApp's white chrome. This is the file to upload to WhatsApp Business profile. |
| `niete-logo-dark.png` | 200 × 100 | Wordmark for **dark backgrounds** (used on the site header when dark theme active) |
| `niete-logo-light.png` | 200 × 100 | Wordmark for **light backgrounds** (default site header) |

**Meta profile picture upload**: Use `niete-logo-300-dark-fill.png` (NOT the plain `-300.png`) — see the note above about the off-white J. Meta requires square PNG or JPG, minimum 192×192, recommended 640×640 or higher. If a higher-res variant is needed, request from `contact@niete.edu.pk`.

**Source URLs** (in case originals need re-download):

- Square logo (green/white): `https://niete.edu.pk/wp-content/uploads/2024/09/Copy-of-NIETE-Green-White-300x300.png`
- Wordmark dark: `https://niete.edu.pk/wp-content/uploads/2024/10/logo-dark.png`
- Wordmark light: `https://niete.edu.pk/wp-content/uploads/2024/10/logo-light.png`

---

## Colors

### Primary palette (extracted from live CSS)

| Swatch | Hex | Use |
|---|---|---|
| Green | `#47ba7d` | **Primary brand accent** — matches the "Green-White" logo naming. Use for buttons, headers, success states. |
| Charcoal | `#32373c` | **Primary text + navigation** — very dark grey, near-black |
| White | `#ffffff` | Background, negative space |

### Secondary / accent palette (used sparingly on the site)

| Swatch | Hex | Use on site |
|---|---|---|
| Yellow | `#ffbe01` | Accent/highlights |
| Warm yellow | `#fcb900` | Alternative accent |
| Orange | `#ff6900` | Alerts, callouts |
| Salmon | `#f78da7` | Section separators |
| Red | `#cf2e2e` / `#c70a1a` | Warnings, error states |
| Slate | `#abb8c3` | Muted UI chrome |
| Off-white | `#f7f7f7` / `#e7e7e7` | Background variants |

### Gradient palette (marketing / hero sections)

The site uses colorful gradients for hero images and campaign cards. Available RGB values include `rgb(74,234,220)` cyan, `rgb(65,88,208)` indigo, `rgb(51,167,181)` teal, `rgb(40,116,252)` blue, and warm variants like `rgb(255,205,165)` peach, `rgb(255,245,203)` cream. Use these for feature cards, campaign templates, or portal accent elements — not for the WhatsApp bot's primary voice.

### Rumi bot voice choice

For the WhatsApp bot experience specifically, keep to the primary palette (`#47ba7d` green + `#32373c` charcoal + white). WhatsApp UI is neutral and users can't customize per-chat colors — brand shows up in the profile picture, business description, and any PDF/image assets we render.

---

## Typography

### Primary typefaces (loaded from Google Fonts)

- **Plus Jakarta Sans** — headings + display use (weights 200–800, italic + regular)
- **Prompt** — secondary sans-serif
- **Poppins** — body text alternative

### Rendered PDF / marketing usage

When rendering LP PDFs, coaching reports, certificates, or any teacher-facing artefact:

- **Headings**: Plus Jakarta Sans (SemiBold 600 or Bold 700)
- **Body**: Poppins Regular (400) or Plus Jakarta Sans Regular (400)
- **Urdu / Nastaliq text**: Use `Noto Nastaliq Urdu` (Google Fonts, free) — Plus Jakarta Sans and Poppins don't cover Urdu script. Per the Rumi rulebook (`taleemabad-core/.claude/rules/urdu.md`), give Nastaliq generous `line-height: 1.9` (default line-height crushes Urdu ascenders).

### Google Fonts import URLs (for local dev / dashboards)

```
https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400;1,500;1,600;1,700;1,800&display=swap
https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap
https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap
https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap
```

---

## Voice & tone

From the site's own copy:

- **Positioning**: "Transforming Education **at Scale**" — emphasizes reach + systems change
- **Core promise**: *innovative, cost-effective solutions* — the value dial is efficiency + reach, not luxury
- **Services listed**: teacher training, assessments, policy support
- **Audience**: government schools, federal educational institutes (public sector — not private schools or NGOs)

For the WhatsApp bot's voice, this translates to:

- **Direct + practical** — teachers are busy; short sentences, action-oriented replies
- **Bilingual by default** — Urdu (primary) + English (secondary) — matches how LP content is stored
- **Formal register in Urdu** — "استاد محترم" not casual "استاد"; NIETE serves federal government teachers who expect respectful address
- **Focus on classroom outcomes**, not features — "aap ka pehla sabaq" (your first lesson) not "our AI-powered LP engine"
- **No emoji-heavy marketing tone** — the site's own copy is restrained; use emoji for section headers only (like the `🎯` in the LP HTML we saw)

---

## WhatsApp Business profile setup — recommended values

When completing the Meta Business Manager configuration for the NIETE Rumi WABA:

| Field | Value |
|---|---|
| **Business display name** (Meta review required) | `NIETE` |
| **Category** | Education (already set on Mudareb WABA per our earlier check — good match) |
| **Profile picture** | `niete-logo-300.png` (this folder) |
| **About** | "National Institute for Excellence in Teacher Education, Islamabad" (65 chars — within WhatsApp's 139-char cap) |
| **Description** | "Your AI teaching assistant from NIETE — National Institute for Excellence in Teacher Education (Islamabad). Get lesson plans, quizzes, reading assessments, and classroom coaching — all on WhatsApp. Available in Urdu and English." |
| **Website** | `https://niete.edu.pk/` |
| **Email** | (get from NIETE contact page or ask NIETE stakeholder for the right one — do not use a personal address) |
| **Address** | (get from NIETE — Islamabad HQ per website) |

---

## Update flow

If NIETE releases new brand assets (rebrand, secondary logos, updated typography), pull the new files into this folder and update:

1. This `BRANDING.md` with new values
2. Meta Business Manager profile picture (if the primary square logo changed)
3. Any rendered PDFs/certificate templates in `NIETE-Rumi/bot/assets/`
4. Any portal design components (once we start on the coach-review portal — Track 03)

Do not modify the source files (`niete-logo-*.png`) — they represent NIETE's official 2024/09 branding as extracted 2026-07-11. If replaced, keep the originals with a date suffix (`niete-logo-300-2026-07.png`) for audit.
