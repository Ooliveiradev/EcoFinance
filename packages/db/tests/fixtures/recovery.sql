INSERT INTO accounts (id,name,balance) VALUES ('00000000-0000-4000-8000-000000000001','Backup sintético','1000.00');
INSERT INTO transactions (id,account_id,description,amount,date,category,source,external_id,latitude,longitude) VALUES
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Compra sintética','-42.90','2026-09-30T15:00:00Z','comida','ofx','fixture-1',-23.55,-46.63),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Estorno sintético','10.00','2026-10-01T15:00:00Z','comida','manual',NULL,NULL,NULL);
