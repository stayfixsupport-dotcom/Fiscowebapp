alter table public.profiles add column if not exists spoken_language text;
alter table public.taxpayer_profiles add column if not exists spoken_language text not null default '';

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'relationship_request', 'relationship_approved', 'holiday_auto_reply', 'message',
    'appointment', 'service_case', 'review_reminder'
  ));
alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('accountant_client', 'message', 'appointment', 'service_case', 'accountant_review'));

revoke insert, update on public.accountants from authenticated;
grant insert (
  id, name, firm, avatar_url, country_code, city, address, latitude, longitude, specialties, languages,
  phone_number, phone_country_code, time_zone, bio, is_listed, currency_code, price, pricing,
  free_intro, days, slots, slot_minutes, holiday, holiday_until, auto_accept, remote, home_visits,
  max_clients, response_hours, website_url, booking_url, updated_at
) on public.accountants to authenticated;
grant update (
  id, name, firm, avatar_url, country_code, city, address, latitude, longitude, specialties, languages,
  phone_number, phone_country_code, time_zone, bio, is_listed, currency_code, price, pricing,
  free_intro, days, slots, slot_minutes, holiday, holiday_until, auto_accept, remote, home_visits,
  max_clients, response_hours, website_url, booking_url, updated_at
) on public.accountants to authenticated;

create table if not exists public.service_cases (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 120),
  description text not null default '',
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'in_progress', 'completed', 'cancelled')),
  quoted_amount numeric(12,2) check (quoted_amount is null or quoted_amount >= 0),
  counter_amount numeric(12,2) check (counter_amount is null or counter_amount >= 0),
  currency_code text not null default 'EUR' check (currency_code ~ '^[A-Z]{3}$'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (created_by in (accountant_id, taxpayer_id))
);
create index if not exists service_cases_conversation_created_idx
  on public.service_cases (conversation_id, created_at desc);
grant select, insert, update on public.service_cases to authenticated;
grant all on public.service_cases to service_role;
alter table public.service_cases enable row level security;
drop policy if exists "participants read service cases" on public.service_cases;
create policy "participants read service cases" on public.service_cases
  for select to authenticated using (
    auth.uid() in (accountant_id, taxpayer_id)
    and public.active_client_pair(accountant_id, taxpayer_id)
  );
drop policy if exists "participants create service cases" on public.service_cases;
create policy "participants create service cases" on public.service_cases
  for insert to authenticated with check (
    auth.uid() = created_by
    and auth.uid() in (accountant_id, taxpayer_id)
    and status = 'proposed'
    and exists (
      select 1 from public.conversations c where c.id = conversation_id
        and c.accountant_id = service_cases.accountant_id
        and c.taxpayer_id = service_cases.taxpayer_id
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  );
drop policy if exists "participants update service cases" on public.service_cases;
create policy "participants update service cases" on public.service_cases
  for update to authenticated using (auth.uid() in (accountant_id, taxpayer_id))
  with check (auth.uid() in (accountant_id, taxpayer_id));

create or replace function public.guard_service_case_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.created_by <> auth.uid() or NEW.status <> 'proposed' then
      raise exception 'A service case must be proposed by a participant';
    end if;
    return NEW;
  end if;

  if NEW.conversation_id is distinct from OLD.conversation_id
    or NEW.accountant_id is distinct from OLD.accountant_id
    or NEW.taxpayer_id is distinct from OLD.taxpayer_id
    or NEW.created_by is distinct from OLD.created_by then
    raise exception 'Service participants cannot be changed';
  end if;

  if auth.uid() = NEW.taxpayer_id then
    if NEW.quoted_amount is distinct from OLD.quoted_amount
      or NEW.title is distinct from OLD.title
      or NEW.description is distinct from OLD.description
      or NEW.currency_code is distinct from OLD.currency_code then
      raise exception 'Taxpayers may not change accountant service details';
    end if;
    if NEW.status is distinct from OLD.status and not (
      OLD.status = 'proposed' and NEW.status in ('accepted', 'cancelled')
    ) then
      raise exception 'Taxpayers may accept or cancel a proposed service';
    end if;
  elsif auth.uid() = NEW.accountant_id then
    if NEW.counter_amount is distinct from OLD.counter_amount then
      raise exception 'Only the taxpayer may submit a counter-offer';
    end if;
    if NEW.status is distinct from OLD.status and not (
      (OLD.status in ('proposed', 'accepted') and NEW.status in ('proposed', 'in_progress', 'cancelled'))
      or (OLD.status = 'in_progress' and NEW.status in ('completed', 'cancelled'))
    ) then
      raise exception 'Invalid accountant service status change';
    end if;
  else
    raise exception 'Not a service participant';
  end if;

  if NEW.status = 'completed' then
    NEW.completed_at = coalesce(NEW.completed_at, now());
  elsif NEW.status <> 'completed' then
    NEW.completed_at = null;
  end if;
  NEW.updated_at = now();
  return NEW;
end;
$$;
drop trigger if exists guard_service_case_update on public.service_cases;
create trigger guard_service_case_update before insert or update on public.service_cases
  for each row execute function public.guard_service_case_update();

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 120),
  meeting_type text not null default 'remote' check (meeting_type in ('remote', 'office', 'client_site')),
  note text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_by in (accountant_id, taxpayer_id))
);
create index if not exists appointments_conversation_starts_idx
  on public.appointments (conversation_id, starts_at);
grant select, insert, update on public.appointments to authenticated;
grant all on public.appointments to service_role;
alter table public.appointments enable row level security;
drop policy if exists "participants read appointments" on public.appointments;
create policy "participants read appointments" on public.appointments
  for select to authenticated using (
    auth.uid() in (accountant_id, taxpayer_id)
    and public.active_client_pair(accountant_id, taxpayer_id)
  );
drop policy if exists "participants create appointments" on public.appointments;
create policy "participants create appointments" on public.appointments
  for insert to authenticated with check (
    auth.uid() = accountant_id and proposed_by = accountant_id
    and starts_at > now()
    and exists (
      select 1 from public.conversations c where c.id = conversation_id
        and c.accountant_id = appointments.accountant_id
        and c.taxpayer_id = appointments.taxpayer_id
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  );
drop policy if exists "participants update appointments" on public.appointments;
create policy "participants update appointments" on public.appointments
  for update to authenticated using (auth.uid() in (accountant_id, taxpayer_id))
  with check (auth.uid() in (accountant_id, taxpayer_id));

create or replace function public.guard_appointment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.proposed_by <> auth.uid() or NEW.status <> 'proposed' then
      raise exception 'An appointment must be proposed by a participant';
    end if;
    return NEW;
  end if;

  if NEW.accountant_id is distinct from OLD.accountant_id
    or NEW.taxpayer_id is distinct from OLD.taxpayer_id
    or NEW.conversation_id is distinct from OLD.conversation_id
    or NEW.proposed_by is distinct from OLD.proposed_by then
    raise exception 'Appointment participants cannot be changed';
  end if;
  if auth.uid() <> OLD.accountant_id and (
    NEW.starts_at is distinct from OLD.starts_at
    or NEW.duration_minutes is distinct from OLD.duration_minutes
    or NEW.meeting_type is distinct from OLD.meeting_type
    or NEW.note is distinct from OLD.note
  ) then
    raise exception 'Only the accountant may change appointment details';
  end if;
  if NEW.status is distinct from OLD.status then
    if auth.uid() = OLD.proposed_by and NEW.status <> 'cancelled' then
      raise exception 'Only the recipient may respond to an appointment proposal';
    elsif auth.uid() not in (OLD.accountant_id, OLD.taxpayer_id) then
      raise exception 'Not an appointment participant';
    elsif NEW.status not in ('confirmed', 'declined', 'cancelled') then
      raise exception 'Invalid appointment status';
    end if;
  end if;
  NEW.updated_at = now();
  return NEW;
end;
$$;
drop trigger if exists guard_appointment_update on public.appointments;
create trigger guard_appointment_update before insert or update on public.appointments
  for each row execute function public.guard_appointment_update();

create table if not exists public.accountant_reviews (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null unique references public.service_cases(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 600),
  created_at timestamptz not null default now()
);
create index if not exists accountant_reviews_public_idx
  on public.accountant_reviews (accountant_id, created_at desc);
grant select (id, accountant_id, rating, comment, created_at) on public.accountant_reviews to anon, authenticated;
grant insert on public.accountant_reviews to authenticated;
grant all on public.accountant_reviews to service_role;
alter table public.accountant_reviews enable row level security;
drop policy if exists "reviews are publicly readable" on public.accountant_reviews;
create policy "reviews are publicly readable" on public.accountant_reviews
  for select to anon, authenticated using (true);
drop policy if exists "taxpayers review completed services once" on public.accountant_reviews;
create policy "taxpayers review completed services once" on public.accountant_reviews
  for insert to authenticated with check (
    taxpayer_id = auth.uid()
    and exists (
      select 1 from public.service_cases s
      where s.id = service_case_id and s.accountant_id = accountant_reviews.accountant_id
        and s.taxpayer_id = auth.uid() and s.status = 'completed'
    )
  );

create or replace function public.refresh_accountant_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _accountant_id uuid;
begin
  if TG_OP = 'DELETE' then
    _accountant_id := OLD.accountant_id;
  else
    _accountant_id := NEW.accountant_id;
  end if;
  update public.accountants a
  set rating = stats.average_rating,
      review_count = stats.total_reviews,
      updated_at = now()
  from (
    select coalesce(round(avg(rating)::numeric, 1), 0)::numeric(2,1) as average_rating,
      count(*)::integer as total_reviews
    from public.accountant_reviews where accountant_id = _accountant_id
  ) stats
  where a.id = _accountant_id;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;
drop trigger if exists refresh_accountant_rating on public.accountant_reviews;
create trigger refresh_accountant_rating after insert or delete on public.accountant_reviews
  for each row execute function public.refresh_accountant_rating();

create or replace function public.notify_service_and_appointment_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _recipient uuid;
  _kind text;
  _title text;
  _body text;
  _entity_type text;
begin
  if TG_OP = 'UPDATE' and OLD.status is not distinct from NEW.status then
    return NEW;
  end if;
  if TG_TABLE_NAME = 'appointments' then
    _recipient := case
      when TG_OP = 'UPDATE' then NEW.proposed_by
      when NEW.proposed_by = NEW.accountant_id then NEW.taxpayer_id
      else NEW.accountant_id
    end;
    _kind := 'appointment';
    _title := case when TG_OP = 'INSERT' then 'Appointment proposed' else 'Appointment updated' end;
    _body := to_char(NEW.starts_at at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI') || ' UTC';
    _entity_type := 'appointment';
  else
    if TG_OP = 'INSERT' then
      _recipient := case when NEW.created_by = NEW.accountant_id then NEW.taxpayer_id else NEW.accountant_id end;
      _kind := 'service_case';
      _title := 'New work proposal';
      _body := NEW.title;
    elsif NEW.status = 'completed' and OLD.status is distinct from NEW.status then
      _recipient := NEW.taxpayer_id;
      _kind := 'review_reminder';
      _title := 'Work marked complete';
      _body := 'Review the completed service when you are ready.';
    else
      _recipient := case when auth.uid() = NEW.accountant_id then NEW.taxpayer_id else NEW.accountant_id end;
      _kind := 'service_case';
      _title := 'Work status updated';
      _body := NEW.title;
    end if;
    _entity_type := 'service_case';
  end if;

  if _recipient is not null then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (_recipient, auth.uid(), _kind, _title, _body, _entity_type, NEW.id);
  end if;
  return NEW;
end;
$$;
drop trigger if exists appointments_notifications on public.appointments;
create trigger appointments_notifications after insert or update of status on public.appointments
  for each row execute function public.notify_service_and_appointment_events();
drop trigger if exists service_cases_notifications on public.service_cases;
create trigger service_cases_notifications after insert or update of status on public.service_cases
  for each row execute function public.notify_service_and_appointment_events();

create or replace function public.notify_holiday_on_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _holiday boolean;
  _until date;
  _time_zone text;
  _language text;
  _body text;
begin
  select a.holiday, a.holiday_until, a.time_zone into _holiday, _until, _time_zone
  from public.accountants a where a.id = NEW.accountant_id;
  if _holiday is distinct from true or (_until is not null and _until < (now() at time zone coalesce(_time_zone, 'UTC'))::date) then
    return NEW;
  end if;
  select lower(coalesce(t.spoken_language, 'english')) into _language
  from public.taxpayer_profiles t where t.id = NEW.taxpayer_id;
  _body := case
    when _language like 'arab%' or _language = 'ar' then
      'المحاسب في إجازة' || case when _until is null then '.' else ' حتى ' || to_char(_until, 'DD Mon YYYY') || '.' end
    when _language like 'french%' or _language = 'fr' then
      'Votre comptable est en congé' || case when _until is null then '.' else ' jusqu’au ' || to_char(_until, 'DD Mon YYYY') || '.' end
    else
      'The accountant is on holiday' || case when _until is null then '.' else ' until ' || to_char(_until, 'DD Mon YYYY') || '.' end
  end;
  insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
  values (NEW.taxpayer_id, NEW.accountant_id, 'holiday_auto_reply', 'Accountant on holiday', _body, 'accountant_client', NEW.id);
  return NEW;
end;
$$;
drop trigger if exists holiday_auto_reply_on_request on public.accountant_clients;
create trigger holiday_auto_reply_on_request after insert on public.accountant_clients
  for each row when (NEW.status = 'pending') execute function public.notify_holiday_on_request();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments') then
      alter publication supabase_realtime add table public.appointments;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_cases') then
      alter publication supabase_realtime add table public.service_cases;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'accountant_reviews') then
      alter publication supabase_realtime add table public.accountant_reviews;
    end if;
  end if;
exception when undefined_object then null;
end $$;
