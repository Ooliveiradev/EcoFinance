-- Refuse duplicate IDs before creating the uniqueness required by OFX/Pluggy upserts.
-- No automatic deletion or rewriting of existing financial records.
DO $$ BEGIN
 IF EXISTS (SELECT external_id FROM transactions WHERE external_id IS NOT NULL GROUP BY external_id HAVING count(*) > 1)
 THEN RAISE EXCEPTION 'Duplicate transaction external IDs require manual reconciliation'; END IF;
END $$;
DROP INDEX IF EXISTS idx_transactions_external_id;
CREATE UNIQUE INDEX idx_transactions_external_id ON transactions(external_id);
