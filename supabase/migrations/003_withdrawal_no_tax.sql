-- Налог уже удержан при поступлении денег в казну.
-- Запрос выплаты не удерживает его второй раз: в игру идёт запрошенная сумма.

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
begin
  perform public.require_curator();

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  insert into public.withdrawals
    (curator, amount_gross, tax_rate, tax_amount, amount_net, status, comment)
  values
    (auth.uid(), p_amount, 0, 0, p_amount, 'pending', p_comment)
  returning id into v_id;

  insert into public.audit_log (actor, action, entity, entity_id, details, comment)
  values (
    auth.uid(), 'request_withdrawal', 'withdrawal', v_id,
    jsonb_build_object('amountGross', p_amount, 'amountNet', p_amount),
    p_comment
  );

  return v_id;
end;
$$;

-- Подтверждение/отклонение выплаты: списывается запрошенная сумма,
-- в игре выдаётся та же сумма, без повторного налога.
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

    if v_before < v_w.amount_gross then
      raise exception 'insufficient funds';
    end if;

    update public.treasury
      set balance = balance - v_w.amount_gross
      where id = 1;

    insert into public.transactions
      (type, amount, tax_amount, balance_after, comment, actor)
    values
      ('withdrawal', -v_w.amount_gross, 0,
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
