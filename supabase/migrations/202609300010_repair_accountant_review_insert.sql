alter table public.accountant_reviews alter column service_case_id drop not null;
alter table public.accountant_reviews
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

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