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
drop policy if exists "accountants manage own fee entries" on public.accountant_fee_entries;
create policy "accountants manage own fee entries" on public.accountant_fee_entries for all to authenticated
  using (auth.uid() = accountant_id)
  with check (auth.uid() = accountant_id and public.has_role(auth.uid(), 'accountant'));

create index if not exists accountant_fee_entries_owner_issued_idx
  on public.accountant_fee_entries(accountant_id, issued_at desc);
drop trigger if exists touch_accountant_fee_entries on public.accountant_fee_entries;
create trigger touch_accountant_fee_entries before update on public.accountant_fee_entries
  for each row execute function public.touch_updated_at();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'accountant_fee_entries'
    ) then
    alter publication supabase_realtime add table public.accountant_fee_entries;
  end if;
end $$;

notify pgrst, 'reload schema';