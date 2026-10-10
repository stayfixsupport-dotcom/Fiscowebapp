create table if not exists public.ai_image_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null default now()
);
create index if not exists ai_image_usage_events_user_time_idx
  on public.ai_image_usage_events (user_id, consumed_at);
alter table public.ai_image_usage_events enable row level security;
revoke all on public.ai_image_usage_events from anon, authenticated;
grant all on public.ai_image_usage_events to service_role;

do $$
begin
  if to_regclass('public.ai_image_daily_usage') is not null then
    execute $migration$
      insert into public.ai_image_usage_events (user_id, consumed_at)
      select usage.user_id, transaction_timestamp()
      from public.ai_image_daily_usage as usage
      cross join lateral generate_series(1, usage.image_count)
      where usage.usage_date = timezone('UTC', transaction_timestamp())::date
    $migration$;
  end if;
end;
$$;

drop table if exists public.ai_image_daily_usage;

create or replace function public.consume_ai_image_daily_quota()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  current_usage integer;
  first_usage timestamptz;
  current_time_utc timestamptz := transaction_timestamp();
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user::text, 0));

  select count(*)::integer, min(consumed_at)
    into current_usage, first_usage
    from public.ai_image_usage_events
    where user_id = requesting_user
      and consumed_at > current_time_utc - interval '24 hours';

  if current_usage >= 2 then
    return jsonb_build_object(
      'allowed', false,
      'used', current_usage,
      'limit', 2,
      'reset_at', first_usage + interval '24 hours'
    );
  end if;

  insert into public.ai_image_usage_events (user_id, consumed_at)
  values (requesting_user, current_time_utc);

  return jsonb_build_object('allowed', true, 'used', current_usage + 1, 'limit', 2);
end;
$$;
revoke all on function public.consume_ai_image_daily_quota() from public, anon;
grant execute on function public.consume_ai_image_daily_quota() to authenticated;

create or replace function public.get_ai_image_quota()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  current_usage integer;
  first_usage timestamptz;
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  select count(*)::integer, min(consumed_at)
    into current_usage, first_usage
    from public.ai_image_usage_events
    where user_id = requesting_user
      and consumed_at > transaction_timestamp() - interval '24 hours';

  return jsonb_build_object(
    'allowed', current_usage < 2,
    'used', current_usage,
    'limit', 2,
    'reset_at', case when current_usage >= 2 then first_usage + interval '24 hours' else null end
  );
end;
$$;
revoke all on function public.get_ai_image_quota() from public, anon;
grant execute on function public.get_ai_image_quota() to authenticated;