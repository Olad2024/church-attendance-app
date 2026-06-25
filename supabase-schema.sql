-- Deeper Life Bible Church, Ottawa West
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'reporter', 'viewer');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  service_type text not null,
  topic text not null default '',
  speaker text not null default '',
  men integer not null default 0 check (men >= 0),
  women integer not null default 0 check (women >= 0),
  youth integer not null default 0 check (youth >= 0),
  children integer not null default 0 check (children >= 0),
  campus integer not null default 0 check (campus >= 0),
  visitors integer not null default 0 check (visitors >= 0),
  offering numeric(12,2) not null default 0 check (offering >= 0),
  end_time time,
  notes text not null default '',
  source text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_date, service_type, topic)
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  person_type text not null check (person_type in ('Member', 'Visitor')),
  group_name text not null check (group_name in ('Men', 'Women', 'Youth', 'Children', 'Campus')),
  phone text not null default '',
  email text not null default '',
  last_seen date,
  connection_status text not null default 'Connected' check (connection_status in ('Connected', 'Follow-up')),
  notes text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.people add constraint people_full_name_unique unique (full_name);
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists services_updated_at on public.services;
create trigger services_updated_at before update on public.services
for each row execute function public.set_updated_at();
drop trigger if exists people_updated_at on public.people;
create trigger people_updated_at before update on public.people
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid();
$$;

grant usage on schema public to authenticated;
grant select on public.profiles, public.services, public.people to authenticated;
grant insert, update on public.services, public.people to authenticated;
grant delete on public.services, public.people to authenticated;
grant update(role) on public.profiles to authenticated;
grant execute on function public.current_user_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.people enable row level security;

drop policy if exists "profiles_read_self_or_admin" on public.profiles;
create policy "profiles_read_self_or_admin" on public.profiles for select to authenticated
using (id = auth.uid() or public.current_user_role() = 'admin');
drop policy if exists "profiles_admin_updates_roles" on public.profiles;
create policy "profiles_admin_updates_roles" on public.profiles for update to authenticated
using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

drop policy if exists "services_team_read" on public.services;
create policy "services_team_read" on public.services for select to authenticated using (true);
drop policy if exists "services_reporter_insert" on public.services;
create policy "services_reporter_insert" on public.services for insert to authenticated
with check (public.current_user_role() in ('admin','reporter') and created_by = auth.uid());
drop policy if exists "services_reporter_update" on public.services;
create policy "services_reporter_update" on public.services for update to authenticated
using (public.current_user_role() in ('admin','reporter'))
with check (public.current_user_role() in ('admin','reporter'));
drop policy if exists "services_admin_delete" on public.services;
create policy "services_admin_delete" on public.services for delete to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "people_team_read" on public.people;
create policy "people_team_read" on public.people for select to authenticated using (true);
drop policy if exists "people_reporter_insert" on public.people;
create policy "people_reporter_insert" on public.people for insert to authenticated
with check (public.current_user_role() in ('admin','reporter') and created_by = auth.uid());
drop policy if exists "people_reporter_update" on public.people;
create policy "people_reporter_update" on public.people for update to authenticated
using (public.current_user_role() in ('admin','reporter'))
with check (public.current_user_role() in ('admin','reporter'));
drop policy if exists "people_admin_delete" on public.people;
create policy "people_admin_delete" on public.people for delete to authenticated
using (public.current_user_role() = 'admin');

-- After creating your first Auth user, promote that account once:
-- update public.profiles set role = 'admin' where email = 'your-email@example.com';
