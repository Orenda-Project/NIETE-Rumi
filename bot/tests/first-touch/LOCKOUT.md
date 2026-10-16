# LOCKOUT — the first-touch door, walked as cells

Generated from DOOR.md (§1-§5, §8.3, §10) (the warm cell re-sends at +0; a capped keyless phone gets the family text; a child key on the menu row gets the family reply, no write) by a generator kept outside the repo; `door-walk.test.js` executes every cell this change builds (ours ON or OFF, the typed messages, the claims, the child word) through the real ingress, executes the menu-row cells (the list tap attached and routed, then `menu_quiz` through the real menu service), and executes the capped cells (a keyless phone shown the chooser on two PKT days: `quiz`, `کوئز`, `/quiz` and the menu row, warm and cold, theirs ON and OFF → family.fallback text, no write). "new teacher" and "family phone" are the same server state (an unknown phone). Warm = our verdict cached 60 s; every key write forgets it (both phone forms).

| sender | store | cache | ours | theirs | message | reply | write |
|---|---|---|---|---|---|---|---|
| new teacher, family phone | none | warm | on | * | quiz | chooser (door_reply), bilingual: re-send from the 60 s verdict, +0; capped keyless (asked on 2 PKT days) gets family.fallback text (family_reply), no write | none (+0) |
| new teacher, family phone | * | * | off | on | quiz | theirs: guest reply (guest_reply), byte-identical — theirs ON + ours OFF is the forbidden tier state | none of ours |
| new teacher, family phone | * | * | off | off | quiz | today's unknown path, byte-identical | none |
| new teacher, family phone | none | cold | on | * | quiz | chooser (door_reply), bilingual; capped keyless (asked on 2 PKT days) gets family.fallback text (family_reply), no write | quiz_door_asked +1 on the first show of a PKT day (+0 the same day; none when capped) |
| new teacher, family phone | teacher | * | on | * | quiz | maker cta (maker_reply) | none (key already set) |
| new teacher, family phone | child | * | on | on | quiz | their guest reply (guest_reply), byte-identical, reason guest_phone kept (the hand-off) | none of ours |
| new teacher, family phone | child | * | on | off | quiz | family reply (family_reply) | none (key already set) |
| new teacher, family phone | none | warm | on | * | کوئز | chooser (door_reply), Urdu: re-send from the 60 s verdict, +0; capped keyless (asked on 2 PKT days) gets family.fallback text (family_reply), no write | none (+0) |
| new teacher, family phone | * | * | off | on | کوئز | theirs: guest reply (guest_reply), byte-identical — theirs ON + ours OFF is the forbidden tier state | none of ours |
| new teacher, family phone | * | * | off | off | کوئز | today's unknown path, byte-identical | none |
| new teacher, family phone | none | cold | on | * | کوئز | chooser (door_reply), Urdu; capped keyless (asked on 2 PKT days) gets family.fallback text (family_reply), no write | quiz_door_asked +1 on the first show of a PKT day (+0 the same day; none when capped) |
| new teacher, family phone | teacher | * | on | * | کوئز | maker cta (maker_reply) | none (key already set) |
| new teacher, family phone | child | * | on | on | کوئز | their guest reply (guest_reply), byte-identical, reason guest_phone kept (the hand-off) | none of ours |
| new teacher, family phone | child | * | on | off | کوئز | family reply (family_reply) | none (key already set) |
| new teacher, family phone | none | warm | on | * | /quiz | chooser (door_reply), bilingual: re-send from the 60 s verdict, +0; capped keyless (asked on 2 PKT days) gets family.fallback text (family_reply), no write | none (+0) |
| new teacher, family phone | * | * | off | on | /quiz | theirs: guest reply (guest_reply), byte-identical — theirs ON + ours OFF is the forbidden tier state | none of ours |
| new teacher, family phone | * | * | off | off | /quiz | today's unknown path, byte-identical | none |
| new teacher, family phone | none | cold | on | * | /quiz | chooser (door_reply), bilingual; capped keyless (asked on 2 PKT days) gets family.fallback text (family_reply), no write | quiz_door_asked +1 on the first show of a PKT day (+0 the same day; none when capped) |
| new teacher, family phone | teacher | * | on | * | /quiz | maker cta (maker_reply) | none (key already set) |
| new teacher, family phone | child | * | on | on | /quiz | their guest reply (guest_reply), byte-identical, reason guest_phone kept (the hand-off) | none of ours |
| new teacher, family phone | child | * | on | off | /quiz | family reply (family_reply) | none (key already set) |
| new teacher, family phone | none | * | on | * | menu row | maker cta (maker_reply), the menu row with no key | quiz_door_teacher |
| new teacher, family phone | * | * | off | * | menu row | today's unknown path, byte-identical | none |
| new teacher, family phone | teacher | * | on | * | menu row | maker cta (maker_reply), the menu row on a teacher key | none (key already set) |
| new teacher, family phone | child | * | on | * | menu row | family reply (family_reply), the menu row on a child key | none (no write) |
| new teacher, family phone | * | * | on | * | I am a teacher | maker cta (maker_reply), the claim | quiz_door_teacher |
| new teacher, family phone | * | * | off | * | I am a teacher | today's unknown path, byte-identical | none |
| new teacher, family phone | * | * | on | * | میں ٹیچر ہوں | maker cta (maker_reply), the claim | quiz_door_teacher |
| new teacher, family phone | * | * | off | * | میں ٹیچر ہوں | today's unknown path, byte-identical | none |
| new teacher, family phone | * | * | on | * | /register | today's registration reply (the teacher key written silently) | quiz_door_teacher |
| new teacher, family phone | * | * | off | * | /register | today's unknown path, byte-identical | none |
| new teacher, family phone | * | * | on | * | QUIZ- code | today's handling, byte-identical (the join / the binder; never meets the door) | none |
| new teacher, family phone | * | * | off | * | QUIZ- code | today's unknown path, byte-identical | none |
| new teacher, family phone | * | * | on | * | STOP | today's handling, byte-identical (the join / the binder; never meets the door) | none |
| new teacher, family phone | * | * | off | * | STOP | today's unknown path, byte-identical | none |
| new teacher, family phone | * | * | on | * | child | family reply (family_reply), the typed child word | quiz_door_child |
| new teacher, family phone | * | * | off | * | child | today's unknown path, byte-identical | none |
| known teacher | * | * | * | * | quiz | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | کوئز | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | /quiz | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | menu row | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | I am a teacher | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | میں ٹیچر ہوں | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | /register | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | QUIZ- code | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | STOP | today's teacher path, byte-identical (identity decides first; no key read) | none |
| known teacher | * | * | * | * | child | today's teacher path, byte-identical (identity decides first; no key read) | none |
| chat child | * | * | * | * | quiz | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | کوئز | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | /quiz | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | menu row | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | I am a teacher | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | میں ٹیچر ہوں | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | /register | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | QUIZ- code | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | STOP | today's child path (hub / the child's own routes), byte-identical | none |
| chat child | * | * | * | * | child | today's child path (hub / the child's own routes), byte-identical | none |
| bound child | * | * | * | * | quiz | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | کوئز | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | /quiz | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | menu row | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | I am a teacher | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | میں ٹیچر ہوں | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | /register | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | QUIZ- code | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | STOP | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| bound child | * | * | * | * | child | today's child path (hub / Who is playing? / the binder), byte-identical | none |
| teacher-parent | * | * | * | * | quiz | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | کوئز | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | /quiz | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | menu row | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | I am a teacher | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | میں ٹیچر ہوں | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | /register | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | QUIZ- code | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | STOP | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
| teacher-parent | * | * | * | * | child | today's teacher path, byte-identical (identity decides first; the child line is step 2) | none |
