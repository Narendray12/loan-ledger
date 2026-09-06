#!/usr/bin/env node
/*
 * Create an admin login for the app (or reset the password of an existing one).
 *
 *   npm run admin:create
 *
 * Prompts for email, display name and password (typed blind), then:
 *   1. inserts a confirmed email/password user into auth.users (+ auth.identities),
 *   2. adds the user to public.admins,
 *   3. signs in through the real auth API to prove the login works.
 * Reads SUPABASE_DB_URL, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env.
 * Safe to re-run: an existing email only gets its password and name updated.
 */
const fs = require('fs')
const readline = require('readline')
const { Client } = require('pg')

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1).replace(/^"(.*)"$/, '$1')]
    }),
)

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write('\n')
      rl.close()
      resolve(answer.trim())
    })
    // After the prompt is printed, swallow the echo of every keystroke (like `sudo`).
    if (hidden) rl._writeToOutput = () => {}
  })
}

async function main() {
  if (!env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is missing from .env')
  const email = (await ask('Email: ')).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That is not an email address')
  const name = (await ask('Display name shown in the app: ')) || email
  const password = await ask('Password (typed blind, at least 8 characters): ', { hidden: true })
  if (password.length < 8) throw new Error('Use at least 8 characters, this app holds ID numbers')
  if ((await ask('Password again: ', { hidden: true })) !== password)
    throw new Error('Passwords did not match')

  const db = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  })
  await db.connect()
  try {
    await db.query('begin')
    const existing = await db.query('select id from auth.users where email = $1', [email])
    let userId
    if (existing.rows.length) {
      userId = existing.rows[0].id
      await db.query(
        `update auth.users
            set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
                email_confirmed_at = coalesce(email_confirmed_at, now()),
                updated_at = now()
          where id = $1`,
        [userId, password],
      )
      console.log('User already existed: password updated.')
    } else {
      const inserted = await db.query(
        `insert into auth.users (
           instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change_token_new, email_change
         ) values (
           '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
           $1, extensions.crypt($2, extensions.gen_salt('bf')), now(),
           '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
         ) returning id`,
        [email, password],
      )
      userId = inserted.rows[0].id
      await db.query(
        `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values (gen_random_uuid(), $1, $3::text,
                 jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true),
                 'email', now(), now(), now())`,
        [userId, email, String(userId)],
      )
      console.log('User created.')
    }
    await db.query(
      'insert into public.admins (user_id, name) values ($1, $2) on conflict (user_id) do update set name = excluded.name',
      [userId, name],
    )
    await db.query('commit')
    console.log(`Admin ready: ${email}`)
  } catch (e) {
    await db.query('rollback')
    throw e
  } finally {
    await db.end()
  }

  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = env
  if (!url || !key || key.startsWith('PASTE'))
    return console.log('Skipped sign-in test: anon key not set in .env')
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json().catch(() => ({}))
  console.log(
    res.ok
      ? 'Sign-in test passed. Open the app and log in with these details.'
      : `Sign-in test FAILED: ${body.error_description || body.msg || res.status}`,
  )
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
