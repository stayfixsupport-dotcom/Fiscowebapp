-- Fisco production schema for the user's Supabase project.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('taxpayer', 'accountant');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.document_status as enum ('processing', 'ready', 'sent', 'returned');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  country_code text check (country_code is null or length(country_code) = 2),
  locale text not null default 'fr' check (locale in ('fr', 'ar')),
  spoken_language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by signed in users" on public.profiles for select to authenticated using (true);
create policy "users create own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.taxpayer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  country_code text check (country_code is null or length(country_code) = 2),
  business_type text,
  tax_residency text,
  spoken_language text not null default '',
  annual_turnover text,
  goals text[] not null default '{}',
  document_types text[] not null default '{}',
  notes text not null default '',
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.taxpayer_profiles to authenticated;
grant all on public.taxpayer_profiles to service_role;
alter table public.taxpayer_profiles enable row level security;
create policy "taxpayers manage own profile" on public.taxpayer_profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select, insert on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "users read own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);
create policy "users choose own roles" on public.user_roles for insert to authenticated with check (
  auth.uid() = user_id
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

create table if not exists public.accountants (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  firm text,
  avatar_url text,
  country_code text not null check (length(country_code) = 2),
  city text,
  address text,
  latitude double precision,
  longitude double precision,
  specialties text[] not null default '{}',
  languages text[] not null default '{}',
  phone_number text,
  phone_country_code text check (phone_country_code is null or phone_country_code ~ '^[A-Z]{2}$'),
  time_zone text not null default 'UTC',
  rating numeric(2,1) check (rating is null or rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  verified boolean not null default false,
  bio text,
  is_listed boolean not null default false,
  currency_code text not null default 'EUR' check (currency_code ~ '^[A-Z]{3}$'),
  price numeric(12,2) not null default 0 check (price >= 0),
  pricing text not null default 'Per filing' check (pricing in ('Per hour', 'Per filing', 'Monthly retainer')),
  free_intro boolean not null default false,
  days text[] not null default '{}',
  slots text[] not null default '{}',
  slot_minutes integer not null default 45 check (slot_minutes between 15 and 120),
  holiday boolean not null default false,
  holiday_until date,
  auto_accept boolean not null default false,
  remote boolean not null default true,
  home_visits boolean not null default false,
  max_clients integer not null default 25 check (max_clients between 1 and 500),
  response_hours integer not null default 24 check (response_hours between 1 and 168),
  website_url text,
  booking_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.taxpayer_profiles add column if not exists spoken_language text not null default '';
alter table public.accountants
  add column if not exists phone_number text,
  add column if not exists phone_country_code text,
  add column if not exists time_zone text not null default 'UTC';
grant select on public.accountants to anon, authenticated;
grant insert, update, delete on public.accountants to authenticated;
grant all on public.accountants to service_role;
alter table public.accountants enable row level security;
create policy "accountants are publicly readable" on public.accountants for select to anon, authenticated using (true);
create policy "accountants create own listing" on public.accountants for insert to authenticated with check (auth.uid() = id and public.has_role(auth.uid(), 'accountant'));
create policy "accountants update own listing" on public.accountants for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "accountants delete own listing" on public.accountants for delete to authenticated using (auth.uid() = id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "avatar images are publicly readable" on storage.objects;
create policy "avatar images are publicly readable" on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
drop policy if exists "users upload own avatars" on storage.objects;
create policy "users upload own avatars" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users update own avatars" on storage.objects;
create policy "users update own avatars" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users delete own avatars" on storage.objects;
create policy "users delete own avatars" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.accountant_clients (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','ended')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(accountant_id, taxpayer_id)
);
alter table public.accountant_clients add column if not exists approved_at timestamptz;
update public.accountant_clients set approved_at = created_at where status = 'active' and approved_at is null;
grant select, insert, update, delete on public.accountant_clients to authenticated;
grant all on public.accountant_clients to service_role;
alter table public.accountant_clients enable row level security;
drop policy if exists "relationship participants can read" on public.accountant_clients;
create policy "relationship participants can read" on public.accountant_clients for select to authenticated using (auth.uid() in (accountant_id, taxpayer_id));
drop policy if exists "taxpayers can request an accountant" on public.accountant_clients;
create policy "taxpayers can request an accountant" on public.accountant_clients for insert to authenticated with check (
  auth.uid() = taxpayer_id and public.has_role(auth.uid(), 'taxpayer') and status = 'pending'
);
drop policy if exists "participants can update relationship" on public.accountant_clients;
drop policy if exists "accountants approve or end relationships" on public.accountant_clients;
create policy "accountants approve or end relationships" on public.accountant_clients for update to authenticated
  using (auth.uid() = accountant_id or auth.uid() = taxpayer_id)
  with check (
    (auth.uid() = accountant_id and public.has_role(auth.uid(), 'accountant') and status in ('active', 'ended'))
    or (auth.uid() = taxpayer_id and public.has_role(auth.uid(), 'taxpayer') and status in ('pending', 'ended'))
  );
drop policy if exists "participants can end relationship" on public.accountant_clients;
drop policy if exists "participants end relationships" on public.accountant_clients;
create policy "participants end relationships" on public.accountant_clients for delete to authenticated
  using (auth.uid() = taxpayer_id and status = 'pending');

create or replace function public.active_client_pair(_accountant_id uuid, _taxpayer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accountant_clients
    where accountant_id = _accountant_id and taxpayer_id = _taxpayer_id and status = 'active'
  )
$$;
grant execute on function public.active_client_pair(uuid, uuid) to authenticated;

drop policy if exists "accountants read active client profiles" on public.taxpayer_profiles;
create policy "accountants read active client profiles" on public.taxpayer_profiles for select to authenticated
  using (public.active_client_pair(auth.uid(), id));

create table if not exists public.accountant_fee_entries (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  client_name text,
  description text not null check (length(btrim(description)) > 0),
  amount numeric(12,2) not null check (amount > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'invoiced' check (status in ('invoiced', 'paid', 'void')),
  issued_at date not null default current_date,
  due_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.accountant_fee_entries to authenticated;
grant all on public.accountant_fee_entries to service_role;
alter table public.accountant_fee_entries enable row level security;
create policy "accountants manage own fee entries" on public.accountant_fee_entries for all to authenticated
  using (auth.uid() = accountant_id)
  with check (auth.uid() = accountant_id and public.has_role(auth.uid(), 'accountant'));

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_role public.app_role not null default 'taxpayer',
  accountant_id uuid references public.accountants(id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  drive_file_id text,
  preview_url text,
  embed_url text,
  status public.document_status not null default 'processing',
  extracted_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.documents add column if not exists owner_role public.app_role not null default 'taxpayer';
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
drop policy if exists "owners and assigned accountants read documents" on public.documents;
drop policy if exists "owners and approved accountants read documents" on public.documents;
create policy "owners and approved accountants read documents" on public.documents for select to authenticated using (
  auth.uid() = owner_id or (auth.uid() = accountant_id and public.active_client_pair(accountant_id, owner_id))
);
drop policy if exists "owners create documents" on public.documents;
drop policy if exists "owners create role scoped documents" on public.documents;
create policy "owners create role scoped documents" on public.documents for insert to authenticated
  with check (auth.uid() = owner_id and public.has_role(auth.uid(), owner_role));
drop policy if exists "owners and assigned accountants update documents" on public.documents;
drop policy if exists "owners and approved accountants update documents" on public.documents;
create policy "owners and approved accountants update documents" on public.documents for update to authenticated
  using (auth.uid() = owner_id or (auth.uid() = accountant_id and public.active_client_pair(accountant_id, owner_id)))
  with check (auth.uid() = owner_id or (auth.uid() = accountant_id and public.active_client_pair(accountant_id, owner_id)));
drop policy if exists "owners delete documents" on public.documents;
create policy "owners delete documents" on public.documents for delete to authenticated using (auth.uid() = owner_id);
revoke update on public.documents from authenticated;
grant update (accountant_id, status, updated_at) on public.documents to authenticated;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  accountant_work_completed_at timestamptz,
  review_prompt_dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(taxpayer_id, accountant_id)
);
alter table public.conversations
  add column if not exists accountant_work_completed_at timestamptz,
  add column if not exists review_prompt_dismissed_at timestamptz;
grant select, insert, update on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
drop policy if exists "conversation participants read" on public.conversations;
drop policy if exists "active relationship participants read conversations" on public.conversations;
create policy "active relationship participants read conversations" on public.conversations for select to authenticated
  using (auth.uid() in (taxpayer_id, accountant_id) and public.active_client_pair(accountant_id, taxpayer_id));
drop policy if exists "participants create conversations" on public.conversations;
drop policy if exists "active relationship participants create conversations" on public.conversations;
create policy "active relationship participants create conversations" on public.conversations for insert to authenticated
  with check (auth.uid() in (taxpayer_id, accountant_id) and public.active_client_pair(accountant_id, taxpayer_id));
drop policy if exists "participants update conversations" on public.conversations;
drop policy if exists "active relationship participants update conversations" on public.conversations;
create policy "active relationship participants update conversations" on public.conversations for update to authenticated
  using (auth.uid() in (taxpayer_id, accountant_id) and public.active_client_pair(accountant_id, taxpayer_id))
  with check (auth.uid() in (taxpayer_id, accountant_id) and public.active_client_pair(accountant_id, taxpayer_id));
revoke update on public.conversations from authenticated;
grant update (updated_at) on public.conversations to authenticated;

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

create table if not exists public.conversation_user_settings (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_blocked boolean not null default false,
  is_restricted boolean not null default false,
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
grant select, insert, delete on public.conversation_user_settings to authenticated;
grant all on public.conversation_user_settings to service_role;
alter table public.conversation_user_settings enable row level security;
revoke update on public.conversation_user_settings from authenticated;
grant update (conversation_id, user_id, is_blocked, is_restricted, hidden_at, updated_at)
  on public.conversation_user_settings to authenticated;
drop policy if exists "participants manage own conversation settings" on public.conversation_user_settings;
create policy "participants manage own conversation settings" on public.conversation_user_settings for all to authenticated
  using (auth.uid() = user_id and exists (
    select 1 from public.conversations c where c.id = conversation_id
      and public.active_client_pair(c.accountant_id, c.taxpayer_id)
  ))
  with check (auth.uid() = user_id and exists (
    select 1 from public.conversations c where c.id = conversation_id
      and auth.uid() in (c.accountant_id, c.taxpayer_id)
      and public.active_client_pair(c.accountant_id, c.taxpayer_id)
  ));

create or replace function public.can_send_conversation_message(_conversation_id uuid, _sender_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c where c.id = _conversation_id
        and auth.uid() in (c.accountant_id, c.taxpayer_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
    and not exists (
      select 1 from public.conversation_user_settings s
      where s.conversation_id = _conversation_id and s.is_blocked
    )
$$;
grant execute on function public.can_send_conversation_message(uuid, uuid) to authenticated;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  is_hybrid boolean not null default false,
  read_at timestamptz,
  edited_at timestamptz,
  forwarded_from_message_id uuid references public.messages(id) on delete set null,
  attachment jsonb,
  created_at timestamptz not null default now()
);
alter table public.messages add column if not exists is_hybrid boolean not null default false;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists attachment jsonb;
alter table public.messages add column if not exists forwarded_from_message_id uuid
  references public.messages(id) on delete set null;
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
drop policy if exists "participants read messages" on public.messages;
drop policy if exists "active relationship participants read messages" on public.messages;
create policy "active relationship participants read messages" on public.messages for select to authenticated using (
  exists (
    select 1 from public.conversations c where c.id = conversation_id
      and auth.uid() in (c.taxpayer_id, c.accountant_id)
      and public.active_client_pair(c.accountant_id, c.taxpayer_id)
  )
  and (
    sender_id = auth.uid() or not exists (
      select 1 from public.conversation_user_settings s
      where s.conversation_id = public.messages.conversation_id
        and s.user_id = auth.uid() and s.is_restricted
    )
  )
);
drop policy if exists "participants send messages" on public.messages;
drop policy if exists "active relationship participants send messages" on public.messages;
create policy "active relationship participants send messages" on public.messages for insert to authenticated
  with check (public.can_send_conversation_message(conversation_id, sender_id));
drop policy if exists "participants mark messages read" on public.messages;
drop policy if exists "participants mark received messages read" on public.messages;
create policy "participants mark received messages read" on public.messages for update to authenticated
  using (sender_id <> auth.uid() and exists (
    select 1 from public.conversations c where c.id = conversation_id
      and auth.uid() in (c.taxpayer_id, c.accountant_id)
      and public.active_client_pair(c.accountant_id, c.taxpayer_id)
  ))
  with check (sender_id <> auth.uid());
revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;
grant update (body, edited_at) on public.messages to authenticated;
drop policy if exists "senders edit own messages" on public.messages;
create policy "senders edit own messages" on public.messages for update to authenticated
  using (
    sender_id = auth.uid() and exists (
      select 1 from public.conversations c where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  )
  with check (
    sender_id = auth.uid() and length(btrim(body)) > 0 and exists (
      select 1 from public.conversations c where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  );

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('relationship_request', 'relationship_approved', 'holiday_auto_reply', 'message', 'appointment', 'service_case', 'review_reminder')),
  title text not null,
  body text not null default '',
  entity_type text not null check (entity_type in ('accountant_client', 'message', 'appointment', 'service_case', 'accountant_review')),
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

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
grant select, insert, update, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;
alter table public.push_tokens enable row level security;
drop policy if exists "users manage own push tokens" on public.push_tokens;
create policy "users manage own push tokens" on public.push_tokens
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.notify_accountant_client_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (NEW.accountant_id, NEW.taxpayer_id, 'relationship_request', 'New taxpayer request',
      'A taxpayer wants to work with you.', 'accountant_client', NEW.id);
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'pending' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (NEW.accountant_id, NEW.taxpayer_id, 'relationship_request', 'New taxpayer request',
      'A taxpayer wants to work with you.', 'accountant_client', NEW.id);
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'active' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (NEW.taxpayer_id, NEW.accountant_id, 'relationship_approved', 'Accountant accepted your request',
      'Your private conversation is ready.', 'accountant_client', NEW.id);
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
  select case when NEW.sender_id = c.taxpayer_id then c.accountant_id else c.taxpayer_id end
    into _recipient from public.conversations c where c.id = NEW.conversation_id;
  if _recipient is not null then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (_recipient, NEW.sender_id, 'message', 'New message', left(NEW.body, 240), 'message', NEW.id);
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
      select 1 from public.conversations c where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  );
create or replace function public.remove_deleted_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications where entity_type = 'message' and entity_id = OLD.id;
  return OLD;
end;
$$;
drop trigger if exists remove_deleted_message_notifications on public.messages;
create trigger remove_deleted_message_notifications
after delete on public.messages
for each row execute function public.remove_deleted_message_notifications();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then null;
end $$;

-- Follow-up contract for signup currency, verified reviews, and appointment declines.
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
  _reviewer_name text;
  _reviewer_avatar_url text;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'taxpayer') then
    raise exception 'Only taxpayers may review an accountant';
  end if;
  if p_rating is null or p_rating not between 1 and 5 or length(coalesce(p_comment, '')) > 600 then
    raise exception 'The review rating or comment is invalid';
  end if;

  select c.taxpayer_id into _taxpayer_id
  from public.conversations c
  where c.id = p_conversation_id and c.accountant_id = p_accountant_id;
  if _taxpayer_id is distinct from auth.uid() then
    raise exception 'The review conversation does not belong to this taxpayer';
  end if;
  if not public.active_client_pair(p_accountant_id, auth.uid()) then
    raise exception 'Only accepted accountant relationships can be reviewed';
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

alter table public.profiles add column if not exists spoken_language text;
revoke insert, update on public.accountants from authenticated;
grant insert (
  id, name, firm, avatar_url, country_code, city, address, latitude, longitude, specialties, languages,
  phone_number, phone_country_code, time_zone, bio, is_listed, currency_code, price, pricing, free_intro,
  days, slots, slot_minutes, holiday, holiday_until, auto_accept, remote, home_visits, max_clients,
  response_hours, website_url, booking_url, updated_at
) on public.accountants to authenticated;
grant update (
  id, name, firm, avatar_url, country_code, city, address, latitude, longitude, specialties, languages,
  phone_number, phone_country_code, time_zone, bio, is_listed, currency_code, price, pricing, free_intro,
  days, slots, slot_minutes, holiday, holiday_until, auto_accept, remote, home_visits, max_clients,
  response_hours, website_url, booking_url, updated_at
) on public.accountants to authenticated;

create table if not exists public.service_cases (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 120),
  description text not null default '',
  status text not null default 'proposed' check (status in ('proposed','accepted','in_progress','completed','cancelled')),
  quoted_amount numeric(12,2) check (quoted_amount is null or quoted_amount >= 0),
  counter_amount numeric(12,2) check (counter_amount is null or counter_amount >= 0),
  currency_code text not null default 'EUR' check (currency_code ~ '^[A-Z]{3}$'),
  completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (created_by in (accountant_id, taxpayer_id))
);
create index if not exists service_cases_conversation_created_idx on public.service_cases (conversation_id, created_at desc);
grant select, insert, update on public.service_cases to authenticated;
grant all on public.service_cases to service_role;
alter table public.service_cases enable row level security;
drop policy if exists "participants read service cases" on public.service_cases;
create policy "participants read service cases" on public.service_cases for select to authenticated
  using (auth.uid() in (accountant_id, taxpayer_id) and public.active_client_pair(accountant_id, taxpayer_id));
drop policy if exists "participants create service cases" on public.service_cases;
create policy "participants create service cases" on public.service_cases for insert to authenticated with check (
  auth.uid() = created_by and auth.uid() in (accountant_id, taxpayer_id) and status = 'proposed'
  and exists (select 1 from public.conversations c where c.id = conversation_id
    and c.accountant_id = service_cases.accountant_id and c.taxpayer_id = service_cases.taxpayer_id
    and public.active_client_pair(c.accountant_id, c.taxpayer_id))
);
drop policy if exists "participants update service cases" on public.service_cases;
create policy "participants update service cases" on public.service_cases for update to authenticated
  using (auth.uid() in (accountant_id, taxpayer_id)) with check (auth.uid() in (accountant_id, taxpayer_id));
create or replace function public.guard_service_case_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.created_by <> auth.uid() or NEW.status <> 'proposed' then raise exception 'A service case must be proposed by a participant'; end if;
    return NEW;
  end if;
  if NEW.conversation_id is distinct from OLD.conversation_id or NEW.accountant_id is distinct from OLD.accountant_id
    or NEW.taxpayer_id is distinct from OLD.taxpayer_id or NEW.created_by is distinct from OLD.created_by then raise exception 'Service participants cannot be changed'; end if;
  if auth.uid() = NEW.taxpayer_id then
    if NEW.quoted_amount is distinct from OLD.quoted_amount or NEW.title is distinct from OLD.title
      or NEW.description is distinct from OLD.description or NEW.currency_code is distinct from OLD.currency_code then
      raise exception 'Taxpayers may not change accountant service details'; end if;
    if NEW.status is distinct from OLD.status and not (OLD.status = 'proposed' and NEW.status in ('accepted','cancelled')) then raise exception 'Taxpayers may accept or cancel a proposed service'; end if;
  elsif auth.uid() = NEW.accountant_id then
    if NEW.counter_amount is distinct from OLD.counter_amount then raise exception 'Only the taxpayer may counter-offer'; end if;
    if NEW.status is distinct from OLD.status and not ((OLD.status in ('proposed','accepted') and NEW.status in ('proposed','in_progress','cancelled')) or (OLD.status = 'in_progress' and NEW.status in ('completed','cancelled'))) then raise exception 'Invalid accountant service status change'; end if;
  else raise exception 'Not a service participant'; end if;
  if NEW.status = 'completed' then NEW.completed_at = coalesce(NEW.completed_at, now()); else NEW.completed_at = null; end if;
  NEW.updated_at = now(); return NEW;
end;
$$;
drop trigger if exists guard_service_case_update on public.service_cases;
create trigger guard_service_case_update before insert or update on public.service_cases for each row execute function public.guard_service_case_update();

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 120),
  meeting_type text not null default 'remote' check (meeting_type in ('remote','office','client_site')),
  note text not null default '',
  status text not null default 'proposed' check (status in ('proposed','confirmed','declined','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (proposed_by in (accountant_id, taxpayer_id))
);
create index if not exists appointments_conversation_starts_idx on public.appointments (conversation_id, starts_at);
grant select, insert, update on public.appointments to authenticated;
grant all on public.appointments to service_role;
alter table public.appointments enable row level security;
drop policy if exists "participants read appointments" on public.appointments;
create policy "participants read appointments" on public.appointments for select to authenticated
  using (auth.uid() in (accountant_id,taxpayer_id) and public.active_client_pair(accountant_id,taxpayer_id));
drop policy if exists "participants create appointments" on public.appointments;
create policy "participants create appointments" on public.appointments for insert to authenticated with check (
  auth.uid() = accountant_id and proposed_by = accountant_id and starts_at > now()
  and exists (select 1 from public.conversations c where c.id = conversation_id and c.accountant_id = appointments.accountant_id
    and c.taxpayer_id = appointments.taxpayer_id and public.active_client_pair(c.accountant_id, c.taxpayer_id))
);
drop policy if exists "participants update appointments" on public.appointments;
create policy "participants update appointments" on public.appointments for update to authenticated using (auth.uid() in (accountant_id,taxpayer_id)) with check (auth.uid() in (accountant_id,taxpayer_id));
create or replace function public.guard_appointment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.proposed_by <> auth.uid() or NEW.status <> 'proposed' then raise exception 'An appointment must be proposed by a participant'; end if;
    return NEW;
  end if;
  if NEW.accountant_id is distinct from OLD.accountant_id or NEW.taxpayer_id is distinct from OLD.taxpayer_id or NEW.conversation_id is distinct from OLD.conversation_id or NEW.proposed_by is distinct from OLD.proposed_by then raise exception 'Appointment participants cannot be changed'; end if;
  if auth.uid() <> OLD.accountant_id and (NEW.starts_at is distinct from OLD.starts_at or NEW.duration_minutes is distinct from OLD.duration_minutes or NEW.meeting_type is distinct from OLD.meeting_type or NEW.note is distinct from OLD.note) then raise exception 'Only the accountant may change appointment details'; end if;
  if NEW.status is distinct from OLD.status then
    if auth.uid() = OLD.proposed_by and NEW.status <> 'cancelled' then raise exception 'Only the recipient may respond';
    elsif auth.uid() not in (OLD.accountant_id,OLD.taxpayer_id) then raise exception 'Not an appointment participant';
    elsif NEW.status not in ('confirmed','declined','cancelled') then raise exception 'Invalid appointment status'; end if;
  end if;
  NEW.updated_at = now(); return NEW;
end;
$$;
drop trigger if exists guard_appointment_update on public.appointments;
create trigger guard_appointment_update before insert or update on public.appointments for each row execute function public.guard_appointment_update();

create table if not exists public.accountant_reviews (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null unique references public.service_cases(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  reviewer_name text not null default 'Taxpayer',
  reviewer_avatar_url text,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 600),
  created_at timestamptz not null default now()
);
create index if not exists accountant_reviews_public_idx on public.accountant_reviews (accountant_id, created_at desc);
grant select (id,accountant_id,reviewer_name,reviewer_avatar_url,rating,comment,created_at) on public.accountant_reviews to anon,authenticated;
grant select (service_case_id) on public.accountant_reviews to authenticated;
revoke insert on public.accountant_reviews from authenticated;
grant all on public.accountant_reviews to service_role;
alter table public.accountant_reviews enable row level security;
drop policy if exists "reviews are publicly readable" on public.accountant_reviews;
create policy "reviews are publicly readable" on public.accountant_reviews for select to anon,authenticated using (true);
drop policy if exists "taxpayers review completed services once" on public.accountant_reviews;
create policy "taxpayers review completed services once" on public.accountant_reviews for insert to authenticated with check (
  taxpayer_id = auth.uid() and exists (select 1 from public.service_cases s where s.id = service_case_id and s.accountant_id = accountant_reviews.accountant_id and s.taxpayer_id = auth.uid() and s.status = 'completed')
);
create or replace function public.prevent_duplicate_accountant_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(NEW.accountant_id::text || ':' || NEW.taxpayer_id::text, 0));
  if exists (
    select 1 from public.accountant_reviews existing
    where existing.accountant_id = NEW.accountant_id
      and existing.taxpayer_id = NEW.taxpayer_id
  ) then
    raise exception 'A taxpayer may review an accountant only once';
  end if;
  return NEW;
end;
$$;
drop trigger if exists prevent_duplicate_accountant_review on public.accountant_reviews;
create trigger prevent_duplicate_accountant_review before insert on public.accountant_reviews
  for each row execute function public.prevent_duplicate_accountant_review();
create or replace function public.refresh_accountant_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare _accountant_id uuid;
begin
  if TG_OP = 'DELETE' then _accountant_id = OLD.accountant_id; else _accountant_id = NEW.accountant_id; end if;
  update public.accountants a set rating = stats.average_rating, review_count = stats.total_reviews, updated_at = now()
    from (select coalesce(round(avg(rating)::numeric,1),0)::numeric(2,1) as average_rating, count(*)::integer as total_reviews from public.accountant_reviews where accountant_id = _accountant_id) stats where a.id = _accountant_id;
  if TG_OP = 'DELETE' then return OLD; end if; return NEW;
end;
$$;
drop trigger if exists refresh_accountant_rating on public.accountant_reviews;
create trigger refresh_accountant_rating after insert or delete on public.accountant_reviews for each row execute function public.refresh_accountant_rating();

create or replace function public.notify_service_and_appointment_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare _recipient uuid; _kind text; _title text; _body text; _entity_type text;
begin
  if TG_OP = 'UPDATE' and OLD.status is not distinct from NEW.status then return NEW; end if;
  if TG_TABLE_NAME = 'appointments' then
    _recipient := case when TG_OP = 'UPDATE' then NEW.proposed_by when NEW.proposed_by = NEW.accountant_id then NEW.taxpayer_id else NEW.accountant_id end;
    _kind := 'appointment'; _title := case when TG_OP = 'INSERT' then 'Appointment proposed' else 'Appointment updated' end;
    _body := to_char(NEW.starts_at at time zone 'UTC','Dy, DD Mon YYYY HH24:MI') || ' UTC'; _entity_type := 'appointment';
  else
    if TG_OP = 'INSERT' then _recipient := case when NEW.created_by = NEW.accountant_id then NEW.taxpayer_id else NEW.accountant_id end; _kind := 'service_case'; _title := 'New work proposal'; _body := NEW.title;
    elsif NEW.status = 'completed' then _recipient := NEW.taxpayer_id; _kind := 'review_reminder'; _title := 'Work marked complete'; _body := 'Review the completed service when you are ready.';
    else _recipient := case when auth.uid() = NEW.accountant_id then NEW.taxpayer_id else NEW.accountant_id end; _kind := 'service_case'; _title := 'Work status updated'; _body := NEW.title; end if;
    _entity_type := 'service_case';
  end if;
  insert into public.notifications (recipient_id,actor_id,kind,title,body,entity_type,entity_id) values (_recipient,auth.uid(),_kind,_title,_body,_entity_type,NEW.id);
  return NEW;
end;
$$;
drop trigger if exists appointments_notifications on public.appointments;
create trigger appointments_notifications after insert or update of status on public.appointments for each row execute function public.notify_service_and_appointment_events();
drop trigger if exists service_cases_notifications on public.service_cases;
create trigger service_cases_notifications after insert or update of status on public.service_cases for each row execute function public.notify_service_and_appointment_events();

create or replace function public.notify_holiday_on_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare _holiday boolean; _until date; _time_zone text; _language text; _body text;
begin
  select holiday,holiday_until,time_zone into _holiday,_until,_time_zone from public.accountants where id = NEW.accountant_id;
  if _holiday is distinct from true or (_until is not null and _until < (now() at time zone coalesce(_time_zone,'UTC'))::date) then return NEW; end if;
  select lower(coalesce(spoken_language,'english')) into _language from public.taxpayer_profiles where id = NEW.taxpayer_id;
  _body := case when _language like 'arab%' or _language = 'ar' then 'المحاسب في إجازة' || case when _until is null then '.' else ' حتى ' || to_char(_until,'DD Mon YYYY') || '.' end
    when _language like 'french%' or _language = 'fr' then 'Votre comptable est en congé' || case when _until is null then '.' else ' jusqu’au ' || to_char(_until,'DD Mon YYYY') || '.' end
    else 'The accountant is on holiday' || case when _until is null then '.' else ' until ' || to_char(_until,'DD Mon YYYY') || '.' end end;
  insert into public.notifications (recipient_id,actor_id,kind,title,body,entity_type,entity_id) values (NEW.taxpayer_id,NEW.accountant_id,'holiday_auto_reply','Accountant on holiday',_body,'accountant_client',NEW.id);
  return NEW;
end;
$$;
drop trigger if exists holiday_auto_reply_on_request on public.accountant_clients;
create trigger holiday_auto_reply_on_request after insert on public.accountant_clients for each row when (NEW.status = 'pending') execute function public.notify_holiday_on_request();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointments') then alter publication supabase_realtime add table public.appointments; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='service_cases') then alter publication supabase_realtime add table public.service_cases; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='accountant_reviews') then alter publication supabase_realtime add table public.accountant_reviews; end if;
  end if;
exception when undefined_object then null;
end $$;

create table if not exists public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nouvelle conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ai_threads to authenticated;
grant all on public.ai_threads to service_role;
alter table public.ai_threads enable row level security;
create policy "users own ai threads" on public.ai_threads for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  parts jsonb not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.ai_messages to authenticated;
grant all on public.ai_messages to service_role;
alter table public.ai_messages enable row level security;
create policy "users own ai messages" on public.ai_messages for all to authenticated using (exists(select 1 from public.ai_threads t where t.id = thread_id and t.user_id = auth.uid())) with check (exists(select 1 from public.ai_threads t where t.id = thread_id and t.user_id = auth.uid()));

drop function if exists public.consume_ai_chat_daily_quota();
drop table if exists public.ai_chat_daily_usage;

create table if not exists public.ai_image_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null default now()
);
create index if not exists ai_image_usage_events_user_time_idx
  on public.ai_image_usage_events (user_id, consumed_at);
alter table public.ai_image_usage_events enable row level security;
revoke all on public.ai_image_usage_events from anon, authenticated;
grant all on public.ai_image_usage_events to service_role;

create or replace function public.consume_ai_image_daily_quota()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  current_usage integer;
  first_usage timestamptz;
  current_time_utc timestamptz := transaction_timestamp();
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user::text, 0));

  select count(*)::integer, min(consumed_at)
    into current_usage, first_usage
    from public.ai_image_usage_events
    where user_id = requesting_user
      and consumed_at > current_time_utc - interval '24 hours';

  if current_usage >= 2 then
    return jsonb_build_object(
      'allowed', false,
      'used', current_usage,
      'limit', 2,
      'reset_at', first_usage + interval '24 hours'
    );
  end if;

  insert into public.ai_image_usage_events (user_id, consumed_at)
  values (requesting_user, current_time_utc);

  return jsonb_build_object('allowed', true, 'used', current_usage + 1, 'limit', 2);
end;
$$;
revoke all on function public.consume_ai_image_daily_quota() from public, anon;
grant execute on function public.consume_ai_image_daily_quota() to authenticated;

create or replace function public.get_ai_image_quota()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  current_usage integer;
  first_usage timestamptz;
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  select count(*)::integer, min(consumed_at)
    into current_usage, first_usage
    from public.ai_image_usage_events
    where user_id = requesting_user
      and consumed_at > transaction_timestamp() - interval '24 hours';

  return jsonb_build_object(
    'allowed', current_usage < 2,
    'used', current_usage,
    'limit', 2,
    'reset_at', case when current_usage >= 2 then first_usage + interval '24 hours' else null end
  );
end;
$$;
revoke all on function public.get_ai_image_quota() from public, anon;
grant execute on function public.get_ai_image_quota() to authenticated;

create table if not exists public.ai_document_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null default now()
);
create index if not exists ai_document_usage_events_user_time_idx
  on public.ai_document_usage_events (user_id, consumed_at);
alter table public.ai_document_usage_events enable row level security;
revoke all on public.ai_document_usage_events from anon, authenticated;
grant all on public.ai_document_usage_events to service_role;

create or replace function public.consume_ai_document_daily_quota()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  current_usage integer;
  first_usage timestamptz;
  current_time_utc timestamptz := transaction_timestamp();
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user::text || ':document', 0));

  select count(*)::integer, min(consumed_at)
    into current_usage, first_usage
    from public.ai_document_usage_events
    where user_id = requesting_user
      and consumed_at > current_time_utc - interval '24 hours';

  if current_usage >= 2 then
    return jsonb_build_object(
      'allowed', false,
      'used', current_usage,
      'limit', 2,
      'reset_at', first_usage + interval '24 hours'
    );
  end if;

  insert into public.ai_document_usage_events (user_id, consumed_at)
  values (requesting_user, current_time_utc);

  return jsonb_build_object('allowed', true, 'used', current_usage + 1, 'limit', 2);
end;
$$;
revoke all on function public.consume_ai_document_daily_quota() from public, anon;
grant execute on function public.consume_ai_document_daily_quota() to authenticated;

create or replace function public.get_ai_document_quota()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  current_usage integer;
  first_usage timestamptz;
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  select count(*)::integer, min(consumed_at)
    into current_usage, first_usage
    from public.ai_document_usage_events
    where user_id = requesting_user
      and consumed_at > transaction_timestamp() - interval '24 hours';

  return jsonb_build_object(
    'allowed', current_usage < 2,
    'used', current_usage,
    'limit', 2,
    'reset_at', case when current_usage >= 2 then first_usage + interval '24 hours' else null end
  );
end;
$$;
revoke all on function public.get_ai_document_quota() from public, anon;
grant execute on function public.get_ai_document_quota() to authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleting_user_id uuid := auth.uid();
begin
  if deleting_user_id is null then
    raise exception 'Authentication required';
  end if;

  delete from auth.users where id = deleting_user_id;
  if not found then
    raise exception 'Account not found';
  end if;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

create or replace function public.replace_ai_thread_messages(p_thread_id uuid, p_messages jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.ai_threads where id = p_thread_id and user_id = auth.uid()
  ) then
    raise exception 'Not authorized to update this AI thread';
  end if;

  if jsonb_typeof(p_messages) is distinct from 'array' then
    raise exception 'Messages must be a JSON array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_messages) as item(message)
    where coalesce(item.message ->> 'role', '') not in ('user', 'assistant')
      or jsonb_typeof(item.message -> 'parts') is distinct from 'array'
  ) then
    raise exception 'Each message must have a supported role and parts array';
  end if;

  delete from public.ai_messages where thread_id = p_thread_id;

  insert into public.ai_messages (thread_id, role, parts, created_at)
  select
    p_thread_id,
    item.message ->> 'role',
    item.message -> 'parts',
    transaction_timestamp() + (item.ordinality - 1) * interval '1 millisecond'
  from jsonb_array_elements(p_messages) with ordinality as item(message, ordinality)
  where item.message ->> 'role' in ('user', 'assistant');
end;
$$;
revoke all on function public.replace_ai_thread_messages(uuid, jsonb) from public;
grant execute on function public.replace_ai_thread_messages(uuid, jsonb) to authenticated;

create index if not exists accountants_country_idx on public.accountants(country_code);
create index if not exists accountant_clients_approved_idx on public.accountant_clients(accountant_id, approved_at desc) where status = 'active';
create index if not exists documents_owner_created_idx on public.documents(owner_id, created_at desc);
create index if not exists documents_owner_role_created_idx on public.documents(owner_id, owner_role, created_at desc);
create index if not exists conversations_accountant_updated_idx on public.conversations(accountant_id, updated_at desc);
create index if not exists conversations_taxpayer_updated_idx on public.conversations(taxpayer_id, updated_at desc);
create index if not exists accountant_fee_entries_owner_issued_idx on public.accountant_fee_entries(accountant_id, issued_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists ai_messages_thread_created_idx on public.ai_messages(thread_id, created_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;
create or replace function public.set_accountant_client_approved_at() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'active' then
    if tg_op = 'INSERT' or old.status is distinct from 'active' then
      new.approved_at = coalesce(new.approved_at, now());
    end if;
  else
    new.approved_at = null;
  end if;
  return new;
end
$$;
drop trigger if exists set_accountant_client_approved_at on public.accountant_clients;
create trigger set_accountant_client_approved_at before insert or update of status on public.accountant_clients
  for each row execute function public.set_accountant_client_approved_at();
drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists touch_accountants on public.accountants;
create trigger touch_accountants before update on public.accountants for each row execute function public.touch_updated_at();
drop trigger if exists touch_accountant_fee_entries on public.accountant_fee_entries;
create trigger touch_accountant_fee_entries before update on public.accountant_fee_entries for each row execute function public.touch_updated_at();
drop trigger if exists touch_documents on public.documents;
create trigger touch_documents before update on public.documents for each row execute function public.touch_updated_at();
drop trigger if exists touch_conversations on public.conversations;
create trigger touch_conversations before update on public.conversations for each row execute function public.touch_updated_at();
drop trigger if exists touch_ai_threads on public.ai_threads;
create trigger touch_ai_threads before update on public.ai_threads for each row execute function public.touch_updated_at();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
    ) then
      alter publication supabase_realtime add table public.documents;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'accountant_clients'
    ) then
      alter publication supabase_realtime add table public.accountant_clients;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
    ) then
      alter publication supabase_realtime add table public.conversations;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'accountant_fee_entries'
    ) then
      alter publication supabase_realtime add table public.accountant_fee_entries;
    end if;
  end if;
end $$;

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
    values (NEW.accountant_id, NEW.taxpayer_id, 'relationship_request', 'New taxpayer request',
      'A taxpayer wants to work with you.', 'accountant_client', NEW.id);
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'active' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (NEW.taxpayer_id, NEW.accountant_id, 'relationship_approved', 'Accountant accepted your request',
      'You can now message your accountant and share documents.', 'accountant_client', NEW.id);
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and NEW.status = 'rejected' then
    insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
    values (NEW.taxpayer_id, NEW.accountant_id, 'relationship_rejected', 'Accountant declined your request',
      'You can choose another accountant or send a new request later.', 'accountant_client', NEW.id);
  end if;
  return NEW;
end;
$$;
drop trigger if exists accountant_client_notifications on public.accountant_clients;
create trigger accountant_client_notifications after insert or update of status on public.accountant_clients
  for each row execute function public.notify_accountant_client_change();
drop trigger if exists notify_reopened_client_request on public.accountant_clients;
drop function if exists public.notify_reopened_client_request();

create or replace function public.ensure_conversation_after_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'active' and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status) then
    insert into public.conversations (taxpayer_id, accountant_id)
    values (NEW.taxpayer_id, NEW.accountant_id)
    on conflict (taxpayer_id, accountant_id) do nothing;
  end if;
  return NEW;
end;
$$;
drop trigger if exists ensure_conversation_after_approval on public.accountant_clients;
create trigger ensure_conversation_after_approval after insert or update of status on public.accountant_clients
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
    if NEW.status = 'sent' and (NEW.accountant_id is null
      or not public.active_client_pair(NEW.accountant_id, OLD.owner_id)) then
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
create trigger guard_document_handoff before update on public.documents
  for each row execute function public.guard_document_handoff();

create or replace function public.notify_document_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _recipient uuid;
  _actor uuid;
  _title text;
begin
  if OLD.status is not distinct from NEW.status then return NEW; end if;
  if NEW.status = 'sent' and NEW.accountant_id is not null then
    _recipient := NEW.accountant_id; _actor := NEW.owner_id;
    _title := 'New document to review';
  elsif NEW.status in ('ready', 'returned') and NEW.owner_role = 'taxpayer' then
    _recipient := NEW.owner_id; _actor := NEW.accountant_id;
    _title := case when NEW.status = 'ready' then 'Document accepted' else 'Document returned' end;
  else
    return NEW;
  end if;
  insert into public.notifications (recipient_id, actor_id, kind, title, body, entity_type, entity_id)
  values (_recipient, _actor, 'document', _title, NEW.name, 'document', NEW.id);
  return NEW;
end;
$$;
drop trigger if exists document_status_notifications on public.documents;
create trigger document_status_notifications after update of status on public.documents
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
    auth.uid() = taxpayer_id and status = 'pending' and starts_at > now()
    and exists (
      select 1 from public.accountant_clients ac
      where ac.accountant_id = appointment_requests.accountant_id
        and ac.taxpayer_id = appointment_requests.taxpayer_id and ac.status in ('pending', 'active')
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
create trigger guard_appointment_request_update before insert or update on public.appointment_requests
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
    _recipient := NEW.accountant_id; _actor := NEW.taxpayer_id; _title := 'Appointment requested';
  elsif OLD.status is distinct from NEW.status and NEW.status in ('accepted', 'rejected') then
    _recipient := NEW.taxpayer_id; _actor := NEW.accountant_id;
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
create trigger appointment_request_notifications after insert or update of status on public.appointment_requests
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
