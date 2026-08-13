-- 0009_reference_head_kind.sql
-- Adds a 'reference' value to the head_kind enum so non-monetary
-- reference/lookup transactions (e.g. the per-sqft maintenance rate card
-- used to compute the "Expected Collection" figure) can be stored in the
-- transactions table without being picked up by any existing income or
-- expense aggregation. mv_monthly_totals, the balance-strip query, and
-- income.ts's /category-totals all filter explicitly on
-- kind = 'income' / kind = 'expense', so a 'reference'-kind head is
-- structurally invisible to them by design -- no other query needs to
-- change to stay unaffected by this new kind.
--
-- Safe to re-run: ADD VALUE IF NOT EXISTS is a no-op if the label already
-- exists (requires Postgres 12+).

ALTER TYPE head_kind ADD VALUE IF NOT EXISTS 'reference';