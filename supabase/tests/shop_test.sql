-- =============================================================
-- shop_test.sql — проверки схемы, RLS и RPC магазина.
-- Запуск на РАЗОВОМ тестовом проекте, никогда не на рабочем:
--   supabase db query --remote=<test-ref> --file supabase/migrations/001_init.sql --yes
--   supabase db query --remote=<test-ref> --file supabase/migrations/002_rpcs.sql --yes
--   supabase db query --remote=<test-ref> --file supabase/migrations/003_withdrawal_no_tax.sql --yes
--   supabase db query --remote=<test-ref> --file supabase/migrations/004_shop.sql --yes
--   supabase db query --remote=<test-ref> --file supabase/tests/shop_test.sql --yes
--
-- Перед запуском в SQL Editor: set edem.run_tests = 'yes';
-- Весь скрипт идёт в одной транзакции и заканчивается ROLLBACK:
-- тестовые данные не сохраняются даже при ошибке.
-- =============================================================

set edem.run_tests = 'yes';

do $$
begin
  if coalesce(current_setting('edem.run_tests', true), '') <> 'yes' then
    raise exception 'ОПАСНО: тесты магазина. Выполните: set edem.run_tests = ''yes'';';
  end if;
end $$;

begin;

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

-- T0. Схема магазина и RLS.
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_missing text;
  v_visible int;
  v_own_orders int;
  v_admin_orders int;
  v_item_active uuid;
  v_item_hidden uuid;
begin
  select string_agg(t.table_name || '.' || t.column_name, ', ' order by t.table_name, t.column_name)
    into v_missing
  from (
    values
      ('shop_items', 'id'), ('shop_items', 'name'), ('shop_items', 'icon'),
      ('shop_items', 'category'), ('shop_items', 'stock'), ('shop_items', 'price'),
      ('shop_items', 'active'), ('shop_orders', 'id'), ('shop_orders', 'curator'),
      ('shop_orders', 'status'), ('shop_orders', 'total'),
      ('shop_order_items', 'id'), ('shop_order_items', 'order_id'),
      ('shop_order_items', 'item_id'), ('shop_order_items', 'unit_price'),
      ('shop_order_items', 'quantity'), ('shop_order_items', 'line_total')
  ) as t(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = t.table_name
      and c.column_name = t.column_name
  );

  if v_missing is not null then
    raise exception 'T0: отсутствуют колонки: %', v_missing;
  end if;

  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-admin@edem.local', '', now(), now(), now()),
    (v_curator, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-curator@edem.local', '', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, role, display_name) values
    (v_admin, 'admin', 'Test Admin'),
    (v_curator, 'curator', 'Test Curator')
  on conflict (id) do update set role = excluded.role;

  insert into public.shop_items (name, icon, category, stock, price, active)
  values ('ЩИТ', '△', 'ЗАЩИТА', 5, 100, true) returning id into v_item_active;

  insert into public.shop_items (name, icon, category, stock, price, active)
  values ('СКРЫТЫЙ', '✕', 'ПРОЧЕЕ', 5, 100, false) returning id into v_item_hidden;

  insert into public.shop_orders (curator, status, total, created_by)
  values (v_admin, 'new', 0, v_admin);

  -- Роль postgres обходит RLS: переключаемся на authenticated, как в реальном запросе.
  execute 'set local role authenticated';

  perform public.test_set_identity(v_curator);
  select count(*) into v_visible from public.shop_items;
  select count(*) into v_own_orders from public.shop_orders;
  if v_visible <> 1 then
    raise exception 'T0: куратор видит % товаров, ожидался 1', v_visible;
  end if;
  if v_own_orders <> 0 then
    raise exception 'T0: куратор видит % чужих заказов', v_own_orders;
  end if;

  perform public.test_set_identity(v_admin);
  select count(*) into v_admin_orders from public.shop_orders;
  if v_admin_orders <> 1 then
    raise exception 'T0: админ видит % заказов, ожидался 1', v_admin_orders;
  end if;
  if (select count(*) from public.shop_items) <> 2 then
    raise exception 'T0: админ должен видеть выключенный товар';
  end if;

  raise notice 'T0 OK: schema and RLS';
end $$;

-- T1. Заказ 2×100 списывает 200 из казны и создаёт резерв.
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_item uuid;
  v_order uuid;
  v_balance bigint;
  v_type text;
  v_amount bigint;
  v_quantity int;
  v_result jsonb;
begin
  execute 'set local role postgres';
  update public.treasury set balance = 100000 where id = 1;
  insert into public.shop_items (name, icon, category, stock, price)
  values ('T1 ТОВАР', '1', 'T1', 10, 100) returning id into v_item;

  execute 'set local role authenticated';
  perform public.test_set_identity(v_curator);
  v_result := public.shop_create_order(
    jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2))
  );
  v_order := (v_result ->> 'orderId')::uuid;

  select balance into v_balance from public.treasury where id = 1;
  if v_balance <> 99800 then
    raise exception 'T1: balance %, expected 99800', v_balance;
  end if;
  select type, amount into v_type, v_amount
  from public.transactions order by id desc limit 1;
  if v_type is distinct from 'shop_reserve' or v_amount <> -200 then
    raise exception 'T1: transaction %, %', v_type, v_amount;
  end if;
  select status into v_type from public.shop_orders where id = v_order;
  if v_type is distinct from 'new' then
    raise exception 'T1: status %', v_type;
  end if;
  select quantity into v_quantity from public.shop_order_items where order_id = v_order;
  if v_quantity <> 2 then
    raise exception 'T1: quantity %', v_quantity;
  end if;
  raise notice 'T1 OK: reserve 200';
end $$;

-- T2. Нехватка денег: заказ не создаётся, казна не меняется.
do $$
declare
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_item uuid;
  v_before int;
  v_after int;
  v_balance bigint;
  v_raised boolean := false;
begin
  execute 'set local role postgres';
  update public.treasury set balance = 50 where id = 1;
  insert into public.shop_items (name, icon, category, stock, price)
  values ('T2 ТОВАР', '2', 'T2', 10, 100) returning id into v_item;
  select count(*) into v_before from public.shop_orders;

  execute 'set local role authenticated';
  begin
    perform public.test_set_identity(v_curator);
    perform public.shop_create_order(
      jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 1))
    );
  exception when others then
    v_raised := true;
  end;

  execute 'set local role postgres';
  select count(*) into v_after from public.shop_orders;
  select balance into v_balance from public.treasury where id = 1;
  if not v_raised then
    raise exception 'T2: oversized order was created';
  end if;
  if v_after <> v_before or v_balance <> 50 then
    raise exception 'T2: orders % -> %, balance %', v_before, v_after, v_balance;
  end if;
  raise notice 'T2 OK: insufficient treasury blocked';
end $$;

-- T3. Правка заказа админом: дельта списывается и возвращается.
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_item uuid;
  v_order uuid;
  v_order_id text;
  v_balance bigint;
  v_amount bigint;
  v_type text;
  v_total bigint;
  v_result jsonb;
begin
  execute 'set local role postgres';
  update public.treasury set balance = 100000 where id = 1;
  insert into public.shop_items (name, icon, category, stock, price)
  values ('T3 ТОВАР', '3', 'T3', 10, 100) returning id into v_item;

  execute 'set local role authenticated';
  perform public.test_set_identity(v_curator);
  v_result := public.shop_create_order(
    jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2))
  );
  v_order := (v_result ->> 'orderId')::uuid;
  v_order_id := v_order::text;

  perform public.test_set_identity(v_admin);
  perform public.shop_edit_order(v_order, jsonb_build_array(
    jsonb_build_object('itemId', v_item, 'quantity', 3)
  ));
  select balance into v_balance from public.treasury where id = 1;
  select type, amount into v_type, v_amount from public.transactions order by id desc limit 1;
  if v_balance <> 99700 or v_type is distinct from 'shop_adjust' or v_amount <> -100 then
    raise exception 'T3 increase: balance %, type %, amount %', v_balance, v_type, v_amount;
  end if;

  perform public.shop_edit_order(v_order, jsonb_build_array(
    jsonb_build_object('itemId', v_item, 'quantity', 1)
  ));
  select balance into v_balance from public.treasury where id = 1;
  select type, amount into v_type, v_amount from public.transactions order by id desc limit 1;
  select total into v_total from public.shop_orders where id = v_order;
  if v_balance <> 99900 or v_type is distinct from 'shop_adjust' or v_amount <> 200 then
    raise exception 'T3 decrease: balance %, type %, amount %', v_balance, v_type, v_amount;
  end if;
  if v_total <> 100 then
    raise exception 'T3: total %', v_total;
  end if;
  raise notice 'T3 OK: edit delta %', v_order_id;
end $$;

-- T4. Отклонение и отмена возвращают деньги, остаток не трогают.
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_item uuid;
  v_order uuid;
  v_stock int;
  v_balance bigint;
  v_type text;
  v_status text;
  v_result jsonb;
begin
  execute 'set local role postgres';
  update public.treasury set balance = 100000 where id = 1;
  insert into public.shop_items (name, icon, category, stock, price)
  values ('T4 ТОВАР', '4', 'T4', 10, 100) returning id into v_item;

  execute 'set local role authenticated';
  perform public.test_set_identity(v_curator);
  v_result := public.shop_create_order(
    jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2))
  );
  v_order := (v_result ->> 'orderId')::uuid;

  perform public.test_set_identity(v_admin);
  perform public.shop_review_order(v_order, false);
  select status into v_status from public.shop_orders where id = v_order;
  select balance into v_balance from public.treasury where id = 1;
  select type into v_type from public.transactions order by id desc limit 1;
  select stock into v_stock from public.shop_items where id = v_item;
  if v_status is distinct from 'rejected' or v_balance <> 100000
     or v_type is distinct from 'shop_refund' or v_stock <> 10 then
    raise exception 'T4 reject: %, %, %, %', v_status, v_balance, v_type, v_stock;
  end if;

  perform public.test_set_identity(v_curator);
  v_result := public.shop_create_order(
    jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2))
  );
  v_order := (v_result ->> 'orderId')::uuid;
  perform public.shop_cancel_order(v_order);
  select status into v_status from public.shop_orders where id = v_order;
  select balance into v_balance from public.treasury where id = 1;
  select type into v_type from public.transactions order by id desc limit 1;
  select stock into v_stock from public.shop_items where id = v_item;
  if v_status is distinct from 'cancelled' or v_balance <> 100000
     or v_type is distinct from 'shop_refund' or v_stock <> 10 then
    raise exception 'T4 cancel: %, %, %, %', v_status, v_balance, v_type, v_stock;
  end if;
  raise notice 'T4 OK: reject and cancel refund';
end $$;

-- T5. Нехватка на одобрении: заказ остаётся new, денег не возвращаем.
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_item uuid;
  v_order uuid;
  v_status text;
  v_balance bigint;
  v_stock int;
  v_raised boolean := false;
  v_result jsonb;
begin
  execute 'set local role postgres';
  update public.treasury set balance = 100000 where id = 1;
  insert into public.shop_items (name, icon, category, stock, price)
  values ('T5 ТОВАР', '5', 'T5', 5, 100) returning id into v_item;

  execute 'set local role authenticated';
  perform public.test_set_identity(v_curator);
  v_result := public.shop_create_order(
    jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2))
  );
  v_order := (v_result ->> 'orderId')::uuid;

  execute 'set local role postgres';
  update public.shop_items set stock = 1 where id = v_item;
  execute 'set local role authenticated';
  perform public.test_set_identity(v_admin);
  begin
    perform public.shop_review_order(v_order, true);
  exception when others then
    v_raised := true;
  end;

  select status into v_status from public.shop_orders where id = v_order;
  select balance into v_balance from public.treasury where id = 1;
  select stock into v_stock from public.shop_items where id = v_item;
  if not v_raised or v_status is distinct from 'new'
     or v_balance <> 99800 or v_stock <> 1 then
    raise exception 'T5: raised %, status %, balance %, stock %',
      v_raised, v_status, v_balance, v_stock;
  end if;
  raise notice 'T5 OK: approve blocked by stock';
end $$;

-- T6. Одобрение списывает остаток, откат возвращает остаток и деньги.
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_item uuid;
  v_order uuid;
  v_status text;
  v_balance bigint;
  v_stock int;
  v_raised boolean;
  v_result jsonb;
begin
  execute 'set local role postgres';
  update public.treasury set balance = 100000 where id = 1;
  insert into public.shop_items (name, icon, category, stock, price)
  values ('T6 ТОВАР', '6', 'T6', 5, 100) returning id into v_item;

  execute 'set local role authenticated';
  perform public.test_set_identity(v_curator);
  v_result := public.shop_create_order(
    jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 2))
  );
  v_order := (v_result ->> 'orderId')::uuid;

  perform public.test_set_identity(v_admin);
  perform public.shop_review_order(v_order, true);
  select status into v_status from public.shop_orders where id = v_order;
  select stock into v_stock from public.shop_items where id = v_item;
  select balance into v_balance from public.treasury where id = 1;
  if v_status is distinct from 'approved' or v_stock <> 3 or v_balance <> 99800 then
    raise exception 'T6 approve: %, %, %', v_status, v_stock, v_balance;
  end if;

  v_raised := false;
  begin
    perform public.shop_review_order(v_order, true);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'T6: double approve allowed';
  end if;

  perform public.shop_rollback_order(v_order);
  select status into v_status from public.shop_orders where id = v_order;
  select stock into v_stock from public.shop_items where id = v_item;
  select balance into v_balance from public.treasury where id = 1;
  if v_status is distinct from 'rolled_back' or v_stock <> 5 or v_balance <> 100000 then
    raise exception 'T6 rollback: %, %, %', v_status, v_stock, v_balance;
  end if;

  v_raised := false;
  begin
    perform public.shop_rollback_order(v_order);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'T6: double rollback allowed';
  end if;
  raise notice 'T6 OK: approve, rollback, idempotency';
end $$;

-- T7. Роли: куратор не меняет каталог и не видит чужие заказы.
do $$
declare
  v_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  v_curator constant uuid := '22222222-2222-2222-2222-222222222222';
  v_hidden uuid;
  v_admin_order uuid;
  v_raised boolean := false;
  v_catalog jsonb;
  v_orders jsonb;
begin
  execute 'set local role postgres';
  insert into public.shop_items (name, icon, category, stock, price, active)
  values ('T7 СКРЫТЫЙ', '7', 'T7', 5, 100, false) returning id into v_hidden;
  insert into public.shop_orders (curator, status, total, created_by)
  values (v_admin, 'new', 0, v_admin) returning id into v_admin_order;

  execute 'set local role authenticated';
  perform public.test_set_identity(v_curator);
  begin
    perform public.shop_create_item('T7 НЕТ', 'x', 'T7', 1, 1);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'T7: curator created item';
  end if;

  v_catalog := public.shop_get_catalog();
  if v_catalog @> jsonb_build_array(jsonb_build_object('id', v_hidden::text)) then
    raise exception 'T7: curator sees inactive item';
  end if;
  v_orders := public.shop_get_orders();
  if v_orders @> jsonb_build_array(jsonb_build_object('id', v_admin_order::text)) then
    raise exception 'T7: curator sees admin order';
  end if;
  raise notice 'T7 OK: role boundaries';
end $$;

rollback;
