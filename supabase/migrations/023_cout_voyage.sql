-- 023 : cout du voyage. Budget optionnel par voyage, et dépenses d'un voyage
-- lisibles par ses membres (chacun ne modifie que les siennes).
alter table public.trips add column if not exists budget numeric(12,2);
alter table public.trips add column if not exists budget_currency text not null default 'EUR';

drop policy if exists "expenses: voyage partage" on public.expenses;
create policy "expenses: voyage partage"
  on public.expenses for select
  using (trip_id is not null and public.is_trip_member(trip_id));

notify pgrst, 'reload schema';
