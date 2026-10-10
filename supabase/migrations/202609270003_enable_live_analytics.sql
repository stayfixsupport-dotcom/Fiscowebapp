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
  end if;
end $$;