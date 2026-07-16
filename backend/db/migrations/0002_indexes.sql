-- 0002_indexes.sql
BEGIN;
CREATE INDEX idx_txn_community_month ON transactions (community_id, period_month);
CREATE INDEX idx_txn_category_month  ON transactions (category_id, period_month);
CREATE INDEX idx_txn_vendor_month    ON transactions (vendor_id, period_month);
CREATE INDEX idx_txn_head_month      ON transactions (head_id, period_month);
CREATE INDEX idx_txn_flat_month      ON transactions (flat_id, period_month);
CREATE INDEX idx_audit_at            ON audit_log (at DESC);
CREATE INDEX idx_audit_entity        ON audit_log (entity, entity_id);
COMMIT;
