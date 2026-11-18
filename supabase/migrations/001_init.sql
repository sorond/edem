-- =============================================================
-- 001_init.sql — Эдем: таблицы, RLS, Storage, стартовые настройки.
-- =============================================================

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  description text
);

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('curator', 'admin')),
  display_name text
);

create table if not exists public.treasury (
  id int primary key default 1 check (id = 1),
  balance bigint not null default 0
);

create table if not exists public.transactions (
  id bigint generated always as identity primary key,
  type text not null,
  amount bigint not null,
  tax_amount bigint not null default 0,
  balance_after bigint not null,
  comment text,
  actor uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  kind text not null check (kind in ('weekly', 'urgent')),
  target_count int not null check (target_count > 0),
  bonus_percent numeric not null default 0,
  reward_gross bigint not null default 0,
  penalty_shift numeric not null default 0,
  penalty_days int not null default 7,
  has_bonus boolean not null default false,
  status text not null default 'active' check (status in ('active', 'completed', 'failed', 'archived')),
  bonus_active_until date,
  deadline_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references auth.users,
  report_date date not null default current_date,
  player_a text not null,
  player_b text not null,
  interaction_type text not null check (interaction_type in ('external', 'internal')),
  description text,
  task_id uuid references public.tasks,
  screenshot_urls jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer uuid,
  review_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  curator uuid not null references auth.users,
  amount_gross bigint not null,
  tax_rate numeric not null,
  tax_amount bigint not null,
  amount_net bigint not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  comment text,
  reviewer uuid,
  review_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.tax_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shift numeric not null,
  source text not null default 'event',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.payout_days (
  day date primary key,
  gross bigint not null,
  tax_rate numeric not null,
  net bigint not null,
  created_at timestamptz not null default now()
);

-- Индексы под частые выборки интерфейса.
create index if not exists idx_reports_task_status on public.reports (task_id, status);
create index if not exists idx_reports_status on public.reports (status);
create index if not exists idx_withdrawals_status on public.withdrawals (status);
create index if not exists idx_tax_events_window on public.tax_events (starts_at, ends_at);
create index if not exists idx_tasks_status_kind on public.tasks (status, kind);
create index if not exists idx_transactions_type on public.transactions (type, created_at desc);
create index if not exists idx_audit_log_created on public.audit_log (created_at desc);

-- -------------------------------------------------------------
-- Помощник ролей. security definer + search_path = public:
-- проходит мимо RLS profiles, поэтому нет рекурсии в политике
-- select на profiles.
-- -------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.settings     enable row level security;
alter table public.profiles     enable row level security;
alter table public.treasury     enable row level security;
alter table public.transactions enable row level security;
alter table public.tasks        enable row level security;
alter table public.reports      enable row level security;
alter table public.withdrawals  enable row level security;
alter table public.tax_events   enable row level security;
alter table public.audit_log    enable row level security;
alter table public.payout_days  enable row level security;

-- Чтение: authenticated видит всё, кроме profiles.
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'treasury', 'transactions', 'tasks', 'reports',
    'withdrawals', 'tax_events', 'audit_log', 'payout_days'
  ]
  loop
    execute format('drop policy if exists select_authenticated on public.%I', t);
    execute format(
      'create policy select_authenticated on public.%I for select to authenticated using (true)',
      t
    );
  end loop;
end $$;

-- profiles: только себя или админ.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Админские вставки/обновления.
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'tasks', 'tax_events', 'transactions', 'payout_days', 'profiles'
  ]
  loop
    execute format('drop policy if exists admin_insert on public.%I', t);
    execute format(
      'create policy admin_insert on public.%I for insert to authenticated with check (public.is_admin())',
      t
    );
    execute format('drop policy if exists admin_update on public.%I', t);
    execute format(
      'create policy admin_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end $$;

-- Рапорты: INSERT — куратор или админ, UPDATE — только админ.
drop policy if exists report_insert on public.reports;
create policy report_insert on public.reports
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('curator', 'admin')
    )
  );

drop policy if exists admin_update on public.reports;
create policy admin_update on public.reports
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Запросы выплат: INSERT — только куратор, UPDATE — только админ.
drop policy if exists withdrawal_insert on public.withdrawals;
create policy withdrawal_insert on public.withdrawals
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'curator'
    )
  );

drop policy if exists admin_update on public.withdrawals;
create policy admin_update on public.withdrawals
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- История: пишут админ и security definer RPC (последние обходят RLS).
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated with check (public.is_admin());

-- -------------------------------------------------------------
-- Storage: публичное чтение скриншотов, загрузка — авторизованным.
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('report-screenshots', 'report-screenshots', true)
on conflict (id) do nothing;

drop policy if exists report_screenshots_public_read on storage.objects;
create policy report_screenshots_public_read on storage.objects
  for select to public
  using (bucket_id = 'report-screenshots');

drop policy if exists report_screenshots_insert on storage.objects;
create policy report_screenshots_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'report-screenshots');

-- -------------------------------------------------------------
-- Стартовые значения.
-- -------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('base_payout', '60000', 'Базовая выплата в день'),
  ('base_tax', '30', 'Базовый налог, проценты'),
  ('min_tax', '10', 'Минимальный налог, проценты'),
  ('max_tax', '80', 'Максимальный налог, проценты'),
  ('treasury_cap', '126000', 'Потолок казны'),
  ('tariff_external', '10000', 'Внешний тариф'),
  ('tariff_internal', '5000', 'Внутренний тариф'),
  ('task_tariff_percent', '20', 'Тариф рапорта с заданием, проценты от обычного'),
  ('curator_email', '"curator@edem.local"', 'Логин куратора'),
  ('admin_email', '"edem@edem.local"', 'Логин Эдема')
on conflict (key) do nothing;

insert into public.treasury (id, balance) values (1, 0)
on conflict (id) do nothing;
