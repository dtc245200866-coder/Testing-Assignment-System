-- Bảng lưu dữ liệu RIÊNG theo từng tài khoản (mỗi user_id một dòng JSON).
-- Yêu cầu: Email provider đã bật trong Authentication (mặc định đã bật).
-- Cách dùng: Supabase Dashboard -> SQL Editor -> New query -> dán -> Run.
-- LƯU Ý: lệnh này XÓA bảng cũ (bản chưa có đăng nhập). Dữ liệu trên cloud cũ sẽ mất;
-- dữ liệu còn trong trình duyệt (localStorage) sẽ tự đồng bộ lại khi bạn đăng nhập.
drop table if exists public.app_data cascade;

create table public.app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);

alter table public.app_data enable row level security;

drop policy if exists "own_read_app_data" on public.app_data;
create policy "own_read_app_data" on public.app_data
  for select using (auth.uid() = user_id);

drop policy if exists "own_insert_app_data" on public.app_data;
create policy "own_insert_app_data" on public.app_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_update_app_data" on public.app_data;
create policy "own_update_app_data" on public.app_data
  for update using (auth.uid() = user_id);

drop policy if exists "own_delete_app_data" on public.app_data;
create policy "own_delete_app_data" on public.app_data
  for delete using (auth.uid() = user_id);
