import { readFile, writeFile } from 'node:fs/promises';

const databaseId = process.env.SIDDUR_D1_DATABASE_ID;

if (!databaseId) {
  throw new Error('SIDDUR_D1_DATABASE_ID is required for deployment.');
}

const source = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));

source.d1_databases = source.d1_databases.map((database) => (
  database.binding === 'DB' ? { ...database, database_id: databaseId } : database
));

await writeFile('.wrangler.deploy.jsonc', `${JSON.stringify(source, null, 2)}\n`);
