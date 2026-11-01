-- Depenses privees, eventuellement rattachees a un voyage.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  trip_id uuid references public.trips (id) on delete set null,
  merchant text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'EUR',
  spent_at timestamptz not null default now(),
  category text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, spent_at desc);
alter table public.expenses enable row level security;

drop policy if exists "expenses: les siennes" on public.expenses;
create policy "expenses: les siennes"
  on public.expenses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
