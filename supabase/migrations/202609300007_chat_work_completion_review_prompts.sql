alter table public.conversations
  add column if not exists accountant_work_completed_at timestamptz,
  add column if not exists review_prompt_dismissed_at timestamptz;

create or replace function public.mark_conversation_work_complete(p_conversation_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  _completed_at timestamptz;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'accountant') then
    raise exception 'Only accountants may mark work complete';
  end if;
  update public.conversations
  set accountant_work_completed_at = coalesce(accountant_work_completed_at, now()),
      updated_at = now()
  where id = p_conversation_id and accountant_id = auth.uid()
    and public.active_client_pair(accountant_id, taxpayer_id)
  returning accountant_work_completed_at into _completed_at;
  if _completed_at is null then
    raise exception 'The active accountant conversation was not found';
  end if;
  return _completed_at;
end;
$$;
revoke all on function public.mark_conversation_work_complete(uuid) from public;
grant execute on function public.mark_conversation_work_complete(uuid) to authenticated;

create or replace function public.dismiss_accountant_review_prompt(p_conversation_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  _dismissed_at timestamptz;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'taxpayer') then
    raise exception 'Only taxpayers may dismiss a review prompt';
  end if;
  update public.conversations
  set review_prompt_dismissed_at = now(), updated_at = now()
  where id = p_conversation_id and taxpayer_id = auth.uid()
    and public.active_client_pair(accountant_id, taxpayer_id)
  returning review_prompt_dismissed_at into _dismissed_at;
  if _dismissed_at is null then
    raise exception 'The active taxpayer conversation was not found';
  end if;
  return _dismissed_at;
end;
$$;
revoke all on function public.dismiss_accountant_review_prompt(uuid) from public;
grant execute on function public.dismiss_accountant_review_prompt(uuid) to authenticated;

create or replace function public.submit_accountant_review(
  p_conversation_id uuid,
  p_accountant_id uuid,
  p_rating smallint,
  p_comment text,
  p_service_case_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _taxpayer_id uuid;
  _review_id uuid;
  _message_count integer;
  _accountant_work_completed_at timestamptz;
  _reviewer_name text;
  _reviewer_avatar_url text;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'taxpayer') then
    raise exception 'Only taxpayers may review an accountant';
  end if;
  if p_rating is null or p_rating not between 1 and 5 or length(coalesce(p_comment, '')) > 600 then
    raise exception 'The review rating or comment is invalid';
  end if;

  select c.taxpayer_id, c.accountant_work_completed_at
  into _taxpayer_id, _accountant_work_completed_at
  from public.conversations c
  where c.id = p_conversation_id and c.accountant_id = p_accountant_id;
  if _taxpayer_id is distinct from auth.uid() then
    raise exception 'The review conversation does not belong to this taxpayer';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'Taxpayer'), p.avatar_url
  into _reviewer_name, _reviewer_avatar_url
  from public.profiles p where p.id = auth.uid();
  _reviewer_name := coalesce(nullif(btrim(_reviewer_name), ''), 'Taxpayer');

  perform pg_advisory_xact_lock(
    hashtextextended(p_accountant_id::text || ':' || auth.uid()::text, 0)
  );
  if exists (
    select 1 from public.accountant_reviews
    where accountant_id = p_accountant_id and taxpayer_id = auth.uid()
  ) then
    raise exception 'You have already reviewed this accountant';
  end if;

  if p_service_case_id is not null then
    if not exists (
      select 1 from public.service_cases s
      where s.id = p_service_case_id and s.conversation_id = p_conversation_id
        and s.accountant_id = p_accountant_id and s.taxpayer_id = auth.uid()
        and s.status = 'completed'
    ) then
      raise exception 'Only completed work can be reviewed';
    end if;
  else
    select count(*)::integer into _message_count
    from public.messages m where m.conversation_id = p_conversation_id;
    if _message_count < 10 and _accountant_work_completed_at is null and not exists (
      select 1 from public.service_cases s
      where s.conversation_id = p_conversation_id and s.accountant_id = p_accountant_id
        and s.taxpayer_id = auth.uid() and s.status = 'completed'
    ) then
      raise exception 'Send at least ten messages or complete work before reviewing';
    end if;
  end if;

  insert into public.accountant_reviews (
    service_case_id, conversation_id, accountant_id, taxpayer_id, reviewer_name,
    reviewer_avatar_url, rating, comment
  ) values (
    p_service_case_id, p_conversation_id, p_accountant_id, auth.uid(), _reviewer_name,
    _reviewer_avatar_url, p_rating, coalesce(p_comment, '')
  ) returning id into _review_id;
  return _review_id;
end;
$$;
revoke all on function public.submit_accountant_review(uuid, uuid, smallint, text, uuid) from public;
grant execute on function public.submit_accountant_review(uuid, uuid, smallint, text, uuid) to authenticated;