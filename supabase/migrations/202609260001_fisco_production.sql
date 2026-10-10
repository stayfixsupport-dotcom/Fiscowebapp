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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by signed in users" on public.profiles for select to authenticated using (true);
create policy "users create own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

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
create policy "users choose initial role" on public.user_roles for insert to authenticated with check (
  auth.uid() = user_id and not exists (select 1 from public.user_roles existing where existing.user_id = auth.uid())
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
  latitude double precision,
  longitude double precision,
  specialties text[] not null default '{}',
  languages text[] not null default '{}',
  rating numeric(2,1) check (rating is null or rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  verified boolean not null default false,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.accountants to anon, authenticated;
grant insert, update, delete on public.accountants to authenticated;
grant all on public.accountants to service_role;
alter table public.accountants enable row level security;
create policy "accountants are publicly readable" on public.accountants for select to anon, authenticated using (true);
create policy "accountants create own listing" on public.accountants for insert to authenticated with check (auth.uid() = id and public.has_role(auth.uid(), 'accountant'));
create policy "accountants update own listing" on public.accountants for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "accountants delete own listing" on public.accountants for delete to authenticated using (auth.uid() = id);

create table if not exists public.accountant_clients (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.accountants(id) on delete cascade,
  taxpayer_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','ended')),
  created_at timestamptz not null default now(),
  unique(accountant_id, taxpayer_id)
);
grant select, insert, update, delete on public.accountant_clients to authenticated;
grant all on public.accountant_clients to service_role;
alter table public.accountant_clients enable row level security;
create policy "relationship participants can read" on public.accountant_clients for select to authenticated using (auth.uid() in (accountant_id, taxpayer_id));
create policy "taxpayers can request an accountant" on public.accountant_clients for insert to authenticated with check (auth.uid() = taxpayer_id);
create policy "participants can update relationship" on public.accountant_clients for update to authenticated using (auth.uid() in (accountant_id, taxpayer_id)) with check (auth.uid() in (accountant_id, taxpayer_id));
create policy "participants can end relationship" on public.accountant_clients for delete to authenticated using (auth.uid() in (accountant_id, taxpayer_id));

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
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
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create policy "owners and assigned accountants read documents" on public.documents for select to authenticated using (auth.uid() = owner_id or auth.uid() = accountant_id);
create policy "owners create documents" on public.documents for insert to authenticated with check (auth.uid() = owner_id);
create policy "owners and assigned accountants update documents" on public.documents for update to authenticated using (auth.uid() = owner_id or auth.uid() = accountant_id) with check (auth.uid() = owner_id or auth.uid() = accountant_id);
create policy "owners delete documents" on public.documents for delete to authenticated using (auth.uid() = owner_id);

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
create policy "conversation participants read" on public.conversations for select to authenticated using (auth.uid() in (taxpayer_id, accountant_id));
create policy "participants create conversations" on public.conversations for insert to authenticated with check (auth.uid() in (taxpayer_id, accountant_id));
create policy "participants update conversations" on public.conversations for update to authenticated using (auth.uid() in (taxpayer_id, accountant_id)) with check (auth.uid() in (taxpayer_id, accountant_id));

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "participants read messages" on public.messages for select to authenticated using (exists(select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.taxpayer_id, c.accountant_id)));
create policy "participants send messages" on public.messages for insert to authenticated with check (auth.uid() = sender_id and exists(select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.taxpayer_id, c.accountant_id)));
create policy "participants mark messages read" on public.messages for update to authenticated using (exists(select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.taxpayer_id, c.accountant_id)));

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

create index if not exists accountants_country_idx on public.accountants(country_code);
create index if not exists documents_owner_created_idx on public.documents(owner_id, created_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists ai_messages_thread_created_idx on public.ai_messages(thread_id, created_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists touch_accountants on public.accountants;
create trigger touch_accountants before update on public.accountants for each row execute function public.touch_updated_at();
drop trigger if exists touch_documents on public.documents;
create trigger touch_documents before update on public.documents for each row execute function public.touch_updated_at();
drop trigger if exists touch_conversations on public.conversations;
create trigger touch_conversations before update on public.conversations for each row execute function public.touch_updated_at();
drop trigger if exists touch_ai_threads on public.ai_threads;
create trigger touch_ai_threads before update on public.ai_threads for each row execute function public.touch_updated_at();
