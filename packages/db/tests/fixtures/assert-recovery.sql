DO $$ BEGIN
  IF (SELECT count(*) FROM accounts) <> 1
    OR (SELECT balance FROM accounts WHERE id='00000000-0000-4000-8000-000000000001') <> 1000.00
    OR (SELECT count(*) FROM transactions) <> 2
    OR (SELECT sum(amount) FROM transactions) <> -32.90
    OR NOT EXISTS(SELECT 1 FROM transactions WHERE external_id='fixture-1' AND source='ofx' AND geom IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM ecofinance_migrations WHERE name='0001_init.sql') THEN
    RAISE EXCEPTION 'Recovery did not preserve synthetic financial data and migration history';
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
