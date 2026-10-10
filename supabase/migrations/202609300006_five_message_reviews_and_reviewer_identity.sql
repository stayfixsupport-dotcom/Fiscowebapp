alter table public.accountant_reviews add column if not exists reviewer_name text;
alter table public.accountant_reviews add column if not exists reviewer_avatar_url text;

update public.accountant_reviews r
set reviewer_name = coalesce(nullif(btrim(p.display_name), ''), 'Taxpayer'),
    reviewer_avatar_url = p.avatar_url
from public.profiles p
where p.id = r.taxpayer_id and r.reviewer_name is null;
update public.accountant_reviews set reviewer_name = 'Taxpayer' where reviewer_name is null;
alter table public.accountant_reviews alter column reviewer_name set default 'Taxpayer';
alter table public.accountant_reviews alter column reviewer_name set not null;

grant select (id, accountant_id, reviewer_name, reviewer_avatar_url, rating, comment, created_at)
  on public.accountant_reviews to anon, authenticated;
revoke insert on public.accountant_reviews from authenticated;

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
  _reviewer_name text;
  _reviewer_avatar_url text;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'taxpayer') then
    raise exception 'Only taxpayers may review an accountant';
  end if;
  if p_rating not between 1 and 5 or length(coalesce(p_comment, '')) > 600 then
    raise exception 'The review rating or comment is invalid';
  end if;

  select c.taxpayer_id into _taxpayer_id
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
    if _message_count < 5 and not exists (
      select 1 from public.service_cases s
      where s.conversation_id = p_conversation_id and s.accountant_id = p_accountant_id
        and s.taxpayer_id = auth.uid() and s.status = 'completed'
    ) then
      raise exception 'Send at least five messages or complete work before reviewing';
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