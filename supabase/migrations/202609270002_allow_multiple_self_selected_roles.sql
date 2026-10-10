drop policy if exists "users choose initial role" on public.user_roles;
drop policy if exists "users choose own roles" on public.user_roles;

create policy "users choose own roles" on public.user_roles
  for insert to authenticated
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';