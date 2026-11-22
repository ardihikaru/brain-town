# env/

| File                 | Committed? | Purpose                                                                 |
| -------------------- | ---------- | ----------------------------------------------------------------------- |
| `.env.local.example` | ✅ yes     | Template for the local target. Placeholders only, no real secrets.      |
| `.env.local`         | ❌ ignored | Your local values. Created by `npm run env:init` with random passwords. |

`TEST_ENV` (only `local` is supported) decides which file is loaded by `config/env.ts`.
Real environment variables (`export FOO=...`) always win over the file.

`scripts/stack.sh` passes the same file to `docker compose --env-file`, so the stack and the suite share
the admin account, the ArcadeDB password and the ingest limits. There is no staging or production file:
Brain Town demo and production are never targets of this suite.

Adding a variable: add it to `.env.local.example` **and** to the zod schema in `config/env.ts` (if the suite
reads it). Existing `.env.local` files are not updated by `npm run env:init`: append the variable by hand, or
delete the file and run `npm run env:init` again.
