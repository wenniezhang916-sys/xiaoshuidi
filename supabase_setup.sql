-- 小水滴 v4 Supabase 数据表
-- 在 Supabase 左边 SQL Editor 里粘贴，然后点 Run

create table if not exists public.app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

drop policy if exists "Users can read own app data" on public.app_data;
drop policy if exists "Users can insert own app data" on public.app_data;
drop policy if exists "Users can update own app data" on public.app_data;

create policy "Users can read own app data"
on public.app_data
for select
using (auth.uid() = user_id);

create policy "Users can insert own app data"
on public.app_data
for insert
with check (auth.uid() = user_id);

create policy "Users can update own app data"
on public.app_data
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
