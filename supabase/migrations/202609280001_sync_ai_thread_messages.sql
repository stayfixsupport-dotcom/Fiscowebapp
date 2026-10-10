-- Replace a finished AI transcript atomically so incomplete streaming placeholders cannot block later saves.
create or replace function public.replace_ai_thread_messages(p_thread_id uuid, p_messages jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.ai_threads where id = p_thread_id and user_id = auth.uid()
  ) then
    raise exception 'Not authorized to update this AI thread';
  end if;

  if jsonb_typeof(p_messages) is distinct from 'array' then
    raise exception 'Messages must be a JSON array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_messages) as item(message)
    where coalesce(item.message ->> 'role', '') not in ('user', 'assistant')
      or jsonb_typeof(item.message -> 'parts') is distinct from 'array'
  ) then
    raise exception 'Each message must have a supported role and parts array';
  end if;

  delete from public.ai_messages where thread_id = p_thread_id;

  insert into public.ai_messages (thread_id, role, parts, created_at)
  select
    p_thread_id,
    item.message ->> 'role',
    item.message -> 'parts',
    transaction_timestamp() + (item.ordinality - 1) * interval '1 millisecond'
  from jsonb_array_elements(p_messages) with ordinality as item(message, ordinality)
  where item.message ->> 'role' in ('user', 'assistant');
end;
$$;
revoke all on function public.replace_ai_thread_messages(uuid, jsonb) from public;
grant execute on function public.replace_ai_thread_messages(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
