-- LOCAL DEVELOPMENT ONLY. Creates admin@example.com / password123 and makes it the admin
-- (via the bootstrap_first_admin trigger). On the hosted project create the user from
-- Authentication → Users instead; the first user created becomes the admin the same way.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'admin@example.com', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
);
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email),
       'email', now(), now(), now()
from auth.users where email = 'admin@example.com';
