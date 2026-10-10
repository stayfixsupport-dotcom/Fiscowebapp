alter table public.accountant_clients
  drop constraint if exists accountant_clients_status_check;
alter table public.accountant_clients
  add constraint accountant_clients_status_check
  check (status in ('pending', 'active', 'rejected', 'ended'));

drop policy if exists "accountants approve or end relationships" on public.accountant_clients;
drop policy if exists "accountants respond to relationships" on public.accountant_clients;
create policy "accountants respond to relationships" on public.accountant_clients
  for update to authenticated
  using (auth.uid() in (accountant_id, taxpayer_id))
  with check (
    (auth.uid() = accountant_id and public.has_role(auth.uid(), 'accountant') and status in ('active', 'rejected', 'ended'))
    or (auth.uid() = taxpayer_id and public.has_role(auth.uid(), 'taxpayer') and status in ('pending', 'ended'))
  );

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'relationship_request', 'relationship_approved', 'relationship_rejected',
    'holiday_auto_reply', 'message', 'appointment', 'appointment_request',
    'service_case', 'review_reminder', 'document'
  ));
alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in (
    'accountant_client', 'message', 'appointment', 'appointment_request',
    'service_case', 'accountant_review', 'document'
  ));

grant delete on public.notifications to authenticated;
drop policy if exists "users delete own notifications" on public.notifications;
create policy "users delete own notifications" on public.notifications
  for delete to authenticated using (auth.uid() = recipient_id);

create or replace function public.notify_accountant_client_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (
      NEW.accountant_id, NEW.taxpayer_id, 'relationship_request',
      'New taxpayer request', 'A taxpayer wants to work with you.',
      'accountant_client', NEW.id
    );
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'pending' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (
      NEW.accountant_id, NEW.taxpayer_id, 'relationship_request',
      'New taxpayer request', 'A taxpayer wants to work with you.',
      'accountant_client', NEW.id
    );
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'active' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (
      NEW.taxpayer_id, NEW.accountant_id, 'relationship_approved',
      'Accountant accepted your request', 'You can now message your accountant and share documents.',
      'accountant_client', NEW.id
    );
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'rejected' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (
      NEW.taxpayer_id, NEW.accountant_id, 'relationship_rejected',
      'Accountant declined your request', 'You can choose another accountant or send a new request later.',
      'accountant_client', NEW.id
    );
  end if;
  return NEW;
end;
$$;
drop trigger if exists accountant_client_notifications on public.accountant_clients;
create trigger accountant_client_notifications
  after insert or update of status on public.accountant_clients
  for each row execute function public.notify_accountant_client_change();
drop trigger if exists notify_reopened_client_request on public.accountant_clients;
drop function if exists public.notify_reopened_client_request();

create or replace function public.ensure_conversation_after_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'active' and (
    TG_OP = 'INSERT' or OLD.status is distinct from NEW.status
  ) then
    insert into public.conversations (taxpayer_id, accountant_id)
    values (NEW.taxpayer_id, NEW.accountant_id)
    on conflict (taxpayer_id, accountant_id) do nothing;
  end if;
  return NEW;
end;
$$;
drop trigger if exists ensure_conversation_after_approval on public.accountant_clients;
create trigger ensure_conversation_after_approval
  after insert or update of status on public.accountant_clients
  for each row execute function public.ensure_conversation_after_approval();

create or replace function public.guard_document_handoff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return NEW; end if;

  if auth.uid() = OLD.owner_id then
    if NEW.owner_id is distinct from OLD.owner_id or NEW.owner_role is distinct from OLD.owner_role then
      raise exception 'Document ownership cannot be changed';
    end if;
    if NEW.status is distinct from OLD.status and NEW.status <> 'sent' then
      raise exception 'Taxpayers may only hand off a document';
    end if;
    if NEW.status = 'sent' and (
      NEW.accountant_id is null
      or not public.active_client_pair(NEW.accountant_id, OLD.owner_id)
    ) then
      raise exception 'The accountant must accept the taxpayer before documents can be shared';
    end if;
    if NEW.accountant_id is not null
      and not public.active_client_pair(NEW.accountant_id, OLD.owner_id) then
      raise exception 'Documents may only be assigned to an approved accountant';
    end if;
  elsif auth.uid() = OLD.accountant_id then
    if not public.active_client_pair(OLD.accountant_id, OLD.owner_id) then
      raise exception 'The taxpayer relationship is not active';
    end if;
    if NEW.accountant_id is distinct from OLD.accountant_id
      or NEW.status not in ('ready', 'returned', 'sent') then
      raise exception 'Accountants may only review shared documents';
    end if;
  else
    raise exception 'Not a document participant';
  end if;
  return NEW;
end;
$$;
drop trigger if exists guard_document_handoff on public.documents;
create trigger guard_document_handoff
  before update on public.documents
  for each row execute function public.guard_document_handoff();

create or replace function public.notify_document_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _recipient uuid;
  _actor uuid;
  _title text;
  _body text;
begin
  if OLD.status is not distinct from NEW.status then return NEW; end if;
  if NEW.status = 'sent' and NEW.accountant_id is not null then
    _recipient := NEW.accountant_id;
    _actor := NEW.owner_id;
    _title := 'New document to review';
    _body := NEW.name;
  elsif NEW.status in ('ready', 'returned') and NEW.owner_role = 'taxpayer' then
    _recipient := NEW.owner_id;
    _actor := NEW.accountant_id;
    _title := case when NEW.status = 'ready' then 'Document accepted' else 'Document returned' end;
    _body := NEW.name;
  else
    return NEW;
  end if;

  insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
  values (_recipient, _actor, 'document', _title, _body, 'document', NEW.id);
  return NEW;
end;
$$;
drop trigger if exists document_status_notifications on public.documents;
create trigger document_status_notifications
  after update of status on public.documents
  for each row execute function public.notify_document_status_change();

create table if not exists public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 120),
  meeting_type text not null default 'remote' check (meeting_type in ('remote', 'office', 'client_site')),
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appointment_requests_accountant_status_idx
  on public.appointment_requests (accountant_id, status, starts_at);
create index if not exists appointment_requests_taxpayer_created_idx
  on public.appointment_requests (taxpayer_id, created_at desc);
grant select, insert, update on public.appointment_requests to authenticated;
grant all on public.appointment_requests to service_role;
revoke update on public.appointment_requests from authenticated;
grant update (status, updated_at) on public.appointment_requests to authenticated;
alter table public.appointment_requests enable row level security;
drop policy if exists "participants read appointment requests" on public.appointment_requests;
create policy "participants read appointment requests" on public.appointment_requests
  for select to authenticated using (auth.uid() in (accountant_id, taxpayer_id));
drop policy if exists "taxpayers request appointments" on public.appointment_requests;
create policy "taxpayers request appointments" on public.appointment_requests
  for insert to authenticated with check (
    auth.uid() = taxpayer_id
    and status = 'pending'
    and starts_at > now()
    and exists (
      select 1 from public.accountant_clients ac
      where ac.accountant_id = appointment_requests.accountant_id
        and ac.taxpayer_id = appointment_requests.taxpayer_id
        and ac.status in ('pending', 'active')
    )
  );
drop policy if exists "participants respond to appointment requests" on public.appointment_requests;
create policy "participants respond to appointment requests" on public.appointment_requests
  for update to authenticated using (auth.uid() in (accountant_id, taxpayer_id))
  with check (auth.uid() in (accountant_id, taxpayer_id));

create or replace function public.guard_appointment_request_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is not null and (auth.uid() <> NEW.taxpayer_id or NEW.status <> 'pending' or NEW.starts_at <= now()) then
      raise exception 'Appointment requests must be submitted by the taxpayer for a future time';
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
  elsif auth.uid() = OLD.taxpayer_id then
    if NEW.status <> 'cancelled' or OLD.status not in ('pending', 'accepted') then
      raise exception 'Taxpayers may cancel a pending or accepted request';
    end if;
  elsif auth.uid() is not null then
    raise exception 'Not an appointment request participant';
  end if;
  NEW.updated_at = now();
  return NEW;
end;
$$;
drop trigger if exists guard_appointment_request_update on public.appointment_requests;
create trigger guard_appointment_request_update
  before insert or update on public.appointment_requests
  for each row execute function public.guard_appointment_request_update();

create or replace function public.notify_appointment_request_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _recipient uuid;
  _actor uuid;
  _title text;
  _body text;
begin
  if TG_OP = 'INSERT' then
    _recipient := NEW.accountant_id;
    _actor := NEW.taxpayer_id;
    _title := 'Appointment requested';
  elsif OLD.status is distinct from NEW.status and NEW.status in ('accepted', 'rejected') then
    _recipient := NEW.taxpayer_id;
    _actor := NEW.accountant_id;
    _title := case when NEW.status = 'accepted' then 'Appointment accepted' else 'Appointment declined' end;
  else
    return NEW;
  end if;
  _body := to_char(NEW.starts_at, 'Dy, DD Mon YYYY HH24:MI') || ' UTC';
  insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
  values (_recipient, _actor, 'appointment_request', _title, _body, 'appointment_request', NEW.id);
  return NEW;
end;
$$;
drop trigger if exists appointment_request_notifications on public.appointment_requests;
create trigger appointment_request_notifications
  after insert or update of status on public.appointment_requests
  for each row execute function public.notify_appointment_request_change();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointment_requests'
    ) then
    alter publication supabase_realtime add table public.appointment_requests;
  end if;
exception when undefined_object then null;
end $$;