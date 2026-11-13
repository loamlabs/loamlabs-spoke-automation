-- ORDER SHEET saved copy (PR 2). NOT RUN YET: Jerry runs this once in the Supabase SQL editor of the SAME project as the abandoned-build history, BEFORE turning ORDER_SHEET_SAVE on.
-- Safe to run twice (IF NOT EXISTS / OR REPLACE / ON CONFLICT). Nothing here changes or deletes any existing table.
-- What is stored: the order sheet JSON (wheels, lengths, per-spoke list, warnings, I9 list, redraw data) and a list of its stored PNG images. NO customer name, email, address, phone or note:
-- the sheet is built from a whitelist (see _lib/order-sheet.js) and the webhook saves nothing else of the order.
--
-- Retention (change the two numbers here if you want shorter): PNG images 12 months, sheet JSON 24 months. Both dates are written on every row (images_expire_at, expires_at);
-- scripts/order-sheet-cleanup.mjs deletes what has expired (see the report: run it by hand, for example once a month; dry run first).

create table if not exists public.order_sheets (
  id                 bigserial primary key,
  shop               text        not null,                -- the store, e.g. 'e6f6c8-2' (first part of SHOPIFY_STORE_DOMAIN)
  order_number       text        not null,                -- '1466'
  kind               text        not null,                -- 'system' | 'standard'
  numbering_version  integer     not null,
  sheet              jsonb       not null,
  images             jsonb       not null default '[]'::jsonb,   -- [{ wheel, view, path, bytes, caption }] : the PNGs in the private bucket 'order-sheet-images'
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  images_expire_at   timestamptz not null default (now() + interval '12 months'),
  expires_at         timestamptz not null default (now() + interval '24 months'),
  unique (shop, order_number)                             -- one row per order: a repeated delivery overwrites it
);

create index if not exists order_sheets_expires_idx on public.order_sheets (expires_at);
create index if not exists order_sheets_images_expires_idx on public.order_sheets (images_expire_at);

-- only the service role (server side) reads or writes it: row level security on, no policies
alter table public.order_sheets enable row level security;

-- The webhook calls this: insert, or overwrite the same order (created_at stays, the expiry dates restart).
create or replace function public.save_order_sheet(
  p_shop text, p_order_number text, p_kind text, p_numbering_version integer, p_sheet jsonb, p_images jsonb default '[]'::jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.order_sheets (shop, order_number, kind, numbering_version, sheet, images, images_expire_at, expires_at)
  values (p_shop, p_order_number, p_kind, p_numbering_version, p_sheet, coalesce(p_images, '[]'::jsonb), now() + interval '12 months', now() + interval '24 months')
  on conflict (shop, order_number) do update set
    kind = excluded.kind, numbering_version = excluded.numbering_version, sheet = excluded.sheet, images = excluded.images,
    updated_at = now(), images_expire_at = excluded.images_expire_at, expires_at = excluded.expires_at;
$$;

revoke all on function public.save_order_sheet(text, text, text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_order_sheet(text, text, text, integer, jsonb, jsonb) to service_role;

-- The PRIVATE bucket for the PNGs (public = false: nobody can open a picture without the service key).
insert into storage.buckets (id, name, public) values ('order-sheet-images', 'order-sheet-images', false) on conflict (id) do nothing;
