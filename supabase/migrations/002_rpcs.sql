-- =============================================================
-- 002_rpcs.sql — Эдем: RPC экономики и админки.
-- Все функции: security definer, set search_path = public.
-- Округление до целого после умножения — как в src/economy.js.
-- =============================================================

-- Чтение скалярного значения из settings (jsonb-число или jsonb-строка).
create or replace function public.setting_num(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (value #>> '{}')::numeric from public.settings where key = p_key;
$$;

-- Анонимный PostgREST-запрос: роль приходит и отдельной GUC, и в JSON.
create or replace function public.is_anon_call()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'anon'
    or coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) = 'anon';
$$;

-- Ролевые проверки.
--
-- auth.uid() пустой у внутренних вызовов (service_role, SQL Editor,
-- ежедневный Edge Function) — такие вызовы доверенные. Анонимный
-- PostgREST-запрос (role = 'anon') отвергается всегда; роль
-- 'authenticated' проверяется через profiles.
create or replace function public.require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_anon_call() then
    raise exception 'permission denied';
  end if;
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'permission denied';
  end if;
end;
$$;

create or replace function public.require_curator()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_anon_call() then
    raise exception 'permission denied';
  end if;
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'curator'
  ) then
    raise exception 'permission denied';
  end if;
end;
$$;

create or replace function public.require_reporter()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_anon_call() then
    raise exception 'permission denied';
  end if;
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('curator', 'admin')
  ) then
    raise exception 'permission denied';
  end if;
end;
$$;

-- Текущий налог: base + сумма активных сдвигов, ограниченная min/max.
create or replace function public.current_tax_rate()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    public.setting_num('min_tax'),
    least(
      public.setting_num('max_tax'),
      public.setting_num('base_tax') + coalesce((
        select sum(e.shift)
        from public.tax_events e
        where now() between e.starts_at and e.ends_at
      ), 0)
    )
  );
$$;

-- Единая точка зачисления: налог, потолок казны, транзакция.
create or replace function public.credit_treasury(
  p_gross numeric,
  p_tax_rate numeric,
  p_type text,
  p_comment text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tax_amount numeric;
  v_net numeric;
  v_cap numeric;
  v_before bigint;
  v_after bigint;
  v_burned numeric;
begin
  v_tax_amount := round(p_gross * p_tax_rate / 100);
  v_net := p_gross - v_tax_amount;
  v_cap := public.setting_num('treasury_cap');

  select balance into v_before from public.treasury where id = 1 for update;
  v_after := least(v_cap::bigint, v_before + v_net::bigint);
  v_burned := greatest(0::numeric, v_before + v_net - v_cap);

  update public.treasury set balance = v_after where id = 1;

  insert into public.transactions (type, amount, tax_amount, balance_after, comment, actor)
  values (p_type, v_net::bigint, v_tax_amount::bigint, v_after,
          p_comment, coalesce(p_actor, auth.uid()));

  return jsonb_build_object(
    'skipped', false,
    'gross', p_gross::bigint,
    'taxRate', p_tax_rate,
    'taxAmount', v_tax_amount::bigint,
    'net', v_net::bigint,
    'burned', v_burned::bigint,
    'balance', v_after
  );
end;
$$;

-- Ежедневная выплата. Идемпотентна по московской дате.
create or replace function public.run_daily_payout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_base numeric;
  v_bonus numeric;
  v_gross numeric;
  v_tax numeric;
  v_result jsonb;
  v_task record;
  v_lock bigint;
begin
  -- Блокируем строку казны, чтобы параллельные вызовы не удвоили выплату.
  select balance into v_lock from public.treasury where id = 1 for update;

  v_today := (now() at time zone 'Europe/Moscow')::date;
  if exists (select 1 from public.payout_days where day = v_today) then
    return jsonb_build_object('skipped', true);
  end if;

  v_base := public.setting_num('base_payout');
  select coalesce(sum(bonus_percent), 0) into v_bonus
    from public.tasks
    where status = 'completed'
      and bonus_active_until is not null
      and bonus_active_until >= v_today;

  v_gross := round(v_base * (1 + v_bonus / 100));
  v_tax := public.current_tax_rate();
  v_result := public.credit_treasury(
    v_gross, v_tax, 'daily_payout',
    'Ежедневная выплата ' || v_today::text, null
  );

  insert into public.payout_days (day, gross, tax_rate, net)
  values (v_today, v_gross::bigint, v_tax, (v_result->>'net')::bigint);

  -- Просроченные еженедельные задания: failed + штрафной сдвиг налога.
  for v_task in
    select id, title, penalty_shift, penalty_days
    from public.tasks
    where status = 'active'
      and kind = 'weekly'
      and deadline_at is not null
      and deadline_at < now()
  loop
    update public.tasks set status = 'failed' where id = v_task.id;

    insert into public.tax_events (name, shift, source, starts_at, ends_at, created_by)
    values (
      'Штраф: ' || v_task.title,
      v_task.penalty_shift,
      'task_penalty',
      now(),
      now() + make_interval(days => v_task.penalty_days),
      null
    );

    insert into public.audit_log (actor, action, entity, entity_id, details, comment)
    values (
      null, 'task_failed', 'task', v_task.id,
      jsonb_build_object('penaltyShift', v_task.penalty_shift,
                         'penaltyDays', v_task.penalty_days),
      'Просрочено'
    );
  end loop;

  insert into public.audit_log (actor, action, entity, details, comment)
  values (auth.uid(), 'daily_payout', 'treasury', v_result, v_today::text);

  return v_result;
end;
$$;

-- Принятие/отклонение рапорта.
create or replace function public.review_report(
  p_report_id uuid,
  p_decision text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports%rowtype;
  v_task public.tasks%rowtype;
  v_tax numeric;
  v_tariff numeric;
  v_approved_count int;
  v_result jsonb;
begin
  perform public.require_admin();

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if not found then raise exception 'report not found'; end if;
  if v_report.status <> 'pending' then raise exception 'report already reviewed'; end if;

  if p_decision = 'approved' then
    v_tax := public.current_tax_rate();

    if v_report.interaction_type = 'external' then
      v_tariff := public.setting_num('tariff_external');
    else
      v_tariff := public.setting_num('tariff_internal');
    end if;
    if v_report.task_id is not null then
      v_tariff := round(v_tariff * public.setting_num('task_tariff_percent') / 100);
    end if;

    v_result := public.credit_treasury(
      v_tariff, v_tax, 'report_tariff', p_comment, auth.uid()
    );

    update public.reports
      set status = 'approved',
          reviewer = auth.uid(),
          review_comment = p_comment,
          reviewed_at = now()
      where id = p_report_id;

    if v_report.task_id is not null then
      select count(*) into v_approved_count
        from public.reports
        where task_id = v_report.task_id and status = 'approved';

      select * into v_task from public.tasks where id = v_report.task_id for update;

      if found and v_task.status = 'active' and v_approved_count >= v_task.target_count then
        update public.tasks
          set status = 'completed',
              completed_at = now(),
              bonus_active_until = case
                when v_task.kind = 'weekly' or v_task.has_bonus then current_date + 7
                else null
              end
          where id = v_task.id;

        -- Награда — грязными, проходит через тот же налог и потолок.
        if v_task.reward_gross > 0 then
          perform public.credit_treasury(
            v_task.reward_gross, v_tax, 'task_reward',
            'Награда: ' || v_task.title, auth.uid()
          );
        end if;
      end if;
    end if;

    insert into public.audit_log (actor, action, entity, entity_id, details, comment)
    values (
      auth.uid(), 'review_report', 'report', p_report_id,
      jsonb_build_object(
        'decision', 'approved',
        'tariff', v_tariff,
        'net', (v_result->>'net')::bigint,
        'taskId', v_report.task_id
      ),
      p_comment
    );
  else
    update public.reports
      set status = 'rejected',
          reviewer = auth.uid(),
          review_comment = p_comment,
          reviewed_at = now()
      where id = p_report_id;

    insert into public.audit_log (actor, action, entity, entity_id, details, comment)
    values (
      auth.uid(), 'review_report', 'report', p_report_id,
      jsonb_build_object('decision', 'rejected'), p_comment
    );
  end if;
end;
$$;

-- Запрос выплаты куратором. Казна меняется только при подтверждении.
create or replace function public.request_withdrawal(
  p_amount bigint,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tax numeric;
  v_tax_amount bigint;
  v_net bigint;
begin
  perform public.require_curator();

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  v_tax := public.current_tax_rate();
  v_tax_amount := round(p_amount * v_tax / 100);
  v_net := p_amount - v_tax_amount;

  insert into public.withdrawals
    (curator, amount_gross, tax_rate, tax_amount, amount_net, status, comment)
  values
    (auth.uid(), p_amount, v_tax, v_tax_amount, v_net, 'pending', p_comment)
  returning id into v_id;

  insert into public.audit_log (actor, action, entity, entity_id, details, comment)
  values (
    auth.uid(), 'request_withdrawal', 'withdrawal', v_id,
    jsonb_build_object('amountGross', p_amount, 'taxRate', v_tax,
                       'amountNet', v_net),
    p_comment
  );

  return v_id;
end;
$$;

-- Подтверждение/отклонение выплаты: списывается gross, в игре — net.
create or replace function public.review_withdrawal(
  p_id uuid,
  p_decision text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
  v_before bigint;
begin
  perform public.require_admin();

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal not found'; end if;
  if v_w.status <> 'pending' then raise exception 'withdrawal already reviewed'; end if;

  if p_decision = 'approved' then
    select balance into v_before from public.treasury where id = 1 for update;

    update public.treasury
      set balance = balance - v_w.amount_gross
      where id = 1;

    insert into public.transactions
      (type, amount, tax_amount, balance_after, comment, actor)
    values
      ('withdrawal', -v_w.amount_gross, v_w.tax_amount,
       v_before - v_w.amount_gross, p_comment, auth.uid());
  end if;

  update public.withdrawals
    set status = case when p_decision = 'approved' then 'approved' else 'rejected' end,
        reviewer = auth.uid(),
        review_comment = p_comment,
        reviewed_at = now()
    where id = p_id;

  insert into public.audit_log (actor, action, entity, entity_id, details, comment)
  values (
    auth.uid(), 'review_withdrawal', 'withdrawal', p_id,
    jsonb_build_object('decision', p_decision,
                       'amountGross', v_w.amount_gross,
                       'amountNet', v_w.amount_net),
    p_comment
  );
end;
$$;

-- Ручная правка казны: только админ, без налога и без потолка.
create or replace function public.adjust_treasury(
  p_amount bigint,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before bigint;
begin
  perform public.require_admin();

  select balance into v_before from public.treasury where id = 1 for update;

  update public.treasury set balance = balance + p_amount where id = 1;

  insert into public.transactions
    (type, amount, tax_amount, balance_after, comment, actor)
  values
    ('manual_edit', p_amount, 0, v_before + p_amount, p_comment, auth.uid());

  insert into public.audit_log (actor, action, entity, entity_id, details, comment)
  values (
    auth.uid(), 'adjust_treasury', 'treasury', null,
    jsonb_build_object('amount', p_amount), p_comment
  );
end;
$$;

-- Создание задания. У еженедельных дедлайн по умолчанию — 7 дней.
create or replace function public.create_task(
  p_title text,
  p_description text,
  p_kind text,
  p_target int,
  p_bonus numeric,
  p_reward bigint,
  p_penalty numeric,
  p_penalty_days int,
  p_has_bonus boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_admin();

  if p_target is null or p_target <= 0 then
    raise exception 'invalid target';
  end if;

  insert into public.tasks
    (title, description, kind, target_count, bonus_percent, reward_gross,
     penalty_shift, penalty_days, has_bonus, deadline_at, created_by)
  values
    (p_title, p_description, p_kind, p_target, coalesce(p_bonus, 0),
     coalesce(p_reward, 0), coalesce(p_penalty, 0),
     coalesce(p_penalty_days, 7), coalesce(p_has_bonus, false),
     case when p_kind = 'weekly' then now() + interval '7 days' else null end,
     auth.uid())
  returning id into v_id;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (
    auth.uid(), 'create_task', 'task', v_id,
    jsonb_build_object('title', p_title, 'kind', p_kind, 'target', p_target)
  );

  return v_id;
end;
$$;

create or replace function public.archive_task(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  update public.tasks set status = 'archived' where id = p_id;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), 'archive_task', 'task', p_id, '{}'::jsonb);
end;
$$;

create or replace function public.create_tax_event(
  p_name text,
  p_shift numeric,
  p_days int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_admin();

  if p_days is null or p_days <= 0 then
    raise exception 'invalid duration';
  end if;

  insert into public.tax_events (name, shift, source, starts_at, ends_at, created_by)
  values (p_name, p_shift, 'event', now(),
          now() + make_interval(days => p_days), auth.uid())
  returning id into v_id;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (
    auth.uid(), 'create_tax_event', 'tax_event', v_id,
    jsonb_build_object('shift', p_shift, 'days', p_days)
  );

  return v_id;
end;
$$;

create or replace function public.create_report(
  p_report_date date,
  p_player_a text,
  p_player_b text,
  p_interaction_type text,
  p_description text,
  p_task_id uuid,
  p_screenshot_urls jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_reporter();

  if p_task_id is not null and not exists (
    select 1 from public.tasks where id = p_task_id
  ) then
    raise exception 'task not found';
  end if;

  insert into public.reports
    (reporter, report_date, player_a, player_b, interaction_type,
     description, task_id, screenshot_urls, status)
  values
    (auth.uid(), coalesce(p_report_date, current_date), p_player_a, p_player_b,
     p_interaction_type, p_description, p_task_id,
     coalesce(p_screenshot_urls, '[]'::jsonb), 'pending')
  returning id into v_id;

  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (
    auth.uid(), 'create_report', 'report', v_id,
    jsonb_build_object('interactionType', p_interaction_type, 'taskId', p_task_id)
  );

  return v_id;
end;
$$;

create or replace function public.update_settings(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  insert into public.settings (key, value)
  values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor, action, entity, details)
  values (
    auth.uid(), 'update_settings', 'settings',
    jsonb_build_object('key', p_key, 'value', p_value)
  );
end;
$$;

-- Чтение для фронта (в том числе на экране входа, до авторизации).
create or replace function public.get_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.settings;
$$;

create or replace function public.get_treasury()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select balance from public.treasury where id = 1;
$$;

-- -------------------------------------------------------------
-- Grants: аноним не должен вызывать изменяющие RPC даже при сбое
-- ролевой проверки. Админские вызовы идут от authenticated + JWT
-- пользователя с ролью admin; проверка роли внутри RPC.
-- -------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'review_report(uuid,text,text)',
    'request_withdrawal(bigint,text)',
    'review_withdrawal(uuid,text,text)',
    'adjust_treasury(bigint,text)',
    'create_task(text,text,text,int,numeric,bigint,numeric,int,boolean)',
    'archive_task(uuid)',
    'create_tax_event(text,numeric,int)',
    'create_report(date,text,text,text,text,uuid,jsonb)',
    'update_settings(text,jsonb)'
  ]
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Начисление — только внутренний вызов (Edge Function / service role).
  revoke all on function public.run_daily_payout() from public;
  grant execute on function public.run_daily_payout() to service_role;
end $$;
