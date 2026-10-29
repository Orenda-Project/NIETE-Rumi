# components — Marketing-site sections (Hero, Navigation, story blocks) plus shared shadcn UI
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/components kg=673d873c76e0 gen=7731d4a691a9 overflow=11 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `Hero.tsx` — landing hero; the other sections are composed by pages/Index.tsx
- `LanguageSwitcher.tsx` — en/ur switch, also persists to the server
- Tests: none live here; vitest covers it via src/lib and src/test (`cd portal && npx vitest run src/lib`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `icons/` | → (no door; 1 files) |
| `ui/` | shadcn/ui primitives (Radix wrappers); generated style, mostly unused by the portal → `ui/CLAUDE.md` |
| `Navigation.tsx` | Marketing site top nav: logo, features anchor, Meet Rumi button, language switcher |
| `FinalCTA.tsx` | Marketing landing closing call-to-action section with the chat-on-WhatsApp button |
| `Hero.tsx` | Marketing landing hero: headline, subtitle and Meet Rumi button linking to the tier's bot |
| `AlwaysThere.tsx` | Marketing landing section 'always there': title plus list of moments Rumi helps, from i18n alwaysThere |
| `FeatureCard.tsx` | Marketing feature card: title, description and an animated sample WhatsApp chat via WhatsAppChat |
| `GlobalTeachers.tsx` | Marketing landing 'global teachers' section: title, two paragraphs and conclusion from i18n |
| `LanguageSwitcher.tsx` | Dropdown to switch en/ur on the site and the portal; also saves the choice to the server via portal api language |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `Navigation.tsx` ← imported by `portal/src/pages/HowItWorks.tsx:1:4bc1fefe` · `portal/src/pages/Index.tsx:1:4bc1fefe`
- `AlwaysThere.tsx` ← imported by `portal/src/pages/Index.tsx:5:319f2ee5`
- `FeatureCard.tsx` ← imported by `portal/src/components/RealSupport.tsx:2:a947b5b5`
- `FinalCTA.tsx` ← imported by `portal/src/pages/Index.tsx:9:6d2f4549`
- … 7 more → `CLAUDE.index.md`

## Never (human)
- Hardcode a bot number in these components: it is read from /config (lib/whatsapp.ts:7-11)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/lib/whatsapp.botNumber.test.tsx` (FinalCTA.tsx, Hero.tsx, Navigation.tsx)
- `portal/src/portal/teacher/ui/FeatureCard.test.tsx`? (FeatureCard.tsx)

## Related (generated)
- docs: `portal/src/CLAUDE.md`?
