alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists forwarded_from_message_id uuid
    references public.messages(id) on delete set null;

revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;
grant update (body, edited_at) on public.messages to authenticated;
drop policy if exists "senders edit own messages" on public.messages;
create policy "senders edit own messages" on public.messages for update to authenticated
  using (
    sender_id = auth.uid() and exists (
      select 1 from public.conversations c where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  )
  with check (
    sender_id = auth.uid() and length(btrim(body)) > 0 and exists (
      select 1 from public.conversations c where c.id = conversation_id
        and auth.uid() in (c.taxpayer_id, c.accountant_id)
        and public.active_client_pair(c.accountant_id, c.taxpayer_id)
    )
  );