# My Prayer Book

A blank-slate, offline-capable prayer-book application hosted on Cloudflare Workers. Users can create sections and add or edit prayers while preserving entered text exactly. Optional Cloudflare D1 synchronization supports cross-device editing and read-only sharing.

## Local development

```bash
npm install
npm run dev
```

## Deploy

Authenticate Wrangler once with `npx wrangler login`, then run:

```bash
npm run deploy
```

The existing D1 database is configured in `wrangler.jsonc`. Run `npm run db:setup` only when initializing a new database or intentionally applying a future schema change.

## Data and access

Prayer collections are stored in D1. Private editor links grant modification access and should be treated like passwords. Reader links are read-only. Local browser storage provides offline access, and JSON export remains available for independent backups.
