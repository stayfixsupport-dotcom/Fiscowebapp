-- Restore core profile and human-chat tables if the earlier base migration was incomplete.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  country_code text check (country_code is null or length(country_code) = 2),
  locale text not null default 'fr' check (locale in ('fr', 'ar')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
drop policy if exists "profiles readable by signed in users" on public.profiles;
drop policy if exists "users create own profile" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
create policy "profiles readable by signed in users"
  on public.profiles for select to authenticated using (true);
create policy "users create own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(taxpayer_id, accountant_id)
);
grant select, insert, update on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  is_hybrid boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end
$$;
drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_conversations on public.conversations;
create trigger touch_conversations before update on public.conversations
  for each row execute function public.touch_updated_at();

alter table public.documents
  add column if not exists owner_role public.app_role not null default 'taxpayer';
alter table public.accountant_clients
  add column if not exists approved_at timestamptz;
alter table public.messages
  add column if not exists is_hybrid boolean not null default false;
update public.accountant_clients
set approved_at = created_at
where status = 'active' and approved_at is null;

create or replace function public.set_accountant_client_approved_at()
returns trigger language plpgsql set search_path = public as $$
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
create trigger set_accountant_client_approved_at
  before insert or update of status on public.accountant_clients
  for each row execute function public.set_accountant_client_approved_at();

create index if not exists documents_owner_role_created_idx
  on public.documents(owner_id, owner_role, created_at desc);
create index if not exists accountant_clients_approved_idx
  on public.accountant_clients(accountant_id, approved_at desc)
  where status = 'active';

create or replace function public.active_client_pair(_accountant_id uuid, _taxpayer_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accountant_clients
    where accountant_id = _accountant_id
      and taxpayer_id = _taxpayer_id
      and status = 'active'
  )
$$;
grant execute on function public.active_client_pair(uuid, uuid) to authenticated;

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
create policy "participants manage own conversation settings"
  on public.conversation_user_settings for all to authenticated
  using (
    auth.uid() = user_id and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  )
  with check (
    auth.uid() = user_id and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
        and auth.uid() in (c.accountant_id, c.taxpayer_id)
    )
  );

create or replace function public.can_send_conversation_message(_conversation_id uuid, _sender_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select _sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = _conversation_id
        and auth.uid() in (c.accountant_id, c.taxpayer_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
    and not exists (
      select 1 from public.conversation_user_settings s
      where s.conversation_id = _conversation_id and s.is_blocked
    )
$$;
grant execute on function public.can_send_conversation_message(uuid, uuid) to authenticated;

-- A relationship must be approved by the accountant before documents or chats are shared.
drop policy if exists "relationship participants can read" on public.accountant_clients;
drop policy if exists "taxpayers can request an accountant" on public.accountant_clients;
drop policy if exists "participants can update relationship" on public.accountant_clients;
drop policy if exists "participants can end relationship" on public.accountant_clients;
drop policy if exists "participants end relationships" on public.accountant_clients;
drop policy if exists "accountants approve or end relationships" on public.accountant_clients;
create policy "relationship participants can read"
  on public.accountant_clients for select to authenticated
  using (auth.uid() in (accountant_id, taxpayer_id));
create policy "taxpayers can request an accountant"
  on public.accountant_clients for insert to authenticated
  with check (
    auth.uid() = taxpayer_id
    and public.has_role(auth.uid(), 'taxpayer')
    and status = 'pending'
  );
create policy "accountants approve or end relationships"
  on public.accountant_clients for update to authenticated
  using (auth.uid() = accountant_id or auth.uid() = taxpayer_id)
  with check (
    (auth.uid() = accountant_id and public.has_role(auth.uid(), 'accountant') and status in ('active', 'ended'))
    or (auth.uid() = taxpayer_id and public.has_role(auth.uid(), 'taxpayer') and status in ('pending', 'ended'))
  );
create policy "participants end relationships"
  on public.accountant_clients for delete to authenticated
  using (auth.uid() = taxpayer_id and status = 'pending');
revoke update on public.accountant_clients from authenticated;
grant update (status) on public.accountant_clients to authenticated;

-- Replace broad participant policies with active-relationship checks.
drop policy if exists "conversation participants read" on public.conversations;
drop policy if exists "participants create conversations" on public.conversations;
drop policy if exists "participants update conversations" on public.conversations;
drop policy if exists "active relationship participants read conversations" on public.conversations;
drop policy if exists "active relationship participants create conversations" on public.conversations;
drop policy if exists "active relationship participants update conversations" on public.conversations;
create policy "active relationship participants read conversations"
  on public.conversations for select to authenticated
  using (
    auth.uid() in (taxpayer_id, accountant_id)
    and public.active_client_pair(accountant_id, taxpayer_id)
  );
create policy "active relationship participants create conversations"
  on public.conversations for insert to authenticated
  with check (
    auth.uid() in (taxpayer_id, accountant_id)
    and public.active_client_pair(accountant_id, taxpayer_id)
  );
create policy "active relationship participants update conversations"
  on public.conversations for update to authenticated
  using (
    auth.uid() in (taxpayer_id, accountant_id)
    and public.active_client_pair(accountant_id, taxpayer_id)
  )
  with check (
    auth.uid() in (taxpayer_id, accountant_id)
    and public.active_client_pair(accountant_id, taxpayer_id)
  );

revoke update on public.conversations from authenticated;
grant update (updated_at) on public.conversations to authenticated;

-- Restrictions hide incoming messages for the restricting user; blocks stop both sides sending.
drop policy if exists "participants read messages" on public.messages;
drop policy if exists "participants send messages" on public.messages;
drop policy if exists "participants mark messages read" on public.messages;
drop policy if exists "active relationship participants read messages" on public.messages;
drop policy if exists "active relationship participants send messages" on public.messages;
drop policy if exists "participants mark received messages read" on public.messages;
create policy "active relationship participants read messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
    and (
      sender_id = auth.uid()
      or not exists (
        select 1 from public.conversation_user_settings s
        where s.conversation_id = public.messages.conversation_id
          and s.user_id = auth.uid()
          and s.is_restricted
      )
    )
  );
create policy "active relationship participants send messages"
  on public.messages for insert to authenticated
  with check (public.can_send_conversation_message(conversation_id, sender_id));
create policy "participants mark received messages read"
  on public.messages for update to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  )
  with check (sender_id <> auth.uid());
revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

-- Existing documents were created by the taxpayer workflow and default to that role.
drop policy if exists "owners and assigned accountants read documents" on public.documents;
drop policy if exists "owners create documents" on public.documents;
drop policy if exists "owners and assigned accountants update documents" on public.documents;
drop policy if exists "owners delete documents" on public.documents;
drop policy if exists "owners and approved accountants read documents" on public.documents;
drop policy if exists "owners create role scoped documents" on public.documents;
drop policy if exists "owners and approved accountants update documents" on public.documents;
create policy "owners and approved accountants read documents"
  on public.documents for select to authenticated
  using (
    auth.uid() = owner_id
    or (
      auth.uid() = accountant_id
      and public.active_client_pair(accountant_id, owner_id)
    )
  );
create policy "owners create role scoped documents"
  on public.documents for insert to authenticated
  with check (auth.uid() = owner_id and public.has_role(auth.uid(), owner_role));
create policy "owners and approved accountants update documents"
  on public.documents for update to authenticated
  using (
    auth.uid() = owner_id
    or (auth.uid() = accountant_id and public.active_client_pair(accountant_id, owner_id))
  )
  with check (
    auth.uid() = owner_id
    or (auth.uid() = accountant_id and public.active_client_pair(accountant_id, owner_id))
  );
create policy "owners delete documents"
  on public.documents for delete to authenticated using (auth.uid() = owner_id);
revoke update on public.documents from authenticated;
grant update (accountant_id, status, updated_at) on public.documents to authenticated;

create index if not exists conversations_accountant_updated_idx
  on public.conversations(accountant_id, updated_at desc);
create index if not exists conversations_taxpayer_updated_idx
  on public.conversations(taxpayer_id, updated_at desc);

-- Keep relationship and human-message changes available to realtime clients.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
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
  end if;
end $$;

notify pgrst, 'reload schema';
