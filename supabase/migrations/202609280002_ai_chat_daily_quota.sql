create table if not exists public.ai_chat_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  message_count integer not null default 0 check (message_count between 0 and 2),
  primary key (user_id, usage_date)
);
alter table public.ai_chat_daily_usage enable row level security;
revoke all on public.ai_chat_daily_usage from anon, authenticated;
grant all on public.ai_chat_daily_usage to service_role;

create or replace function public.consume_ai_chat_daily_quota()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  current_usage integer;
  utc_day date := timezone('UTC', transaction_timestamp())::date;
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  insert into public.ai_chat_daily_usage (user_id, usage_date, message_count)
  values (requesting_user, utc_day, 1)
  on conflict (user_id, usage_date) do update
    set message_count = public.ai_chat_daily_usage.message_count + 1
    where public.ai_chat_daily_usage.message_count < 2
  returning message_count into current_usage;

  if current_usage is null then
    select message_count into current_usage
    from public.ai_chat_daily_usage
    where user_id = requesting_user and usage_date = utc_day;
    return jsonb_build_object('allowed', false, 'used', current_usage, 'limit', 2);
  end if;

  return jsonb_build_object('allowed', true, 'used', current_usage, 'limit', 2);
end;
$$;
revoke all on function public.consume_ai_chat_daily_quota() from public, anon;
grant execute on function public.consume_ai_chat_daily_quota() to authenticated;