-- =============================================================
-- 004_shop.sql — магазин / обеспечение.
-- Таблицы, RLS и RPC. Все изменения казны и остатков — на сервере.
-- =============================================================

create table if not exists public.shop_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null check (char_length(icon) = 1),
  category text not null,
  stock integer not null check (stock >= 0),
  price bigint not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shop_items_active_category_name
  on public.shop_items (active, category, name);

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  curator uuid not null references auth.users,
  status text not null check (status in ('new', 'approved', 'rejected', 'cancelled', 'rolled_back')),
  total bigint not null check (total >= 0),
  created_by uuid references auth.users,
  reviewed_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists idx_shop_orders_status_created
  on public.shop_orders (status, created_at desc);

create table if not exists public.shop_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders on delete cascade,
  item_id uuid not null references public.shop_items,
  name_snapshot text not null,
  icon_snapshot text not null,
  unit_price bigint not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total bigint not null check (line_total >= 0),
  position integer not null default 0
);

alter table public.shop_order_items
  add column if not exists position integer not null default 0;

create index if not exists idx_shop_order_items_order
  on public.shop_order_items (order_id);

alter table public.shop_items enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_items enable row level security;

drop policy if exists shop_items_select on public.shop_items;
create policy shop_items_select on public.shop_items
  for select to authenticated
  using (active or public.is_admin());

drop policy if exists shop_orders_select on public.shop_orders;
create policy shop_orders_select on public.shop_orders
  for select to authenticated
  using (public.is_admin() or curator = auth.uid());

drop policy if exists shop_order_items_select on public.shop_order_items;
create policy shop_order_items_select on public.shop_order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.shop_orders o
      where o.id = order_id
        and (public.is_admin() or o.curator = auth.uid())
    )
  );

-- --------------------------------------------------------------
-- Внутренние помощники казны. Возврат не облагается налогом и не
-- ограничен потолком казны: credit_treasury здесь не используется.
-- --------------------------------------------------------------
create or replace function public.debit_treasury(
  p_amount bigint,
  p_type text,
  p_comment text default null,
  p_order_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before bigint;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'NEGATIVE_DEBIT';
  end if;

  select balance into v_before from public.treasury where id = 1 for update;
  if v_before - p_amount < 0 then
    raise exception 'INSUFFICIENT_TREASURY';
  end if;

  update public.treasury set balance = v_before - p_amount where id = 1;
  insert into public.transactions
    (type, amount, tax_amount, balance_after, comment, actor)
  values
    (p_type, -p_amount, 0, v_before - p_amount, p_comment, auth.uid());
  return v_before - p_amount;
end;
$$;

create or replace function public.refund_treasury(
  p_amount bigint,
  p_type text,
  p_comment text default null,
  p_order_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_after bigint;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'NEGATIVE_REFUND';
  end if;

  select balance + p_amount into v_after from public.treasury where id = 1 for update;
  update public.treasury set balance = v_after where id = 1;
  insert into public.transactions
    (type, amount, tax_amount, balance_after, comment, actor)
  values
    (p_type, p_amount, 0, v_after, p_comment, auth.uid());
  return v_after;
end;
$$;

-- Проверка и подготовка позиций заказа. Возвращает снимки с ценами.
create or replace function public.shop_prepare_items(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines jsonb;
  v_input_count int;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ITEMS';
  end if;
  v_input_count := jsonb_array_length(p_items);

  if (select count(*) from (
       select distinct e.value ->> 'itemId'
       from jsonb_array_elements(p_items) e
     ) d) <> v_input_count then
    raise exception 'DUPLICATE_ITEM';
  end if;

  perform 1
  from public.shop_items it
  where it.id in (
    select (e.value ->> 'itemId')::uuid from jsonb_array_elements(p_items) e
  )
  for update of it;

  select jsonb_agg(
    jsonb_build_object(
      'itemId', it.id,
      'nameSnapshot', it.name,
      'iconSnapshot', it.icon,
      'unitPrice', it.price,
      'quantity', q.qty,
      'lineTotal', q.qty * it.price,
      'position', q.ord
    ) order by q.ord
  )
  into v_lines
  from (
    select (e.value ->> 'itemId')::uuid as item_id,
           (e.value ->> 'quantity')::int as qty,
           e.ordinality::int as ord
    from jsonb_array_elements(p_items) with ordinality as e(value, ordinality)
  ) q
  join public.shop_items it
    on it.id = q.item_id
   and it.active
   and q.qty > 0
   and q.qty <= it.stock;

  if coalesce(jsonb_array_length(v_lines), 0) <> v_input_count then
    raise exception 'INVALID_ITEMS';
  end if;
  return v_lines;
end;
$$;

-- --------------------------------------------------------------
-- Каталог и заказы.
-- --------------------------------------------------------------
create or replace function public.shop_get_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_identity();
  if not (public.is_admin() or exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'curator'
     )) then
    raise exception 'permission denied';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', i.id, 'name', i.name, 'icon', i.icon, 'category', i.category,
        'stock', i.stock, 'price', i.price, 'active', i.active
      ) order by i.category, i.name
    )
    from public.shop_items i
    where public.is_admin() or i.active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.shop_get_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_identity();
  if not (public.is_admin() or exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'curator'
     )) then
    raise exception 'permission denied';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', o.id, 'total', o.total, 'status', o.status,
        'created_at', o.created_at, 'reviewed_at', o.reviewed_at,
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'nameSnapshot', oi.name_snapshot, 'iconSnapshot', oi.icon_snapshot,
              'unitPrice', oi.unit_price, 'quantity', oi.quantity,
              'lineTotal', oi.line_total
            ) order by oi.position, oi.id
          )
          from public.shop_order_items oi where oi.order_id = o.id
        ), '[]'::jsonb)
      ) order by o.created_at desc, o.id desc
    )
    from public.shop_orders o
    where public.is_admin() or o.curator = auth.uid()
  ), '[]'::jsonb);
end;
$$;

create or replace function public.shop_create_item(
  p_name text,
  p_icon text,
  p_category text,
  p_stock integer,
  p_price bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_admin();
  if p_name is null or btrim(p_name) = '' or p_category is null or btrim(p_category) = ''
     or p_icon is null or char_length(p_icon) <> 1
     or p_stock is null or p_stock < 0 or p_price is null or p_price < 0 then
    raise exception 'INVALID_ITEM';
  end if;

  insert into public.shop_items (name, icon, category, stock, price)
  values (btrim(p_name), p_icon, btrim(p_category), p_stock, p_price)
  returning id into v_id;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'shop_create_item', 'shop_item', v_id,
          jsonb_build_object('name', btrim(p_name), 'stock', p_stock, 'price', p_price));
  return jsonb_build_object('id', v_id, 'name', btrim(p_name), 'stock', p_stock, 'price', p_price);
end;
$$;

create or replace function public.shop_update_item(
  p_id uuid,
  p_name text,
  p_icon text,
  p_category text,
  p_stock integer,
  p_price bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_name is null or btrim(p_name) = '' or p_category is null or btrim(p_category) = ''
     or p_icon is null or char_length(p_icon) <> 1
     or p_stock is null or p_stock < 0 or p_price is null or p_price < 0 then
    raise exception 'INVALID_ITEM';
  end if;

  update public.shop_items
  set name = btrim(p_name), icon = p_icon, category = btrim(p_category),
      stock = p_stock, price = p_price, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'shop_update_item', 'shop_item', p_id,
          jsonb_build_object('name', btrim(p_name), 'stock', p_stock, 'price', p_price));
  return jsonb_build_object('id', p_id, 'name', btrim(p_name), 'stock', p_stock, 'price', p_price);
end;
$$;

create or replace function public.shop_set_item_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.shop_items set active = p_active, updated_at = now() where id = p_id;
  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'shop_set_item_active', 'shop_item', p_id,
          jsonb_build_object('active', p_active));
end;
$$;

create or replace function public.shop_create_order(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines jsonb;
  v_total bigint;
  v_order uuid;
begin
  perform public.require_curator();
  v_lines := public.shop_prepare_items(p_items);

  select coalesce(sum((line ->> 'lineTotal')::bigint), 0)
  into v_total from jsonb_array_elements(v_lines) line;

  insert into public.shop_orders (curator, status, total, created_by)
  values (auth.uid(), 'new', v_total, auth.uid())
  returning id into v_order;

  insert into public.shop_order_items
    (order_id, item_id, name_snapshot, icon_snapshot, unit_price, quantity, line_total, position)
  select v_order,
         (line ->> 'itemId')::uuid,
         line ->> 'nameSnapshot', line ->> 'iconSnapshot',
         (line ->> 'unitPrice')::bigint, (line ->> 'quantity')::int,
         (line ->> 'lineTotal')::bigint, (line ->> 'position')::int
  from jsonb_array_elements(v_lines) line;

  perform public.debit_treasury(v_total, 'shop_reserve', 'ЗАКАЗ МАГАЗИНА', v_order);
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'shop_create_order', 'shop_order', v_order,
          jsonb_build_object('orderId', v_order, 'total', v_total));
  return jsonb_build_object('orderId', v_order, 'total', v_total);
end;
$$;

create or replace function public.shop_cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shop_orders%rowtype;
begin
  perform public.require_curator();
  select * into v_order from public.shop_orders where id = p_order_id for update;
  if not found or v_order.curator <> auth.uid() or v_order.status <> 'new' then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.shop_orders
  set status = 'cancelled', updated_at = now(), reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_order_id;
  perform public.refund_treasury(v_order.total, 'shop_refund', 'ОТМЕНА ЗАКАЗА', p_order_id);
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'shop_cancel_order', 'shop_order', p_order_id,
          jsonb_build_object('orderId', p_order_id, 'total', v_order.total));
end;
$$;

create or replace function public.shop_edit_order(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shop_orders%rowtype;
  v_lines jsonb;
  v_total bigint;
  v_delta bigint;
begin
  perform public.require_admin();
  select * into v_order from public.shop_orders where id = p_order_id for update;
  if not found or v_order.status <> 'new' then
    raise exception 'ORDER_NOT_EDITABLE';
  end if;

  v_lines := public.shop_prepare_items(p_items);
  select coalesce(sum((line ->> 'lineTotal')::bigint), 0)
  into v_total from jsonb_array_elements(v_lines) line;
  v_delta := v_total - v_order.total;

  if v_delta > 0 then
    perform public.debit_treasury(v_delta, 'shop_adjust', 'РЕДАКТИРОВАНИЕ ЗАКАЗА', p_order_id);
  elsif v_delta < 0 then
    perform public.refund_treasury(-v_delta, 'shop_adjust', 'РЕДАКТИРОВАНИЕ ЗАКАЗА', p_order_id);
  end if;

  delete from public.shop_order_items where order_id = p_order_id;
  insert into public.shop_order_items
    (order_id, item_id, name_snapshot, icon_snapshot, unit_price, quantity, line_total, position)
  select p_order_id,
         (line ->> 'itemId')::uuid,
         line ->> 'nameSnapshot', line ->> 'iconSnapshot',
         (line ->> 'unitPrice')::bigint, (line ->> 'quantity')::int,
         (line ->> 'lineTotal')::bigint, (line ->> 'position')::int
  from jsonb_array_elements(v_lines) line;

  update public.shop_orders set total = v_total, updated_at = now() where id = p_order_id;
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'shop_edit_order', 'shop_order', p_order_id,
          jsonb_build_object('orderId', p_order_id, 'total', v_total, 'delta', v_delta));
end;
$$;

create or replace function public.shop_review_order(p_order_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shop_orders%rowtype;
  v_bad int;
begin
  perform public.require_admin();
  select * into v_order from public.shop_orders where id = p_order_id for update;
  if not found or v_order.status <> 'new' then
    raise exception 'ORDER_NOT_REVIEWABLE';
  end if;

  if p_approve then
    select count(*) into v_bad
    from public.shop_order_items oi
    join public.shop_items i on i.id = oi.item_id
    where oi.order_id = p_order_id
      and (not i.active or i.stock < oi.quantity);
    if v_bad > 0 then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    update public.shop_items i
    set stock = i.stock - oi.quantity, updated_at = now()
    from public.shop_order_items oi
    where oi.order_id = p_order_id and i.id = oi.item_id;

    update public.shop_orders
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_order_id;
    insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'shop_approve_order', 'shop_order', p_order_id,
            jsonb_build_object('orderId', p_order_id, 'total', v_order.total));
  else
    update public.shop_orders
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_order_id;
    perform public.refund_treasury(v_order.total, 'shop_refund', 'ОТКЛОНЕНИЕ ЗАКАЗА', p_order_id);
    insert into public.audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), 'shop_reject_order', 'shop_order', p_order_id,
            jsonb_build_object('orderId', p_order_id, 'total', v_order.total));
  end if;
end;
$$;

create or replace function public.shop_rollback_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shop_orders%rowtype;
begin
  perform public.require_admin();
  select * into v_order from public.shop_orders where id = p_order_id for update;
  if not found or v_order.status <> 'approved' then
    raise exception 'ORDER_NOT_ROLLBACKABLE';
  end if;

  update public.shop_items i
  set stock = i.stock + oi.quantity, updated_at = now()
  from public.shop_order_items oi
  where oi.order_id = p_order_id and i.id = oi.item_id;

  update public.shop_orders
  set status = 'rolled_back', updated_at = now() where id = p_order_id;
  perform public.refund_treasury(v_order.total, 'shop_refund', 'ОТКАТ ЗАКАЗА', p_order_id);
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'shop_rollback_order', 'shop_order', p_order_id,
          jsonb_build_object('orderId', p_order_id, 'total', v_order.total));
end;
$$;

revoke all on function public.debit_treasury(bigint, text, text, uuid) from public;
revoke all on function public.refund_treasury(bigint, text, text, uuid) from public;
revoke all on function public.shop_prepare_items(jsonb) from public;
