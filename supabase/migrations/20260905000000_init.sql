-- Loan Ledger schema. Admin-only app: every table is readable/writable only by users
-- listed in public.admins. Rows carry two timestamps:
--   updated_at  set by the client at edit time  -> last-write-wins between devices
--   synced_at   set by the server on every write -> pull cursor for offline sync

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.id_type as enum ('aadhaar', 'pan', 'voter_id', 'driving_licence');
create type public.loan_status as enum ('active', 'closed');
create type public.paid_mode as enum ('cash', 'upi', 'bank', 'other');
create type public.doc_type as enum ('person_photo', 'id_front', 'id_back', 'signed_form', 'other');

-- ---------------------------------------------------------------- tables
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text,
  created_at timestamptz not null default now()
);

create table public.people (
  id          uuid primary key,
  full_name   text not null check (length(trim(full_name)) > 0),
  phone       text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  id_type     public.id_type,
  id_last4    text,
  id_hmac     text,
  address     text,
  occupation  text,
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default now(),
  deleted_at  timestamptz
);
create index people_synced_at on public.people (synced_at);
create index people_id_hmac on public.people (id_hmac) where id_hmac is not null;

-- Encrypted ID numbers live apart from people so the client role never sees the column.
create table public.person_ids (
  person_id     uuid primary key references public.people (id) on delete cascade,
  id_number_enc bytea not null
);

create table public.loans (
  id                 uuid primary key,
  loan_no            text not null,
  borrower_id        uuid not null references public.people (id),
  co_borrower_id     uuid references public.people (id),
  amount             integer not null check (amount > 0),
  loan_date          date not null,
  tenure_months      integer not null check (tenure_months between 1 and 120),
  installment_amount integer not null check (installment_amount > 0),
  total_repayment    integer not null check (total_repayment > 0),
  first_due_date     date not null,
  business_name      text,
  business_address   text,
  business_mobile    text,
  monthly_income     integer,
  ref1_name          text not null,
  ref1_phone         text not null,
  ref1_address       text,
  ref2_name          text not null,
  ref2_phone         text not null,
  ref2_address       text,
  status             public.loan_status not null default 'active',
  settled_on         date,
  notes              text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null,
  synced_at          timestamptz not null default now(),
  deleted_at         timestamptz,
  check (co_borrower_id is distinct from borrower_id)
);
create unique index loans_loan_no on public.loans (loan_no) where deleted_at is null;
create index loans_borrower on public.loans (borrower_id);
create index loans_synced_at on public.loans (synced_at);

create table public.installments (
  id          uuid primary key,
  loan_id     uuid not null references public.loans (id) on delete cascade,
  no          integer not null check (no >= 1),
  due_date    date not null,
  amount_due  integer not null check (amount_due >= 0),
  paid_amount integer not null default 0 check (paid_amount >= 0),
  paid_on     date,
  paid_mode   public.paid_mode,
  note        text,
  marked_by   uuid,
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default now(),
  unique (loan_id, no)
);
create index installments_due on public.installments (due_date);
create index installments_synced_at on public.installments (synced_at);

create table public.documents (
  id           uuid primary key,
  person_id    uuid references public.people (id) on delete cascade,
  loan_id      uuid references public.loans (id) on delete cascade,
  type         public.doc_type not null,
  storage_path text not null,
  sha256       text,
  captured_at  timestamptz not null default now(),
  caption      text,
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null,
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  check ((person_id is null) <> (loan_id is null))
);
create unique index documents_one_per_type on public.documents (person_id, type)
  where type in ('person_photo', 'id_front', 'id_back') and deleted_at is null;
create index documents_person on public.documents (person_id);
create index documents_loan on public.documents (loan_id);
create index documents_synced_at on public.documents (synced_at);

-- Keyed by number: a phone verified once shows a badge wherever it appears.
create table public.phone_verifications (
  phone       text primary key check (phone ~ '^\+91[6-9][0-9]{9}$'),
  verified_at timestamptz not null,
  verified_by uuid default auth.uid(),
  person_id   uuid,
  proof       text,
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default now()
);
create index phone_verifications_synced_at on public.phone_verifications (synced_at);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  old        jsonb,
  new        jsonb,
  at         timestamptz not null default now()
);
create index audit_log_row on public.audit_log (table_name, row_id);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- LWW by client edit time, and stamp the server receipt time.
create or replace function public.touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- an older edit arriving late loses
  end if;
  new.synced_at := now();
  return new;
end $$;

create or replace function public.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, table_name, row_id, action, old, new)
  values (
    auth.uid(), tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id')::uuid,
    tg_op, to_jsonb(old), to_jsonb(new)
  );
  return null;
end $$;

-- Loan status is server-computed: never trusted from the client.
create or replace function public.compute_loan_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.settled_on is not null then
    new.status := 'closed';
  elsif exists (select 1 from public.installments i where i.loan_id = new.id)
    and not exists (select 1 from public.installments i where i.loan_id = new.id and i.paid_amount < i.amount_due) then
    new.status := 'closed';
  else
    new.status := 'active';
  end if;
  return new;
end $$;

create or replace function public.recompute_loan()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.loans set synced_at = now() where id = coalesce(new.loan_id, old.loan_id);
  return null;
end $$;

-- The first user ever created becomes the admin; later admins are added by an admin.
create or replace function public.bootstrap_first_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id, name) values (new.id, new.email);
  end if;
  return new;
end $$;

create or replace function public.add_admin(p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.admins (user_id, name)
  select id, email from auth.users where lower(email) = lower(trim(p_email))
  on conflict (user_id) do nothing;
  return found;
end $$;

-- Upsert a person; the ID number (if present in the payload) is encrypted with a
-- Vault-held key. Send "id_number": "" to clear it; omit the key to leave it untouched.
create or replace function public.upsert_person(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid := (p ->> 'id')::uuid;
  v_num   text := nullif(trim(p ->> 'id_number'), '');
  v_key   text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.people (id, full_name, phone, id_type, address, occupation, notes, updated_at, deleted_at)
  values (
    v_id, p ->> 'full_name', p ->> 'phone', (p ->> 'id_type')::public.id_type,
    p ->> 'address', p ->> 'occupation', p ->> 'notes',
    (p ->> 'updated_at')::timestamptz, (p ->> 'deleted_at')::timestamptz
  )
  on conflict (id) do update set
    full_name = excluded.full_name, phone = excluded.phone, id_type = excluded.id_type,
    address = excluded.address, occupation = excluded.occupation, notes = excluded.notes,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
  where public.people.updated_at <= excluded.updated_at;

  if not found or not (p ? 'id_number') then
    return;
  end if;

  if v_num is null then
    delete from public.person_ids where person_id = v_id;
    update public.people set id_last4 = null, id_hmac = null where id = v_id;
    return;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'id_number_key';
  insert into public.person_ids (person_id, id_number_enc)
  values (v_id, extensions.pgp_sym_encrypt(v_num, v_key))
  on conflict (person_id) do update set id_number_enc = excluded.id_number_enc;
  update public.people
     set id_last4 = right(v_num, 4),
         id_hmac  = encode(extensions.hmac(v_num, v_key, 'sha256'), 'hex')
   where id = v_id;
end $$;

create or replace function public.reveal_id(p_person_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_num text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'id_number_key';
  select extensions.pgp_sym_decrypt(id_number_enc, v_key) into v_num
    from public.person_ids where person_id = p_person_id;
  insert into public.audit_log (actor_id, table_name, row_id, action)
  values (auth.uid(), 'people', p_person_id, 'reveal_id');
  return v_num;
end $$;

-- ---------------------------------------------------------------- triggers
create trigger people_touch before insert or update on public.people
  for each row execute function public.touch();
create trigger loans_touch before insert or update on public.loans
  for each row execute function public.touch();
create trigger loans_status before insert or update on public.loans
  for each row execute function public.compute_loan_status();
create trigger installments_touch before insert or update on public.installments
  for each row execute function public.touch();
create trigger installments_recompute_loan after insert or update or delete on public.installments
  for each row execute function public.recompute_loan();
create trigger documents_touch before insert or update on public.documents
  for each row execute function public.touch();
create trigger phone_verifications_touch before insert or update on public.phone_verifications
  for each row execute function public.touch();

create trigger people_audit after insert or update or delete on public.people
  for each row execute function public.audit();
create trigger loans_audit after insert or update or delete on public.loans
  for each row execute function public.audit();
create trigger installments_audit after insert or update or delete on public.installments
  for each row execute function public.audit();
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function public.audit();

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.bootstrap_first_admin();

-- ---------------------------------------------------------------- privileges & RLS
revoke all on public.person_ids from anon, authenticated;
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;
revoke all on public.admins from anon;
revoke insert, update, delete on public.admins from authenticated;

revoke execute on function public.upsert_person(jsonb) from public, anon;
revoke execute on function public.reveal_id(uuid) from public, anon;
revoke execute on function public.add_admin(text) from public, anon;

alter table public.admins enable row level security;
alter table public.people enable row level security;
alter table public.person_ids enable row level security;
alter table public.loans enable row level security;
alter table public.installments enable row level security;
alter table public.documents enable row level security;
alter table public.phone_verifications enable row level security;
alter table public.audit_log enable row level security;

create policy admins_read on public.admins for select to authenticated using (public.is_admin());
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());
create policy people_admin on public.people for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy loans_admin on public.loans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy installments_admin on public.installments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy documents_admin on public.documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy phone_verifications_admin on public.phone_verifications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- person_ids: RLS on, no policies, no grants -> reachable only through the functions above.

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy docs_admin on storage.objects for all to authenticated
  using (bucket_id = 'docs' and public.is_admin())
  with check (bucket_id = 'docs' and public.is_admin());

-- ---------------------------------------------------------------- secrets
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'id_number_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'id_number_key',
                                'Symmetric key for people.id_number (pgp_sym_encrypt)');
  end if;
end $$;
