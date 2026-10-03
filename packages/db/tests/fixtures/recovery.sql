BEGIN;
INSERT INTO users(id,display_name) VALUES ('10000000-0000-4000-8000-000000000001','Pessoa A'),('20000000-0000-4000-8000-000000000001','Pessoa B');
SELECT set_config('ecofinance.owner_id','10000000-0000-4000-8000-000000000001',true);
INSERT INTO accounts (id,name,balance,opening_balance,opening_date) VALUES ('00000000-0000-4000-8000-000000000001','Backup sintético','1000.00','500.00','2026-09-01');
INSERT INTO accounts(id,owner_id,name) VALUES ('00000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','Conta B');
INSERT INTO categories(id,owner_id,name) VALUES ('00000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','Categoria A'),('00000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','Categoria B');
INSERT INTO transactions (id,account_id,category_id,purchase_date,competence_month,kind,review_required,description,amount,date,category,source,external_id,latitude,longitude) VALUES
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','2026-09-30','2026-09-01','expense',false,'Compra sintética','-42.90','2026-09-30T15:00:00Z','comida','ofx','fixture-1',-23.55,-46.63),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','2026-10-01','2026-10-01','refund',false,'Estorno sintético','10.00','2026-10-01T15:00:00Z','comida','manual',NULL,NULL,NULL);
DO $$
DECLARE owner_a uuid := '10000000-0000-4000-8000-000000000001'; owner_b uuid := '20000000-0000-4000-8000-000000000001';
 card_a uuid; card_b uuid; invoice_a uuid; rule_a uuid; budget_a uuid; group_a uuid; installment_a uuid; batch_a uuid;
BEGIN
 INSERT INTO cards(name,payment_account_id,closing_day,due_day) VALUES('Cartão A','00000000-0000-4000-8000-000000000001',25,5) RETURNING id INTO card_a;
 INSERT INTO cards(owner_id,name,payment_account_id,closing_day,due_day) VALUES(owner_b,'Cartão B','00000000-0000-4000-8000-000000000004',25,5) RETURNING id INTO card_b;
 INSERT INTO invoices(card_id,competence_month,closing_date,due_date,stated_total) VALUES(card_a,'2026-09-01','2026-09-25','2026-10-05','42.90') RETURNING id INTO invoice_a;
 INSERT INTO invoices(owner_id,card_id,competence_month,closing_date,due_date) VALUES(owner_b,card_b,'2026-09-01','2026-09-25','2026-10-05');
 INSERT INTO recurrence_rules(account_id,category_id,description,amount,start_date,due_day) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Recorrente','-20.00','2026-09-01',30) RETURNING id INTO rule_a;
 INSERT INTO recurrence_occurrences(rule_id,competence_month,due_date,amount) VALUES(rule_a,'2026-09-01','2026-09-30','-20.00');
 INSERT INTO budgets(competence_month,budget_limit,expected_income,reserve) VALUES('2026-09-01','500','1500','100') RETURNING id INTO budget_a;
 INSERT INTO budget_categories(budget_id,category_id,budget_limit) VALUES(budget_a,'00000000-0000-4000-8000-000000000010','100');
 INSERT INTO installment_groups(card_id,description,total_amount,installment_count,purchase_date) VALUES(card_a,'Compra parcelada','85.80',2,'2026-09-20') RETURNING id INTO group_a;
 INSERT INTO installments(group_id,invoice_id,installment_number,amount,competence_month) VALUES(group_a,invoice_a,1,'42.90','2026-09-01') RETURNING id INTO installment_a;
 UPDATE transactions SET invoice_id=invoice_a,installment_id=installment_a WHERE id='00000000-0000-4000-8000-000000000002';
 INSERT INTO import_batches(account_id,source,idempotency_key,state,file_hash,storage_key,expires_at) VALUES('00000000-0000-4000-8000-000000000001','ofx','fixture-import','confirmed','synthetic-hash','synthetic-object','2026-11-01T00:00:00Z') RETURNING id INTO batch_a;
 INSERT INTO import_items(batch_id,position,account_id,category_id,invoice_id,transaction_id,amount,currency,description,kind,purchase_date,competence_month,provenance,warnings,state) VALUES(batch_a,1,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',invoice_a,'00000000-0000-4000-8000-000000000002','-42.90','BRL','Compra sintética','expense','2026-09-30','2026-09-01','{"row":1,"excerpt":"Compra sintética"}','["fixture"]','committed');
 INSERT INTO preferences(settings) VALUES('{"locale":"pt-BR"}');
END $$;
COMMIT;
