#!/usr/bin/env python3
"""bd-9svkbb — seed I-SAPS Level 3 (Advanced) in ONE pass, in the shape Levels 1 and 2 hold in production.

This is the Level 2 seed (2026-10-23-isaps-level2-seed.py) with Level 3's constants: the same parsers
(including the bd-arghnv.3 option-line fix, so no blank stems), the same writer, the same rollback. One
implementation; only what differs is set here:

  training_levels         1   "Level 3: Advanced", order_index 2, cpd_level 3
  training_courses        9   "Module N - <title>", the same course_type per module as Levels 1 and 2
  training_modules       41   one per unit video, "Unit 3101" ...; video_url = the re-encoded unit on
                              digital-coach-audio/training/rehosted/i-saps/level-3/module-N/unit-NNNN.mp4
  training_questions          formative MCQs on their unit
  training_grand_quizzes  9   one grand_quiz per module, source_quiz_id 900+N (isaps-module-exam.rules)
  training_questions          per module: the summative MCQ bank and the CRQs with their rubric

Source: the partner's "Level 3 Training Content" folder (OneDrive, shared 2026-11-05). Unit codes are four
digits: 3101 = level 3, module 1, unit 01.

I-SAPS levels are 'parallel' since 2026-11-02 (bd-arghnv.2): an ACTIVE Level 3 is open to every I-SAPS
teacher at once; only its certificate needs Level 2's. So production is seeded with --inactive, read back,
and then switched on with --activate.

Safety (all from the Level 2 seed):
  * DRY RUN BY DEFAULT — prints the plan and every mismatch with the source. --yes-write to mutate.
  * --target pins the Supabase project ref; the env file must resolve to it or the script refuses.
  * Idempotent by refusal: writes nothing if the I-SAPS vendor already has a level at order_index 2.
  * --inactive seeds it hidden (is_active=false); --activate switches it on.
  * --rollback deletes this Level 3 tree, and refuses once any teacher progress or attempt points at it.

Usage:
  python3 scripts/migrations/2026-11-05-isaps-level3-seed.py --target sandbox --env .env.sandbox \\
      --content "<folder holding 'Module 1 - …' … 'Module 9 - …'>"          # dry run
  ... --yes-write [--inactive]
  ... --activate [--yes-write]
  ... --rollback [--yes-write]
"""
import importlib.util
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("isaps_level3_seed_base", os.path.join(_HERE, "2026-10-23-isaps-level2-seed.py"))
seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed)

seed.LEVEL_NO = 3
seed.LEVEL_NAME = "Level 3: Advanced"   # the partner's own header on every Level 3 CRQ document
seed.LEVEL_ORDER = 2                    # Level 1 is 0, Level 2 is 1
seed.CPD_LEVEL = 3
seed.R2_BASE = ("https://58a6fb2a86d61397895d6b97b73a3ebe.r2.cloudflarestorage.com"
                "/digital-coach-audio/training/rehosted/i-saps/level-3")
seed.RUBRIC_SOURCE = "I-SAPS Level 3 CRQs (partner .docx)"

if __name__ == "__main__":
    seed.main()
