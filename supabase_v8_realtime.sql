-- 小水滴 v8：实时自习室
create table if not exists public.study_rooms (
  room_code text primary key,
  room_name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_participants (
  room_code text references public.study_rooms(room_code) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null default '朋友',
  avatar text not null default '💧',
  study_what text default '',
  is_studying boolean not null default false,
  started_at timestamptz,
  total_seconds integer not null default 0,
  today_key date not null default current_date,
  last_seen timestamptz not null default now(),
  primary key (room_code, user_id)
);

alter table public.study_rooms enable row level security;
alter table public.room_participants enable row level security;

drop policy if exists "room read all authenticated" on public.study_rooms;
drop policy if exists "room insert authenticated" on public.study_rooms;
drop policy if exists "room update creator" on public.study_rooms;
create policy "room read all authenticated" on public.study_rooms for select to authenticated using (true);
create policy "room insert authenticated" on public.study_rooms for insert to authenticated with check (auth.uid() = created_by);
create policy "room update creator" on public.study_rooms for update to authenticated using (auth.uid() = created_by) with check (auth.uid() = created_by);

drop policy if exists "participants read authenticated" on public.room_participants;
drop policy if exists "participants insert self" on public.room_participants;
drop policy if exists "participants update self" on public.room_participants;
drop policy if exists "participants delete self" on public.room_participants;
create policy "participants read authenticated" on public.room_participants for select to authenticated using (true);
create policy "participants insert self" on public.room_participants for insert to authenticated with check (auth.uid() = user_id);
create policy "participants update self" on public.room_participants for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "participants delete self" on public.room_participants for delete to authenticated using (auth.uid() = user_id);

alter publication supabase_realtime add table public.room_participants;
