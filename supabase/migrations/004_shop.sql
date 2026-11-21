-- =============================================================
-- 004_shop.sql — магазин / обеспечение.
-- Таблицы каталога и заказов, RLS. Изменения только через RPC.
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
  line_total bigint not null check (line_total >= 0)
);

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
