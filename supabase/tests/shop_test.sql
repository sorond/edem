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

rollback;
