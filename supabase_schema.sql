-- ==========================================================
-- FoodFriends Scanner App - Complete Database Setup & Fix
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run
-- ==========================================================

-- 1. Create Profiles table
create table if not exists public.profiles (
  id uuid primary key,
  email text,
  display_name text not null default 'Explorer',
  age_group text default '7-9',
  points integer default 120,
  streak integer default 3,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Ensure all columns exist in case the table was created partially
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists display_name text default 'Explorer';
alter table public.profiles add column if not exists age_group text default '7-9';
alter table public.profiles add column if not exists points integer default 120;
alter table public.profiles add column if not exists streak integer default 3;
alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists created_at timestamptz default now();

-- 2. Create Food Logs table
create table if not exists public.food_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  food_name text not null,
  food_group text not null,
  score integer not null,
  summary text not null,
  created_at timestamptz default now()
);

-- Ensure user_id can be null (allows admin/guest scans without foreign key error)
alter table public.food_logs alter column user_id drop not null;

-- 3. Turn off Row Level Security (RLS) so the web app can read and write live data
alter table public.profiles disable row level security;
alter table public.food_logs disable row level security;

-- 4. Automatically create a profile when any user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, age_group, points, streak, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'displayName', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'ageGroup', '7-9'),
    120,
    3,
    false
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5. Backfill any existing users from auth.users into profiles
insert into public.profiles (id, email, display_name, age_group, points, streak, is_admin)
select 
  id, 
  email, 
  coalesce(raw_user_meta_data->>'displayName', split_part(email, '@', 1)),
  coalesce(raw_user_meta_data->>'ageGroup', '7-9'),
  120,
  3,
  false
from auth.users
on conflict (id) do nothing;
