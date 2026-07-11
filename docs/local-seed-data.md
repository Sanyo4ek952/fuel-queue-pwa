# Local Seed Data

Run these commands against the local Supabase database:

```bash
npx supabase db query --local --file supabase/local-dev-users.sql
npx supabase db query --local --file supabase/local-queue-250.sql
```

Password for every local test account: `password123`.

Staff accounts:

```text
mayor@example.local
station-manager@example.local
station-manager-2@example.local
cashier@example.local
cashier-2@example.local
mayor-assistant@example.local
pending-cashier@example.local
rejected-cashier@example.local
```

Consumer accounts:

```text
local-consumer-0001@example.local ... local-consumer-0500@example.local
```

The queue seed creates 250 active staff-created reservations for today.

For the linked hosted Supabase project, run:

```bash
npx supabase db query --linked --file supabase/production-consumer-queue-seed.sql
```

The production seed creates the same staff accounts and 500 consumer accounts, then puts the first 250 consumers into today's active queue as staff-created reservations.
