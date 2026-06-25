# Deeper Life Bible Church, Ottawa West

A secure attendance, people-care, and reporting app backed by Supabase.

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste all of `supabase-schema.sql`, and run it once.
3. In **Authentication → Users**, create or invite your first user.
4. In SQL Editor, promote that first account:

```sql
update public.profiles
set role = 'admin'
where email = 'your-email@example.com';
```

5. In **Project Settings → API**, copy the Project URL and publishable/anon key into `config.js`.
6. Reload the app and sign in.
7. Open **Team & roles** to assign other users as Administrator, Reporter, or Viewer.
8. Select **Import historical records** once to synchronize the 83 imported service records and the member/visitor roster extracted from the April-June 2026 attendance registers.

Never place a Supabase `service_role` key in `config.js`. Only use the browser-safe publishable/anon key. Database Row Level Security enforces all access.

## Roles

- **Administrator:** full record access, historical import, and team-role management.
- **Reporter:** can submit and update attendance, people, and follow-up records.
- **Viewer:** securely reads dashboards and reports without editing.

## Team accounts

Create or invite team accounts from Supabase **Authentication → Users**. New accounts receive Viewer access by default; an administrator can change their role from inside the app.

## Production hosting

For team use, deploy this folder to a static HTTPS host such as Netlify, Vercel, Cloudflare Pages, or Supabase Hosting. Keep `supabase-schema.sql` outside the publicly deployed folder if your hosting workflow allows it; it contains no secrets, but it is setup material rather than an app asset.
