# Supabase setup

## Dashboard setup

1. Create a project at https://supabase.com/dashboard.
2. Open **Project Settings -> Data API** and copy the Project URL.
3. Open **Project Settings -> API Keys** and copy a Secret key or legacy `service_role` key.
4. Open **SQL Editor -> New query**, paste `schema.sql`, then click **Run**.
5. Verify that Table Editor contains `recordings` and Storage contains the private `recording-audio` bucket.

The secret/service-role key must stay on the Node server. Never expose it in browser JavaScript or commit it to Git.

## Railway variables

```text
HOST=0.0.0.0
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_OR_SERVICE_ROLE_KEY
SUPABASE_AUDIO_BUCKET=recording-audio
```

The project URL, publishable key and bucket are also committed as safe defaults in `src/config.mjs`. A deployment therefore only requires one secret variable:

```text
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_OR_SERVICE_ROLE_KEY
```

Never commit an `sb_secret_...` or legacy `service_role` value. These keys bypass RLS and have full backend access.

Redeploy and visit `https://YOUR_APP_DOMAIN/api/status`. The expected storage response has `configured: true` and `health.connected`, `health.table`, `health.bucket` all set to `true`.

## Supabase CLI alternative

Use migrations instead of SQL Editor when you want version-controlled database updates:

```powershell
npx supabase login
npx supabase init
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Create later migrations with:

```powershell
npx supabase migration new add_recording_tags
npx supabase db push
```

Do not apply both `schema.sql` and the initial migration to the same new project. Choose one setup path.

## Data flow

1. Hash audio and construct a cache key from hash, model, language and pipeline version.
2. Query `recordings.cache_key` before calling ElevenLabs.
3. Upload audio to the private Storage bucket on a cache miss.
4. Upsert transcript metadata by `cache_key`.
5. Load `/api/recordings?limit=100` when the page opens.
6. Create a one-hour signed URL when a saved recording is opened.

## Local admin commands

Create `.env` from `.env.example`, then run:

```powershell
node --env-file=.env scripts/supabase-admin.mjs status
node --env-file=.env scripts/supabase-admin.mjs list
node --env-file=.env scripts/supabase-admin.mjs get RECORDING_UUID
node --env-file=.env scripts/supabase-admin.mjs stats
```

`queries.sql` contains SQL examples for list, detail, cache lookup, search, statistics, upsert, JSON update and delete.

## Security

The current service-role integration is appropriate for a personal/single-owner app. Before opening it to unrelated users, add Supabase Auth, assign `user_id`, store files under `<user_id>/...`, and rate-limit the API endpoints.
