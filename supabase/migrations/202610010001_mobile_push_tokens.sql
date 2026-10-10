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
