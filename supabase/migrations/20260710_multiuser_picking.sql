create extension if not exists "pgcrypto";

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  login_id text not null unique,
  name text not null,
  pin_hash text not null,
  role text not null default 'worker' check (role in ('admin','worker')),
  is_active boolean not null default true,
  assigned_zone text,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.picking_jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_file_name text,
  status text not null default 'active' check (status in ('ready','active','completed','archived')),
  total_items integer not null default 0,
  total_quantity integer not null default 0,
  created_by uuid references public.workers(id),
  memo text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz
);

create table if not exists public.picking_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.picking_jobs(id) on delete cascade,
  sequence integer not null,
  product_name text not null,
  option_name text not null default '단일상품',
  location text not null default '',
  location_sort_1 integer not null default 4999999,
  location_sort_2 integer not null default 999999,
  quantity integer not null default 0,
  status text not null default 'pending' check (status in ('pending','done','problem')),
  problem_reason text,
  problem_memo text,
  assigned_worker_id uuid references public.workers(id),
  completed_by uuid references public.workers(id),
  completed_at timestamptz,
  problem_by uuid references public.workers(id),
  problem_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.picking_jobs(id) on delete cascade,
  item_id uuid references public.picking_items(id) on delete cascade,
  worker_id uuid references public.workers(id),
  action text not null,
  previous_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_picking_items_job_status on public.picking_items(job_id, status);
create index if not exists idx_picking_items_sort on public.picking_items(job_id, location_sort_1, location_sort_2, sequence);
create index if not exists idx_activity_logs_job_created on public.activity_logs(job_id, created_at desc);

alter table public.workers enable row level security;
alter table public.picking_jobs enable row level security;
alter table public.picking_items enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "anon can read jobs for realtime" on public.picking_jobs;
create policy "anon can read jobs for realtime" on public.picking_jobs for select to anon using (true);

drop policy if exists "anon can read items for realtime" on public.picking_items;
create policy "anon can read items for realtime" on public.picking_items for select to anon using (true);

drop policy if exists "anon can read activity for realtime" on public.activity_logs;
create policy "anon can read activity for realtime" on public.activity_logs for select to anon using (true);

drop policy if exists "anon cannot read workers" on public.workers;
create policy "anon cannot read workers" on public.workers for select to anon using (false);

alter publication supabase_realtime add table public.picking_jobs;
alter publication supabase_realtime add table public.picking_items;
alter publication supabase_realtime add table public.activity_logs;
