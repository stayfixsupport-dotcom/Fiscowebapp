alter table public.taxpayer_profiles
  add column if not exists spoken_language text not null default '';

alter table public.accountants
  add column if not exists phone_number text,
  add column if not exists phone_country_code text,
  add column if not exists time_zone text not null default 'UTC';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'accountants_phone_country_code_check'
      and conrelid = 'public.accountants'::regclass
  ) then
    alter table public.accountants
      add constraint accountants_phone_country_code_check
      check (phone_country_code is null or phone_country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('relationship_request', 'relationship_approved', 'message')),
  title text not null,
  body text not null default '',
  entity_type text not null check (entity_type in ('accountant_client', 'message')),
  entity_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id, created_at desc) where read_at is null;

grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
alter table public.notifications enable row level security;
drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications
  for select to authenticated using (auth.uid() = recipient_id);
drop policy if exists "users mark own notifications read" on public.notifications;
create policy "users mark own notifications read" on public.notifications
  for update to authenticated using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

create or replace function public.notify_accountant_client_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (
      NEW.accountant_id,
      NEW.taxpayer_id,
      'relationship_request',
      'New taxpayer request',
      'A taxpayer wants to work with you.',
      'accountant_client',
      NEW.id
    );
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'active' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (
      NEW.taxpayer_id,
      NEW.accountant_id,
      'relationship_approved',
      'Accountant accepted your request',
      'Your private conversation is ready.',
      'accountant_client',
      NEW.id
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists accountant_client_notifications on public.accountant_clients;
create trigger accountant_client_notifications
after insert or update of status on public.accountant_clients
for each row execute function public.notify_accountant_client_change();

create or replace function public.notify_conversation_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _recipient uuid;
begin
  select case
    when NEW.sender_id = c.taxpayer_id then c.accountant_id
    else c.taxpayer_id
  end into _recipient
  from public.conversations c
  where c.id = NEW.conversation_id;

  if _recipient is not null then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (
      _recipient,
      NEW.sender_id,
      'message',
      'New message',
      left(NEW.body, 240),
      'message',
      NEW.id
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists conversation_message_notifications on public.messages;
create trigger conversation_message_notifications
after insert on public.messages
for each row execute function public.notify_conversation_message();

grant delete on public.messages to authenticated;
drop policy if exists "senders delete own messages" on public.messages;
create policy "senders delete own messages" on public.messages
  for delete to authenticated using (
    sender_id = auth.uid() and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  );

create or replace function public.remove_deleted_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications
  where entity_type = 'message' and entity_id = OLD.id;
  return OLD;
end;
$$;

drop trigger if exists remove_deleted_message_notifications on public.messages;
create trigger remove_deleted_message_notifications
after delete on public.messages
for each row execute function public.remove_deleted_message_notifications();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then null;
end $$;
