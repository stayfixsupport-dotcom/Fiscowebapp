drop policy if exists "accountants read active client profiles" on public.taxpayer_profiles;
create policy "accountants read active client profiles" on public.taxpayer_profiles for select to authenticated
  using (public.active_client_pair(auth.uid(), id));