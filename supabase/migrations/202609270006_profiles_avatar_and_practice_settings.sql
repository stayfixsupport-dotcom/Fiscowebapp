create table if not exists public.taxpayer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  country_code text check (country_code is null or length(country_code) = 2),
  business_type text,
  tax_residency text,
  annual_turnover text,
  goals text[] not null default '{}',
  document_types text[] not null default '{}',
  notes text not null default '',
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.taxpayer_profiles to authenticated;
grant all on public.taxpayer_profiles to service_role;
alter table public.taxpayer_profiles enable row level security;
drop policy if exists "taxpayers manage own profile" on public.taxpayer_profiles;
create policy "taxpayers manage own profile" on public.taxpayer_profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

alter table public.accountants
  add column if not exists address text,
  add column if not exists is_listed boolean not null default false,
  add column if not exists currency_code text not null default 'EUR',
  add column if not exists price numeric(12,2) not null default 0,
  add column if not exists pricing text not null default 'Per filing',
  add column if not exists free_intro boolean not null default false,
  add column if not exists days text[] not null default '{}',
  add column if not exists slots text[] not null default '{}',
  add column if not exists slot_minutes integer not null default 45,
  add column if not exists holiday boolean not null default false,
  add column if not exists holiday_until date,
  add column if not exists auto_accept boolean not null default false,
  add column if not exists remote boolean not null default true,
  add column if not exists home_visits boolean not null default false,
  add column if not exists max_clients integer not null default 25,
  add column if not exists response_hours integer not null default 24,
  add column if not exists website_url text,
  add column if not exists booking_url text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accountants_currency_code_check') then
    alter table public.accountants add constraint accountants_currency_code_check check (currency_code ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accountants_price_check') then
    alter table public.accountants add constraint accountants_price_check check (price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accountants_pricing_check') then
    alter table public.accountants add constraint accountants_pricing_check check (pricing in ('Per hour', 'Per filing', 'Monthly retainer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accountants_slot_minutes_check') then
    alter table public.accountants add constraint accountants_slot_minutes_check check (slot_minutes between 15 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accountants_max_clients_check') then
    alter table public.accountants add constraint accountants_max_clients_check check (max_clients between 1 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accountants_response_hours_check') then
    alter table public.accountants add constraint accountants_response_hours_check check (response_hours between 1 and 168);
  end if;
end $$;

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