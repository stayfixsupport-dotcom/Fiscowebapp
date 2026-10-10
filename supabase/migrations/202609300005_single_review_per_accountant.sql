grant select (service_case_id) on public.accountant_reviews to authenticated;

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