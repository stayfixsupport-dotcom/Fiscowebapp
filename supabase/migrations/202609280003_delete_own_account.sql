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