-- 0011_fix_mv_monthly_totals.sql
-- Fixes mv_monthly_totals (originally defined in 0003_mviews.sql), which
-- never joined heads or categories at all -- it summed EVERY transaction
-- with direction='C' into "collection_paise", regardless of head.kind or
-- category. This silently swept in:
--   - Every 'reference'-kind row (Maintenance/Contingency/Expected
--     Collection Rate References) -- pure planning/target figures that
--     are never real cash, e.g. a July "Expected Collection Reference" of
--     Rs 28.76L got counted as if it were Rs 28.76L actually collected.
--   - "Maintenance Outstanding" (Previous Arrears Brought Forward +
--     Current Month Unpaid Maintenance) -- a liability/snapshot, not real
--     collected income. Worse, BF is ITSELF a cumulative running total, so
--     summing it again month-over-month massively inflates any
--     Opening/Closing balance built on top of this view.
--   - "Tax Collected (Liability)" (CGST/SGST) -- money held on behalf of
--     the government, not the society's income.
--
-- This is why Opening & Closing (RD-40/RD-43) and any other page reading
-- straight from mv_monthly_totals showed wildly inflated income/balance
-- figures, while Overview (which recomputes everything by hand with
-- proper category exclusions) showed the correct numbers.
--
-- Exclusion uses the SAME regex philosophy already used on the frontend
-- (isLiability = /outstanding|arrears|default/i, isTax = /tax|gst|cgst|sgst/i)
-- rather than hardcoded exact category names, so it stays correct even if
-- category names are renamed slightly later.
--
-- Materialized views can't be ALTERed in place -- drop and recreate.
-- mv_category_monthly and mv_vendor_ranking are NOT affected: both already
-- join heads/categories properly and expose head_kind/category_name for
-- the consuming query to filter on, so no fix is needed there.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS mv_monthly_totals;

CREATE MATERIALIZED VIEW mv_monthly_totals AS
WITH spine AS (
  SELECT c.id AS community_id,
         (date_trunc('month', gs)::date) AS month
  FROM communities c
  CROSS JOIN generate_series(
    (SELECT COALESCE(MIN(period_month), CURRENT_DATE) FROM transactions),
    (SELECT COALESCE(MAX(period_month), CURRENT_DATE) FROM transactions),
    interval '1 month'
  ) gs
)
SELECT s.community_id, s.month,
       COALESCE(SUM(t.amount_paise) FILTER (
         WHERE h.kind = 'income'
           AND c.name !~* '(outstanding|arrears|default|tax|gst)'
       ), 0)::bigint AS collection_paise,
       COALESCE(SUM(t.amount_paise) FILTER (WHERE h.kind = 'expense'), 0)::bigint AS expense_paise,
       (
         COALESCE(SUM(t.amount_paise) FILTER (
           WHERE h.kind = 'income'
             AND c.name !~* '(outstanding|arrears|default|tax|gst)'
         ), 0)
         - COALESCE(SUM(t.amount_paise) FILTER (WHERE h.kind = 'expense'), 0)
       )::bigint AS net_paise
FROM spine s
LEFT JOIN transactions t
  ON t.community_id = s.community_id AND t.period_month = s.month
LEFT JOIN heads h ON h.id = t.head_id
LEFT JOIN categories c ON c.id = t.category_id
GROUP BY s.community_id, s.month;

CREATE UNIQUE INDEX mv_monthly_totals_pk ON mv_monthly_totals (community_id, month);

COMMIT;
