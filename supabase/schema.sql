-- À exécuter plus tard dans Supabase quand on branche la synchronisation.
-- V1 locale : aucun serveur n'est nécessaire.

create table if not exists public.work_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  arrival_ts timestamptz,
  updated_at timestamptz not null default now(),
  unique(user_id, work_date)
);

create table if not exists public.work_pauses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_day_id uuid not null references public.work_days(id) on delete cascade,
  start_ts timestamptz not null,
  end_ts timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.work_days enable row level security;
alter table public.work_pauses enable row level security;

create policy "users_manage_own_days"
on public.work_days for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users_manage_own_pauses"
on public.work_pauses for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);