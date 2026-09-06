-- A person can hold several ID proofs (Aadhaar, PAN, Voter ID, DL). Each is its own row with
-- its own front/back photos. The number itself stays encrypted in a table the client role
-- cannot read; the client sees the type and the last 4 digits only.

create table public.id_proofs (
  id         uuid primary key,
  person_id  uuid not null references public.people (id) on delete cascade,
  id_type    public.id_type not null,
  id_last4   text,
  id_hmac    text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  synced_at  timestamptz not null default now(),
  deleted_at timestamptz
);
create index id_proofs_person on public.id_proofs (person_id);
create index id_proofs_synced_at on public.id_proofs (synced_at);
create index id_proofs_hmac on public.id_proofs (id_hmac) where id_hmac is not null;

create table public.id_proof_secrets (
  id_proof_id   uuid primary key references public.id_proofs (id) on delete cascade,
  id_number_enc bytea not null
);

-- ID photos hang off the proof, not the person.
alter table public.documents
  add column id_proof_id uuid references public.id_proofs (id) on delete cascade;
create index documents_id_proof on public.documents (id_proof_id);

-- Carry over the single ID each person had so far.
insert into public.id_proofs (id, person_id, id_type, id_last4, id_hmac, updated_at, deleted_at)
select gen_random_uuid(), id, id_type, id_last4, id_hmac, updated_at, deleted_at
  from public.people
 where id_type is not null;
insert into public.id_proof_secrets (id_proof_id, id_number_enc)
select ip.id, pi.id_number_enc
  from public.person_ids pi
  join public.id_proofs ip on ip.person_id = pi.person_id;
update public.documents d
   set id_proof_id = ip.id
  from public.id_proofs ip
 where d.person_id = ip.person_id
   and d.type in ('id_front', 'id_back')
   and d.id_proof_id is null;
delete from public.documents where type in ('id_front', 'id_back') and id_proof_id is null;

drop index if exists public.documents_one_per_type;
create unique index documents_person_photo on public.documents (person_id)
  where type = 'person_photo' and deleted_at is null;
create unique index documents_id_side on public.documents (id_proof_id, type)
  where type in ('id_front', 'id_back') and deleted_at is null;
alter table public.documents add constraint documents_id_side_has_proof
  check (type not in ('id_front', 'id_back') or id_proof_id is not null);

drop table public.person_ids;
alter table public.people
  drop column id_type,
  drop column id_last4,
  drop column id_hmac;

-- ---------------------------------------------------------------- functions
create or replace function public.upsert_person(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.people (id, full_name, phone, address, occupation, notes, updated_at, deleted_at)
  values (
    (p ->> 'id')::uuid, p ->> 'full_name', p ->> 'phone',
    p ->> 'address', p ->> 'occupation', p ->> 'notes',
    (p ->> 'updated_at')::timestamptz, (p ->> 'deleted_at')::timestamptz
  )
  on conflict (id) do update set
    full_name = excluded.full_name, phone = excluded.phone,
    address = excluded.address, occupation = excluded.occupation, notes = excluded.notes,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
  where public.people.updated_at <= excluded.updated_at;
end $$;

-- Upsert one ID proof. "id_number" in the payload (non-empty) is encrypted with the Vault key;
-- an empty string clears it; an absent key leaves it untouched. A soft delete drops the secret.
create or replace function public.upsert_id_proof(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id  uuid := (p ->> 'id')::uuid;
  v_num text := nullif(trim(p ->> 'id_number'), '');
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.id_proofs (id, person_id, id_type, updated_at, deleted_at)
  values (
    v_id, (p ->> 'person_id')::uuid, (p ->> 'id_type')::public.id_type,
    (p ->> 'updated_at')::timestamptz, (p ->> 'deleted_at')::timestamptz
  )
  on conflict (id) do update set
    id_type = excluded.id_type, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
  where public.id_proofs.updated_at <= excluded.updated_at;

  if not found then
    return;
  end if;

  if (p ->> 'deleted_at') is not null or (p ? 'id_number' and v_num is null) then
    delete from public.id_proof_secrets where id_proof_id = v_id;
    update public.id_proofs set id_last4 = null, id_hmac = null where id = v_id;
    return;
  end if;

  if v_num is null then
    return;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'id_number_key';
  insert into public.id_proof_secrets (id_proof_id, id_number_enc)
  values (v_id, extensions.pgp_sym_encrypt(v_num, v_key))
  on conflict (id_proof_id) do update set id_number_enc = excluded.id_number_enc;
  update public.id_proofs
     set id_last4 = right(v_num, 4),
         id_hmac  = encode(extensions.hmac(v_num, v_key, 'sha256'), 'hex')
   where id = v_id;
end $$;

drop function public.reveal_id(uuid);
create function public.reveal_id(p_id_proof_id uuid)
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
    from public.id_proof_secrets where id_proof_id = p_id_proof_id;
  insert into public.audit_log (actor_id, table_name, row_id, action)
  values (auth.uid(), 'id_proofs', p_id_proof_id, 'reveal_id');
  return v_num;
end $$;

-- ---------------------------------------------------------------- triggers, privileges, RLS
create trigger id_proofs_touch before insert or update on public.id_proofs
  for each row execute function public.touch();
create trigger id_proofs_audit after insert or update or delete on public.id_proofs
  for each row execute function public.audit();

revoke all on public.id_proof_secrets from anon, authenticated;
revoke execute on function public.upsert_id_proof(jsonb) from public, anon;
revoke execute on function public.reveal_id(uuid) from public, anon;

alter table public.id_proofs enable row level security;
alter table public.id_proof_secrets enable row level security;
create policy id_proofs_admin on public.id_proofs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- id_proof_secrets: RLS on, no policies, no grants -> reachable only through the functions above.
