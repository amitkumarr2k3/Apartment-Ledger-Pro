-- 0003_mviews.sql — rollups that survive sparse months via month spine left-joins
BEGIN;

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
       COALESCE(SUM(t.amount_paise) FILTER (WHERE t.direction='C'), 0)::bigint AS collection_paise,
       COALESCE(SUM(t.amount_paise) FILTER (WHERE t.direction='D'), 0)::bigint AS expense_paise,
       (COALESCE(SUM(t.amount_paise) FILTER (WHERE t.direction='C'), 0)
        - COALESCE(SUM(t.amount_paise) FILTER (WHERE t.direction='D'), 0))::bigint AS net_paise
FROM spine s
LEFT JOIN transactions t
  ON t.community_id = s.community_id AND t.period_month = s.month
GROUP BY s.community_id, s.month;

CREATE UNIQUE INDEX mv_monthly_totals_pk ON mv_monthly_totals (community_id, month);

CREATE MATERIALIZED VIEW mv_category_monthly AS
SELECT t.community_id, t.category_id, c.name AS category_name, h.kind AS head_kind,
       t.period_month AS month,
       SUM(t.amount_paise)::bigint AS amount_paise
FROM transactions t
JOIN categories c ON c.id = t.category_id
JOIN heads h ON h.id = t.head_id
GROUP BY t.community_id, t.category_id, c.name, h.kind, t.period_month;

CREATE INDEX mv_cat_monthly_idx ON mv_category_monthly (community_id, month);

CREATE MATERIALIZED VIEW mv_vendor_ranking AS
SELECT t.community_id, v.id AS vendor_id, v.name AS vendor_name, v.kind AS vendor_kind,
       COALESCE(string_agg(DISTINCT c.name, ', '), '') AS categories,
       SUM(t.amount_paise) FILTER (WHERE t.direction='D')::bigint AS total_expense_paise,
       COUNT(DISTINCT t.period_month) AS months_active
FROM transactions t
JOIN vendors v ON v.id = t.vendor_id
JOIN categories c ON c.id = t.category_id
JOIN heads h ON h.id = t.head_id AND h.kind='expense'
GROUP BY t.community_id, v.id, v.name, v.kind;

CREATE INDEX mv_vendor_ranking_idx ON mv_vendor_ranking (community_id, total_expense_paise DESC);

COMMIT;
