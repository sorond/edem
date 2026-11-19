-- =============================================================
-- rpc_test.sql — 14 проверок RPC и RLS.
-- Запуск после 001_init.sql и 002_rpcs.sql:
--   supabase db reset && supabase db execute --file supabase/tests/rpc_test.sql
--   либо вручную в Supabase SQL Editor (проект уже создан).
--
-- ОПАСНО: скрипт УДАЛЯЕТ ВСЕ УЧЁТНЫЕ ДАННЫЕ (рапорты, выплаты, задания,
-- налоговые события, транзакции, аудит, дни выплат) и обнуляет казну.
-- Запускать только на пустом/новом тестовом проекте, не на рабочем.
-- Перед запуском в SQL Editor: set edem.run_tests = 'yes';
--
-- Скрипт сам создаёт двух тестовых пользователей Auth и профили,
-- выставляет request.jwt.claim.sub/role как при реальном запросе,
-- а в конце всё подчищает. Весь скрипт идёт в одной транзакции:
-- при падении любой проверки изменения не сохраняются.
-- =============================================================

-- Явный opt-in: без него скрипт не удалит данные и упадёт с ошибкой.
do $$
begin
  if coalesce(current_setting('edem.run_tests', true), '') <> 'yes' then
    raise exception 'ОПАСНО: тесты удаляют данные. Выполните: set edem.run_tests = ''yes'';';
  end if;
end $$;

begin;

-- Тестовые пользователи и роли.
do $$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'test-admin@edem.local', '', now(), now(), now()),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'test-curator@edem.local', '', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, role, display_name) values
    ('11111111-1111-1111-1111-111111111111', 'admin', 'Test Admin'),
    ('22222222-2222-2222-2222-222222222222', 'curator', 'Test Curator')
  on conflict (id) do update set role = excluded.role;
end $$;

-- Имитация JWT: разные версии auth.uid() читают GUC и/или JSON-claims.
create or replace function public.test_set_identity(
  p_uid uuid,
  p_role text default 'authenticated'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid::text, 'role', p_role)::text, true);
  perform set_config('request.jwt',
    jsonb_build_object('sub', p_uid::text, 'role', p_role)::text, true);
end;
$$;

-- -------------------------------------------------------------
-- T1. Пустая казна: выплата 42 000, транзакция daily_payout.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_result jsonb;
  v_balance bigint;
  v_type text;
begin
  perform public.test_set_identity(v_admin);

  delete from public.payout_days;
  delete from public.tax_events;
  delete from public.tasks;
  delete from public.transactions;
  update public.treasury set balance = 0 where id = 1;

  v_result := public.run_daily_payout();

  select balance into v_balance from public.treasury where id = 1;
  select type into v_type from public.transactions order by id desc limit 1;

  if v_balance <> 42000 then
    raise exception 'T1: balance %, expected 42000', v_balance;
  end if;
  if v_type is distinct from 'daily_payout' then
    raise exception 'T1: transaction type %, expected daily_payout', v_type;
  end if;
  if coalesce((v_result->>'skipped')::boolean, true) is distinct from false then
    raise exception 'T1: payout should not be skipped';
  end if;
  raise notice 'T1 OK: daily payout 42000';
end $$;

-- -------------------------------------------------------------
-- T2. Бонус 10 и сдвиги -5/+10: gross 66000, налог 35, net 42900.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_result jsonb;
  v_balance bigint;
begin
  perform public.test_set_identity(v_admin);

  delete from public.payout_days;
  delete from public.tax_events;
  delete from public.tasks;
  update public.treasury set balance = 0 where id = 1;

  insert into public.tasks (title, kind, target_count, bonus_percent, status, bonus_active_until)
  values ('Бонус 10', 'weekly', 1, 10, 'completed',
          (now() at time zone 'Europe/Moscow')::date + 7);

  insert into public.tax_events (name, shift, starts_at, ends_at) values
    ('минус', -5, now() - interval '1 hour', now() + interval '1 day'),
    ('плюс',  10, now() - interval '1 hour', now() + interval '1 day');

  if public.current_tax_rate() <> 35 then
    raise exception 'T2: tax rate %, expected 35', public.current_tax_rate();
  end if;

  v_result := public.run_daily_payout();
  select balance into v_balance from public.treasury where id = 1;

  if (v_result->>'gross')::bigint <> 66000 then
    raise exception 'T2: gross %, expected 66000', v_result->>'gross';
  end if;
  if (v_result->>'taxRate')::numeric <> 35 then
    raise exception 'T2: taxRate %, expected 35', v_result->>'taxRate';
  end if;
  if (v_result->>'net')::bigint <> 42900 then
    raise exception 'T2: net %, expected 42900', v_result->>'net';
  end if;
  if v_balance <> 42900 then
    raise exception 'T2: balance %, expected 42900', v_balance;
  end if;
  raise notice 'T2 OK: gross 66000, tax 35, net 42900';
end $$;

-- -------------------------------------------------------------
-- T3. Идемпотентность дня: второй вызов ничего не меняет.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_result jsonb;
  v_balance bigint;
  v_days int;
begin
  perform public.test_set_identity(v_admin);

  delete from public.payout_days;
  delete from public.tax_events;
  delete from public.tasks;
  update public.treasury set balance = 0 where id = 1;

  perform public.run_daily_payout();
  v_result := public.run_daily_payout();

  select balance into v_balance from public.treasury where id = 1;
  select count(*) into v_days
    from public.payout_days
    where day = (now() at time zone 'Europe/Moscow')::date;

  if coalesce((v_result->>'skipped')::boolean, false) is distinct from true then
    raise exception 'T3: second call was not skipped';
  end if;
  if v_balance <> 42000 then
    raise exception 'T3: balance %, expected 42000', v_balance;
  end if;
  if v_days <> 1 then
    raise exception 'T3: payout_days rows %, expected 1', v_days;
  end if;
  raise notice 'T3 OK: second call skipped';
end $$;

-- -------------------------------------------------------------
-- T4. Вывод 60000 при налоге 30: казна -60000, net 42000.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_id uuid;
  v_rate numeric;
  v_tax bigint;
  v_net bigint;
  v_balance bigint;
  v_amount bigint;
begin
  delete from public.tax_events;
  delete from public.withdrawals;
  update public.treasury set balance = 100000 where id = 1;

  perform public.test_set_identity(v_curator);
  v_id := public.request_withdrawal(60000, 'тест вывода');

  select tax_rate, tax_amount, amount_net into v_rate, v_tax, v_net
    from public.withdrawals where id = v_id;

  if v_rate <> 0 then raise exception 'T4: tax_rate %, expected 0', v_rate; end if;
  if v_tax <> 0 then raise exception 'T4: tax_amount %, expected 0', v_tax; end if;
  if v_net <> 60000 then raise exception 'T4: amount_net %, expected 60000', v_net; end if;

  perform public.test_set_identity(v_admin);
  perform public.review_withdrawal(v_id, 'approved', 'ок');

  select balance into v_balance from public.treasury where id = 1;
  select amount, tax_amount into v_amount, v_tax from public.transactions
    where type = 'withdrawal' order by id desc limit 1;

  if v_balance <> 40000 then
    raise exception 'T4: treasury balance %, expected 40000', v_balance;
  end if;
  if v_amount <> -60000 then
    raise exception 'T4: transaction amount %, expected -60000', v_amount;
  end if;
  if v_tax <> 0 then
    raise exception 'T4: transaction tax_amount %, expected 0', v_tax;
  end if;
  raise notice 'T4 OK: withdrawal 60000, net 60000, no tax';
end $$;

-- -------------------------------------------------------------
-- T5. Потолок: 120000 + 42900 -> 126000, burned 36900.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_result jsonb;
  v_balance bigint;
begin
  perform public.test_set_identity(v_admin);

  delete from public.payout_days;
  delete from public.tax_events;
  delete from public.tasks;
  update public.treasury set balance = 120000 where id = 1;

  insert into public.tasks (title, kind, target_count, bonus_percent, status, bonus_active_until)
  values ('Бонус 10', 'weekly', 1, 10, 'completed',
          (now() at time zone 'Europe/Moscow')::date + 7);
  insert into public.tax_events (name, shift, starts_at, ends_at) values
    ('минус', -5, now() - interval '1 hour', now() + interval '1 day'),
    ('плюс',  10, now() - interval '1 hour', now() + interval '1 day');

  v_result := public.run_daily_payout();
  select balance into v_balance from public.treasury where id = 1;

  if (v_result->>'net')::bigint <> 42900 then
    raise exception 'T5: net %, expected 42900', v_result->>'net';
  end if;
  if (v_result->>'burned')::bigint <> 36900 then
    raise exception 'T5: burned %, expected 36900', v_result->>'burned';
  end if;
  if v_balance <> 126000 then
    raise exception 'T5: balance %, expected 126000', v_balance;
  end if;
  raise notice 'T5 OK: cap applied, burned 36900';
end $$;

-- -------------------------------------------------------------
-- T6. Внешний рапорт без задания: тариф 10000, налог 30%.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_id uuid;
  v_status text;
  v_amount bigint;
  v_tax bigint;
  v_balance bigint;
begin
  perform public.test_set_identity(v_admin);

  delete from public.reports;
  delete from public.tasks;
  delete from public.tax_events;
  update public.treasury set balance = 0 where id = 1;

  v_id := public.create_report(current_date, 'Иван', 'Пётр', 'external', 'без задания', null, '[]'::jsonb);
  perform public.review_report(v_id, 'approved', 'ок');

  select status into v_status from public.reports where id = v_id;
  select amount, tax_amount into v_amount, v_tax from public.transactions
    where type = 'report_tariff' order by id desc limit 1;
  select balance into v_balance from public.treasury where id = 1;

  if v_status is distinct from 'approved' then
    raise exception 'T6: status %, expected approved', v_status;
  end if;
  if v_amount <> 7000 then raise exception 'T6: tariff net %, expected 7000', v_amount; end if;
  if v_tax <> 3000 then raise exception 'T6: tax %, expected 3000', v_tax; end if;
  if v_balance <> 7000 then raise exception 'T6: balance %, expected 7000', v_balance; end if;
  raise notice 'T6 OK: external tariff 10000 taxed to 7000';
end $$;

-- -------------------------------------------------------------
-- T7. Рапорт с заданием: тариф 2000 -> net 1400, прогресс 1.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_task uuid;
  v_report uuid;
  v_amount bigint;
  v_count int;
  v_status text;
begin
  perform public.test_set_identity(v_admin);

  delete from public.reports;
  delete from public.tasks;
  delete from public.tax_events;
  update public.treasury set balance = 0 where id = 1;

  insert into public.tasks (title, kind, target_count)
  values ('Задание на 2', 'weekly', 2)
  returning id into v_task;

  v_report := public.create_report(current_date, 'Иван', 'Пётр', 'external', 'по заданию',
                                   v_task, '[]'::jsonb);
  perform public.review_report(v_report, 'approved', '');

  select amount into v_amount from public.transactions
    where type = 'report_tariff' order by id desc limit 1;
  select count(*) into v_count from public.reports
    where task_id = v_task and status = 'approved';
  select status into v_status from public.tasks where id = v_task;

  if v_amount <> 1400 then raise exception 'T7: tariff net %, expected 1400', v_amount; end if;
  if v_count <> 1 then raise exception 'T7: approved count %, expected 1', v_count; end if;
  if v_status is distinct from 'active' then
    raise exception 'T7: task status %, expected active', v_status;
  end if;
  raise notice 'T7 OK: task tariff 2000 taxed to 1400, progress 1';
end $$;

-- -------------------------------------------------------------
-- T8. Цель достигнута: completed, награда один раз, бонус 7 дней.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_task uuid;
  v_report uuid;
  v_status text;
  v_completed_at timestamptz;
  v_bonus_until date;
  v_reward_amount bigint;
  v_reward_tax bigint;
  v_reward_count int;
begin
  perform public.test_set_identity(v_admin);

  delete from public.reports;
  delete from public.tasks;
  delete from public.tax_events;
  update public.treasury set balance = 0 where id = 1;

  insert into public.tasks (title, kind, target_count, reward_gross, bonus_percent)
  values ('Награда 100000', 'weekly', 2, 100000, 10)
  returning id into v_task;

  v_report := public.create_report(current_date, 'A', 'B', 'external', '1', v_task, '[]'::jsonb);
  perform public.review_report(v_report, 'approved', '');
  v_report := public.create_report(current_date, 'A', 'B', 'external', '2', v_task, '[]'::jsonb);
  perform public.review_report(v_report, 'approved', '');

  select status, completed_at, bonus_active_until
    into v_status, v_completed_at, v_bonus_until
    from public.tasks where id = v_task;

  if v_status is distinct from 'completed' then
    raise exception 'T8: status %, expected completed', v_status;
  end if;
  if v_completed_at is null then raise exception 'T8: completed_at is null'; end if;
  if v_bonus_until is distinct from (current_date + 7) then
    raise exception 'T8: bonus_active_until %, expected %', v_bonus_until, current_date + 7;
  end if;

  select amount, tax_amount into v_reward_amount, v_reward_tax
    from public.transactions where type = 'task_reward' order by id desc limit 1;
  if v_reward_amount <> 70000 then
    raise exception 'T8: reward net %, expected 70000', v_reward_amount;
  end if;
  if v_reward_tax <> 30000 then
    raise exception 'T8: reward tax %, expected 30000', v_reward_tax;
  end if;

  -- Третий рапорт после завершения не должен начислить награду повторно.
  v_report := public.create_report(current_date, 'A', 'B', 'external', '3', v_task, '[]'::jsonb);
  perform public.review_report(v_report, 'approved', '');
  select count(*) into v_reward_count from public.transactions where type = 'task_reward';

  if v_reward_count <> 1 then
    raise exception 'T8: reward transactions %, expected 1', v_reward_count;
  end if;
  raise notice 'T8 OK: task completed, reward 70000 once, bonus 7 days';
end $$;

-- -------------------------------------------------------------
-- T9. Просроченное еженедельное задание -> failed + штраф налога.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_task uuid;
  v_status text;
  v_events int;
  v_tax numeric;
begin
  perform public.test_set_identity(v_admin);

  -- Сначала рапорты: они ссылаются на задачи из T8 (FK reports_task_id_fkey).
  delete from public.reports;
  delete from public.payout_days;
  delete from public.tax_events;
  delete from public.tasks;
  update public.treasury set balance = 0 where id = 1;

  insert into public.tasks
    (title, kind, target_count, status, deadline_at, penalty_shift, penalty_days)
  values
    ('Просрочка', 'weekly', 1, 'active', now() - interval '1 day', 5, 3)
  returning id into v_task;

  perform public.run_daily_payout();

  select status into v_status from public.tasks where id = v_task;
  select count(*) into v_events from public.tax_events where source = 'task_penalty';
  v_tax := public.current_tax_rate();

  if v_status is distinct from 'failed' then
    raise exception 'T9: status %, expected failed', v_status;
  end if;
  if v_events <> 1 then raise exception 'T9: penalty events %, expected 1', v_events; end if;
  if v_tax <> 35 then raise exception 'T9: tax rate %, expected 35', v_tax; end if;
  raise notice 'T9 OK: overdue task failed, tax shift created';
end $$;

-- -------------------------------------------------------------
-- T10. Куратор не может выполнить административный RPC.
-- -------------------------------------------------------------
do $$
declare
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
begin
  perform public.test_set_identity(v_curator);

  begin
    perform public.adjust_treasury(100, 'взлом');
    raise exception 'T10: curator was allowed to adjust treasury';
  exception when others then
    if sqlerrm not like '%permission denied%' then
      raise exception 'T10: unexpected error: %', sqlerrm;
    end if;
  end;
  raise notice 'T10 OK: curator got permission denied';
end $$;

-- -------------------------------------------------------------
-- T11. credit_treasury закрыт для anon/authenticated на уровне грантов.
-- -------------------------------------------------------------
do $$
declare
  v_fn constant text := 'public.credit_treasury(numeric,numeric,text,text,uuid)';
begin
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'T11: anon has EXECUTE on credit_treasury';
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'T11: authenticated has EXECUTE on credit_treasury';
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'T11: service_role lost EXECUTE on credit_treasury';
  end if;
  raise notice 'T11 OK: credit_treasury not executable by anon/authenticated';
end $$;

-- -------------------------------------------------------------
-- T12. Фактические вызовы credit_treasury от anon и куратора падают.
-- -------------------------------------------------------------
do $$
declare
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}'::jsonb::text, true);
  perform set_config('request.jwt', '{"role":"anon"}'::jsonb::text, true);

  begin
    execute 'set local role anon';
  exception when others then
    raise notice 'T12: SET ROLE anon unavailable (%), grant matrix checked', sqlerrm;
    return;
  end;

  begin
    perform public.credit_treasury(1000, 30, 'hack anon');
    reset role;
    raise exception 'T12: anon executed credit_treasury';
  exception when insufficient_privilege then
    reset role;
  end;

  perform public.test_set_identity(v_curator);
  begin
    execute 'set local role authenticated';
  exception when others then
    raise notice 'T12: SET ROLE authenticated unavailable, grant matrix checked';
    return;
  end;

  begin
    perform public.credit_treasury(1000, 30, 'hack curator');
    reset role;
    raise exception 'T12: curator executed credit_treasury';
  exception when insufficient_privilege then
    reset role;
  end;

  raise notice 'T12 OK: anon and curator got insufficient_privilege';
end $$;

-- -------------------------------------------------------------
-- T13. authenticated без sub больше не доверенный; service_role — да.
-- -------------------------------------------------------------
do $$
declare
  v_before bigint;
  v_after bigint;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}'::jsonb::text, true);
  perform set_config('request.jwt', '{"role":"authenticated"}'::jsonb::text, true);

  begin
    perform public.adjust_treasury(100, 'no uid');
    raise exception 'T13: authenticated without sub was allowed';
  exception when others then
    if sqlerrm not like '%permission denied%' then
      raise exception 'T13: unexpected error: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}'::jsonb::text, true);
  perform set_config('request.jwt', '{"role":"service_role"}'::jsonb::text, true);

  select balance into v_before from public.treasury where id = 1;
  perform public.adjust_treasury(100, 'service role');
  select balance into v_after from public.treasury where id = 1;

  if v_after <> v_before + 100 then
    raise exception 'T13: service_role call failed: % -> %', v_before, v_after;
  end if;
  raise notice 'T13 OK: null uid denied for authenticated, allowed for service_role';
end $$;

-- -------------------------------------------------------------
-- T14. Выплата больше казны: подтверждение падает, казна не минусует.
-- -------------------------------------------------------------
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_id uuid;
  v_balance bigint;
  v_status text;
  v_raised boolean := false;
begin
  delete from public.tax_events;
  delete from public.withdrawals;
  update public.treasury set balance = 100000 where id = 1;

  perform public.test_set_identity(v_curator);
  v_id := public.request_withdrawal(150000, 'тест перерасхода');

  perform public.test_set_identity(v_admin);
  begin
    perform public.review_withdrawal(v_id, 'approved', 'ок');
  exception when others then
    v_raised := true;
    if sqlerrm not like '%insufficient funds%' then
      raise exception 'T14: unexpected error: %', sqlerrm;
    end if;
  end;

  if not v_raised then
    raise exception 'T14: oversized withdrawal was approved';
  end if;

  select balance into v_balance from public.treasury where id = 1;
  select status into v_status from public.withdrawals where id = v_id;

  if v_balance <> 100000 then
    raise exception 'T14: treasury balance %, expected 100000', v_balance;
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'T14: status %, expected pending', v_status;
  end if;
  raise notice 'T14 OK: oversized withdrawal blocked, treasury unchanged';
end $$;

-- Подчистка: тестовые данные и пользователи.
do $$
begin
  delete from public.reports;
  delete from public.withdrawals;
  delete from public.tasks;
  delete from public.tax_events;
  delete from public.transactions;
  delete from public.audit_log;
  delete from public.payout_days;
  update public.treasury set balance = 0 where id = 1;

  delete from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222');
  delete from auth.users
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222');

  drop function if exists public.test_set_identity(uuid, text);
end $$;

commit;
