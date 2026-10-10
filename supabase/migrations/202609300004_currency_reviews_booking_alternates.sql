alter table public.profiles add column if not exists currency_code text;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_currency_code_check'
  ) then
    alter table public.profiles add constraint profiles_currency_code_check
      check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
  end if;
end $$;

create or replace function public.create_profile_for_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare _currency_code text;
begin
  _currency_code := upper(new.raw_user_meta_data ->> 'currency_code');
  if _currency_code !~ '^[A-Z]{3}$' then _currency_code := null; end if;
  insert into public.profiles (id, display_name, currency_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    _currency_code
  )
  on conflict (id) do update set
    currency_code = coalesce(excluded.currency_code, public.profiles.currency_code);
  return new;
end;
$$;
drop trigger if exists create_profile_for_new_auth_user on auth.users;
create trigger create_profile_for_new_auth_user after insert on auth.users
  for each row execute function public.create_profile_for_new_auth_user();

alter table public.accountant_reviews alter column service_case_id drop not null;
alter table public.accountant_reviews
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accountant_reviews'::regclass
      and conname = 'accountant_reviews_eligibility_source_check'
  ) then
    alter table public.accountant_reviews add constraint accountant_reviews_eligibility_source_check
      check (service_case_id is not null or conversation_id is not null);
  end if;
end $$;
create unique index if not exists accountant_reviews_direct_pair_uidx
  on public.accountant_reviews (accountant_id, taxpayer_id) where service_case_id is null;
drop policy if exists "taxpayers review completed services once" on public.accountant_reviews;
revoke insert on public.accountant_reviews from authenticated;

create or replace function public.has_reviewed_accountant(p_accountant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accountant_reviews
    where accountant_id = p_accountant_id and taxpayer_id = auth.uid()
  )
$$;
revoke all on function public.has_reviewed_accountant(uuid) from public;
grant execute on function public.has_reviewed_accountant(uuid) to authenticated;

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
    if _message_count < 6 and not exists (
      select 1 from public.service_cases s
      where s.conversation_id = p_conversation_id and s.accountant_id = p_accountant_id
        and s.taxpayer_id = auth.uid() and s.status = 'completed'
    ) then
      raise exception 'Send at least six messages or complete work before reviewing';
    end if;
  end if;

  insert into public.accountant_reviews (
    service_case_id, conversation_id, accountant_id, taxpayer_id, rating, comment
  ) values (
    p_service_case_id, p_conversation_id, p_accountant_id, auth.uid(), p_rating, coalesce(p_comment, '')
  ) returning id into _review_id;
  return _review_id;
end;
$$;
revoke all on function public.submit_accountant_review(uuid, uuid, smallint, text, uuid) from public;
grant execute on function public.submit_accountant_review(uuid, uuid, smallint, text, uuid) to authenticated;

alter table public.appointment_requests
  add column if not exists alternative_starts_at timestamptz;
revoke update on public.appointment_requests from authenticated;
grant update (status, updated_at, alternative_starts_at) on public.appointment_requests to authenticated;

create or replace function public.guard_appointment_request_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is not null and (
      auth.uid() <> NEW.taxpayer_id or NEW.status <> 'pending' or NEW.starts_at <= now()
    ) then
      raise exception 'Appointment requests must be submitted by the taxpayer for a future time';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended(NEW.accountant_id::text || ':' || NEW.starts_at::text, 0)
    );
    if exists (
      select 1 from public.appointment_requests r
      where r.accountant_id = NEW.accountant_id and r.starts_at = NEW.starts_at
        and r.status in ('pending', 'accepted')
    ) then
      raise exception 'That appointment time is already booked';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended(NEW.accountant_id::text || ':' || NEW.taxpayer_id::text, 0)
    );
    if exists (
      select 1 from public.appointment_requests r
      where r.accountant_id = NEW.accountant_id and r.taxpayer_id = NEW.taxpayer_id
        and r.status in ('pending', 'accepted')
    ) then
      raise exception 'You already have an appointment awaiting a response';
    end if;
    return NEW;
  end if;

  if NEW.accountant_id is distinct from OLD.accountant_id
    or NEW.taxpayer_id is distinct from OLD.taxpayer_id
    or NEW.starts_at is distinct from OLD.starts_at
    or NEW.duration_minutes is distinct from OLD.duration_minutes
    or NEW.meeting_type is distinct from OLD.meeting_type
    or NEW.note is distinct from OLD.note then
    raise exception 'Appointment request details cannot be changed';
  end if;

  if auth.uid() = OLD.accountant_id then
    if OLD.status <> 'pending' or NEW.status not in ('accepted', 'rejected') then
      raise exception 'Accountants may accept or reject pending appointment requests';
    end if;
    if NEW.status = 'rejected' and (
      NEW.alternative_starts_at is null or NEW.alternative_starts_at <= now()
      or NEW.alternative_starts_at = OLD.starts_at
    ) then
      raise exception 'Suggest a different future time when declining';
    end if;
  elsif auth.uid() = OLD.taxpayer_id then
    if NEW.status <> 'cancelled' or OLD.status not in ('pending', 'accepted') then
      raise exception 'Taxpayers may cancel a pending or accepted request';
    end if;
    if NEW.alternative_starts_at is distinct from OLD.alternative_starts_at then
      raise exception 'Taxpayers may not change an accountant time suggestion';
    end if;
  elsif auth.uid() is not null then
    raise exception 'Not an appointment request participant';
  end if;
  NEW.updated_at = now();
  return NEW;
end;
$$;

create or replace function public.notify_appointment_request_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _recipient uuid;
  _actor uuid;
  _title text;
  _body text;
  _conversation_id uuid;
begin
  if TG_OP = 'INSERT' then
    _recipient := NEW.accountant_id;
    _actor := NEW.taxpayer_id;
    _title := 'Appointment requested';
    _body := to_char(NEW.starts_at at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI') || ' UTC';
  elsif OLD.status is distinct from NEW.status and NEW.status in ('accepted', 'rejected') then
    _recipient := NEW.taxpayer_id;
    _actor := NEW.accountant_id;
    _title := case when NEW.status = 'accepted' then 'Appointment accepted' else 'Appointment declined' end;
    _body := to_char(NEW.starts_at at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI') || ' UTC';
    if NEW.status = 'rejected' then
      _body := _body || ' · Suggested: ' ||
        to_char(NEW.alternative_starts_at at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI') || ' UTC';
    end if;
  else
    return NEW;
  end if;

  insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
  values (_recipient, _actor, 'appointment_request', _title, _body, 'appointment_request', NEW.id);

  if TG_OP = 'UPDATE' and NEW.status = 'rejected' then
    insert into public.conversations (accountant_id, taxpayer_id)
    values (NEW.accountant_id, NEW.taxpayer_id)
    on conflict (taxpayer_id, accountant_id) do update set updated_at = now()
    returning id into _conversation_id;
    insert into public.messages (conversation_id, sender_id, body)
    values (
      _conversation_id,
      NEW.accountant_id,
      'I cannot make the requested time. I suggest ' ||
        to_char(NEW.alternative_starts_at at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI') || ' UTC instead.'
    );
  end if;
  return NEW;
end;
$$;