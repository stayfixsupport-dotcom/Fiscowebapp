-- Restore the RLS-protected AI conversation tables used by the chat page.
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
drop policy if exists "users own ai threads" on public.ai_threads;
create policy "users own ai threads" on public.ai_threads
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
drop policy if exists "users own ai messages" on public.ai_messages;
create policy "users own ai messages" on public.ai_messages
  for all to authenticated
  using (exists (select 1 from public.ai_threads t where t.id = thread_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_threads t where t.id = thread_id and t.user_id = auth.uid()));

create index if not exists ai_messages_thread_created_idx
  on public.ai_messages(thread_id, created_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end
$$;
drop trigger if exists touch_ai_threads on public.ai_threads;
create trigger touch_ai_threads before update on public.ai_threads
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';