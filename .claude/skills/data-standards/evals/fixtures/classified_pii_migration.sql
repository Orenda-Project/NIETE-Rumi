-- alembic revision xyz
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnic TEXT, -- PII: Restricted-PII (national ID, comma-heavy note here)
  email TEXT, -- Confidential
  school_id UUID REFERENCES schools(id),
  is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);
