BEGIN;
INSERT INTO training_programs (id, key, name, description, is_active, created_at)
SELECT gen_random_uuid(), 'niete_primary', 'NIETE Primary Program (Grades 1-5)',
       'Primary teachers: NIETE Levels 0-3 only. Per NIETE team visibility rules, 21 Jul 2026.', true, now()
WHERE NOT EXISTS (SELECT 1 FROM training_programs WHERE key='niete_primary');

INSERT INTO training_programs (id, key, name, description, is_active, created_at)
SELECT gen_random_uuid(), 'niete_middle_high', 'NIETE Middle & High Program (Grades 6-10)',
       'Middle/High teachers: Oxbridge, NIETE Levels 2-3, Beacon House. Per NIETE team visibility rules, 21 Jul 2026.', true, now()
WHERE NOT EXISTS (SELECT 1 FROM training_programs WHERE key='niete_middle_high');

INSERT INTO training_program_scopes (id, program_id, vendor_id, level_ids)
SELECT gen_random_uuid(), p.id, v.id, NULL
FROM training_programs p, training_vendors v
WHERE p.key='niete_primary' AND v.key='TALEEMABAD'
  AND NOT EXISTS (SELECT 1 FROM training_program_scopes s WHERE s.program_id=p.id AND s.vendor_id=v.id);

INSERT INTO training_program_scopes (id, program_id, vendor_id, level_ids)
SELECT gen_random_uuid(), p.id, v.id, ARRAY[3,4]
FROM training_programs p, training_vendors v
WHERE p.key='niete_middle_high' AND v.key='TALEEMABAD'
  AND NOT EXISTS (SELECT 1 FROM training_program_scopes s WHERE s.program_id=p.id AND s.vendor_id=v.id);

INSERT INTO training_program_scopes (id, program_id, vendor_id, level_ids)
SELECT gen_random_uuid(), p.id, v.id, NULL
FROM training_programs p, training_vendors v
WHERE p.key='niete_middle_high' AND v.key IN ('BEACONHOUSE','OXBRIDGE')
  AND NOT EXISTS (SELECT 1 FROM training_program_scopes s WHERE s.program_id=p.id AND s.vendor_id=v.id);

WITH buckets AS (
  SELECT u.id AS user_id,
         ('PRIMARY' = ANY(u.levels)) AS is_primary,
         ('MIDDLE' = ANY(u.levels) OR 'HIGH' = ANY(u.levels)) AS is_mh
  FROM users u
  WHERE EXISTS (SELECT 1 FROM teacher_training_assignments a
                WHERE a.user_id=u.id AND a.is_active AND a.assigned_by='migration_seed')
    AND u.levels IS NOT NULL AND u.levels <> '{}'
)
INSERT INTO teacher_training_assignments (id, user_id, program_id, assigned_at, assigned_by, is_active)
SELECT gen_random_uuid(), b.user_id, p.id, now(), 'level_scoping_migration', true
FROM buckets b
JOIN training_programs p ON (p.key='niete_primary' AND b.is_primary) OR (p.key='niete_middle_high' AND b.is_mh)
WHERE NOT EXISTS (SELECT 1 FROM teacher_training_assignments a
                  WHERE a.user_id=b.user_id AND a.program_id=p.id AND a.is_active);

UPDATE teacher_training_assignments a
SET is_active = false
WHERE a.assigned_by='migration_seed' AND a.is_active
  AND a.program_id = (SELECT id FROM training_programs WHERE key='niete_standard')
  AND EXISTS (SELECT 1 FROM teacher_training_assignments n
              WHERE n.user_id=a.user_id AND n.is_active AND n.assigned_by='level_scoping_migration');
COMMIT;

SELECT p.key, count(distinct a.user_id) AS users
FROM teacher_training_assignments a JOIN training_programs p ON p.id=a.program_id
WHERE a.is_active GROUP BY 1 ORDER BY 2 DESC;
