-- Synthetic integration tests. The enclosing transaction always rolls back.
BEGIN;
DO $$
DECLARE
 u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid();
 k text:='synthetic-local-only-decimal-key'; r jsonb; t uuid; before_state jsonb; after_state jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(u,'synthetic-catalog-'||u||'@example.test');
 INSERT INTO public.portfolios(id,user_id,name) VALUES(p,u,'Synthetic exact decimal'),(q,u,'Synthetic nullable');
 INSERT INTO public.user_settings(user_id,portfolio_id,dime_balance) VALUES(u,p,100.123456789012),(u,q,NULL);
 r:=public.record_synced_trade(u,p,'BUY','DECIMAL',0.123456,1.234567,0.000001,current_date,NULL,k);
 t:=(r->>'transaction_id')::uuid;
 IF (SELECT dime_balance FROM public.user_settings WHERE user_id=u AND portfolio_id=p) IS DISTINCT FROM 99.971041085460
 THEN RAISE EXCEPTION 'BUY cash precision lost'; END IF;
 PERFORM public.correct_latest_synced_trade(u,p,t,0,0.000001,0.000001,0.000001,'Synthetic exact decimal correction',k);
 IF (SELECT dime_balance FROM public.user_settings WHERE user_id=u AND portfolio_id=p) IS DISTINCT FROM 100.123455789011
 THEN RAISE EXCEPTION 'corrected cash precision lost'; END IF;
 IF NOT EXISTS(SELECT FROM public.get_trade_correction_capability(u,p,k) WHERE transaction_id=t
   AND shares_exact::numeric=0.000001 AND price_exact::numeric=0.000001 AND fee_exact::numeric=0.000001)
 THEN RAISE EXCEPTION 'exact capability values lost'; END IF;
 RAISE NOTICE 'PASS exact 12-decimal cash and six-decimal BUY correction/capability';
 r:=public.record_synced_trade(u,p,'SELL','DECIMAL',0.000001,1.000001,NULL,current_date,NULL,k);
 t:=(r->>'transaction_id')::uuid;
 IF (SELECT dime_balance FROM public.user_settings WHERE user_id=u AND portfolio_id=p) IS DISTINCT FROM 100.123456789012
 THEN RAISE EXCEPTION 'NULL original fee not treated as zero'; END IF;
 PERFORM public.correct_latest_synced_trade(u,p,t,0,0.000001,2.000001,0,'Synthetic exact SELL correction',k);
 IF (SELECT dime_balance FROM public.user_settings WHERE user_id=u AND portfolio_id=p) IS DISTINCT FROM 100.123457789012
 THEN RAISE EXCEPTION 'SELL cash precision lost'; END IF;
 RAISE NOTICE 'PASS exact full SELL correction and nullable original fee';
 SELECT jsonb_build_object('cash',to_jsonb(s),'holdings',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.holdings h WHERE user_id=u),'ledger',(SELECT to_jsonb(x) FROM public.portfolio_transactions x WHERE id=t),
   'state',(SELECT to_jsonb(x) FROM trade_correction_internal.execution_state x WHERE transaction_id=t),
   'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM trade_correction_internal.audit a WHERE user_id=u))
 INTO before_state FROM public.user_settings s WHERE user_id=u AND portfolio_id=p;
 BEGIN
   PERFORM public.correct_latest_synced_trade(u,p,t,1,NULL,2,0,'Synthetic invalid NULL shares',k);
   RAISE EXCEPTION 'NULL shares accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid correction input' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.correct_latest_synced_trade(u,p,t,1,0.000001,NULL,0,'Synthetic invalid NULL price',k);
   RAISE EXCEPTION 'NULL price accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid correction input' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.correct_latest_synced_trade(u,p,t,1,0.000001,2,NULL,'Synthetic invalid NULL fee',k);
   RAISE EXCEPTION 'NULL correction fee accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid correction input' THEN RAISE; END IF; END;
 SELECT jsonb_build_object('cash',to_jsonb(s),'holdings',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.holdings h WHERE user_id=u),'ledger',(SELECT to_jsonb(x) FROM public.portfolio_transactions x WHERE id=t),
   'state',(SELECT to_jsonb(x) FROM trade_correction_internal.execution_state x WHERE transaction_id=t),
   'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM trade_correction_internal.audit a WHERE user_id=u))
 INTO after_state FROM public.user_settings s WHERE user_id=u AND portfolio_id=p;
 IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'NULL rejection mutated accounting'; END IF;
 RAISE NOTICE 'PASS NULL shares/price/correction fee rejected with exact unchanged accounting';
 CREATE FUNCTION pg_temp.fail_decimal_audit() RETURNS trigger LANGUAGE plpgsql AS $fail$
 BEGIN RAISE EXCEPTION 'synthetic decimal audit failure'; END $fail$;
 CREATE TRIGGER synthetic_decimal_failure AFTER INSERT ON trade_correction_internal.audit
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_decimal_audit();
 BEGIN
   PERFORM public.correct_latest_synced_trade(u,p,t,1,0.000001,3.000001,0.000001,'Synthetic decimal failure rollback',k);
   RAISE EXCEPTION 'audit failure unexpectedly accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic decimal audit failure' THEN RAISE; END IF; END;
 DROP TRIGGER synthetic_decimal_failure ON trade_correction_internal.audit;
 SELECT jsonb_build_object('cash',to_jsonb(s),'holdings',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.holdings h WHERE user_id=u),'ledger',(SELECT to_jsonb(x) FROM public.portfolio_transactions x WHERE id=t),
   'state',(SELECT to_jsonb(x) FROM trade_correction_internal.execution_state x WHERE transaction_id=t),
   'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM trade_correction_internal.audit a WHERE user_id=u))
 INTO after_state FROM public.user_settings s WHERE user_id=u AND portfolio_id=p;
 IF before_state IS DISTINCT FROM after_state OR EXISTS(SELECT FROM trade_correction_internal.write_permit)
 THEN RAISE EXCEPTION 'decimal failure did not roll back exactly'; END IF;
 RAISE NOTICE 'PASS forced audit failure restores exact decimal cash/holdings/ledger/snapshot/audit and clears permits';
 BEGIN
   PERFORM public.record_synced_trade(u,q,'BUY','NULLCASH',1,1,0,current_date,NULL,k);
   RAISE EXCEPTION 'NULL cash BUY accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'insufficient Dime balance' THEN RAISE; END IF; END;
 IF (SELECT dime_balance FROM public.user_settings WHERE user_id=u AND portfolio_id=q) IS NOT NULL
   OR EXISTS(SELECT FROM public.portfolio_transactions WHERE user_id=u AND portfolio_id=q)
   OR EXISTS(SELECT FROM public.holdings WHERE user_id=u AND portfolio_id=q)
 THEN RAISE EXCEPTION 'failed NULL cash BUY left partial state'; END IF;
 RAISE NOTICE 'PASS NULL starting cash fails insufficient-cash BUY without partial writes';
 PERFORM public.upsert_holding(u,q,'NULLSELL',1,1,k,NULL,false);
 r:=public.record_synced_trade(u,q,'SELL','NULLSELL',0.5,1.000001,NULL,current_date,NULL,k);
 PERFORM public.correct_latest_synced_trade(u,q,(r->>'transaction_id')::uuid,0,0.25,1.000001,0,'Synthetic nullable SELL baseline',k);
 IF (SELECT dime_balance FROM public.user_settings WHERE user_id=u AND portfolio_id=q) IS DISTINCT FROM 0.25000025
   OR (SELECT shares FROM public.holdings WHERE user_id=u AND portfolio_id=q AND symbol='NULLSELL') IS DISTINCT FROM 0.75
 THEN RAISE EXCEPTION 'NULL initial cash SELL correction wrong'; END IF;
 RAISE NOTICE 'PASS NULL starting cash SELL and correction use existing zero-cash semantics with exact proceeds';
 UPDATE public.user_settings SET dime_balance=NULL WHERE user_id=u AND portfolio_id=p;
 IF EXISTS(SELECT FROM public.get_trade_correction_capability(u,p,k)) THEN RAISE EXCEPTION 'changed NULL cash exposed capability'; END IF;
 BEGIN
   PERFORM public.correct_latest_synced_trade(u,p,t,1,0.000001,3,0,'Synthetic changed NULL cash',k);
   RAISE EXCEPTION 'changed NULL cash accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'correction state changed' THEN RAISE; END IF; END;
 IF (SELECT dime_balance FROM public.user_settings WHERE user_id=u AND portfolio_id=p) IS NOT NULL
 THEN RAISE EXCEPTION 'NULL cash overwritten'; END IF;
 RAISE NOTICE 'PASS later NULL cash hides capability and rejects correction without overwrite';
 BEGIN
   DELETE FROM auth.users WHERE id=u;
   RAISE EXCEPTION 'account deletion unexpectedly passed guards';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 WHEN raise_exception THEN IF SQLERRM<>'synced transaction is immutable' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=u) OR NOT EXISTS(SELECT FROM trade_correction_internal.execution_state WHERE transaction_id=t)
 THEN RAISE EXCEPTION 'failed account delete lost data'; END IF;
 RAISE NOTICE 'PASS characterization: account deletion blocked by existing immutable guard or FK; no partial deletion';
 INSERT INTO trade_correction_internal.write_permit VALUES(pg_backend_pid(),txid_current(),t,'DELETE');
 BEGIN
   DELETE FROM public.portfolio_transactions WHERE id=t;
   RAISE EXCEPTION 'snapshot FK unexpectedly allowed ledger deletion';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 DELETE FROM trade_correction_internal.write_permit WHERE backend_pid=pg_backend_pid() AND transaction_xid=txid_current();
 IF NOT EXISTS(SELECT FROM public.portfolio_transactions WHERE id=t)
 THEN RAISE EXCEPTION 'snapshot FK lost ledger'; END IF;
 RAISE NOTICE 'PASS characterization: snapshot FK independently rejects a permitted ledger deletion';
END $$;
ROLLBACK;
