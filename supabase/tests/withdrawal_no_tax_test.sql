-- Проверка: запрос выплаты не удерживает налог повторно.
-- Безопасно для рабочего проекта: всё идёт в транзакции и откатывается.

begin;

do $$
declare
  v_uid uuid;
  v_id uuid;
  v_rate numeric;
  v_tax bigint;
  v_net bigint;
begin
  select id into v_uid from public.profiles where role = 'curator' limit 1;
  if v_uid is null then raise exception 'нет профиля куратора'; end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt',
    jsonb_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_id := public.request_withdrawal(60000, 'проверка без налога');

  select tax_rate, tax_amount, amount_net
    into v_rate, v_tax, v_net
    from public.withdrawals
    where id = v_id;

  if v_rate <> 0 then raise exception 'tax_rate %, ожидалось 0', v_rate; end if;
  if v_tax <> 0 then raise exception 'tax_amount %, ожидалось 0', v_tax; end if;
  if v_net <> 60000 then raise exception 'amount_net %, ожидалось 60000', v_net; end if;
end $$;

rollback;
