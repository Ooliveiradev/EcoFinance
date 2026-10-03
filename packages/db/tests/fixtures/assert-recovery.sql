DO $$ BEGIN
  IF (SELECT count(*) FROM accounts) <> 2
    OR (SELECT balance FROM accounts WHERE id='00000000-0000-4000-8000-000000000001') <> 1000.00
    OR (SELECT count(*) FROM transactions) <> 2
    OR (SELECT sum(amount) FROM transactions) <> -32.90
    OR NOT EXISTS(SELECT 1 FROM transactions WHERE external_id='fixture-1' AND source='ofx' AND geom IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM ecofinance_migrations WHERE name='0003_owned_finance.sql')
    OR (SELECT count(*) FROM invoices) <> 2
    OR NOT EXISTS(SELECT 1 FROM import_items WHERE state='committed' AND provenance->>'row'='1' AND amount=-42.90)
    OR NOT EXISTS(SELECT 1 FROM budgets WHERE budget_limit=500 AND reserve=100)
    OR NOT EXISTS(SELECT 1 FROM installments WHERE installment_number=1 AND amount=42.90)
    OR NOT EXISTS(SELECT 1 FROM recurrence_occurrences WHERE competence_month='2026-09-01' AND amount=-20)
    OR NOT EXISTS(SELECT 1 FROM preferences WHERE settings->>'locale'='pt-BR') THEN
    RAISE EXCEPTION 'Backup recovery did not preserve financial data and migration history';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM buscar_lancamentos_proximos(-23.55,-46.63,1000)
    WHERE id='00000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'Spatial function did not survive recovery';
  END IF;
END $$;
UPDATE transactions SET latitude=-23.56 WHERE external_id='fixture-1';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM transactions WHERE external_id='fixture-1' AND geom IS NULL) THEN
    RAISE EXCEPTION 'Spatial trigger did not survive recovery';
  END IF;
END $$;
