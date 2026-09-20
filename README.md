# My Prayer Book

A blank-slate, offline-capable prayer-book application hosted on Cloudflare Workers. Users can create sections and add or edit prayers while preserving entered text exactly. Optional Cloudflare D1 synchronization supports cross-device editing and read-only sharing.

## Local development

```bash
npm install
npm run dev
```

## Deploy

1. Create a Cloudflare D1 database named `siddur-sync`.
2. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.jsonc` with that database's ID.
3. Authenticate Wrangler once with `npx wrangler login`.
4. Initialize the new database with `npm run db:setup`.
5. Deploy with `npm run deploy`.

Run `npm run db:setup` again only when intentionally applying a future schema change.

## Data and access

Prayer collections are stored in D1. Private editor links grant modification access and should be treated like passwords. Reader links are read-only. Local browser storage provides offline access, and JSON export remains available for independent backups.
