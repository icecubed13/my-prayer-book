const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function randomToken(bytes = 24) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  values.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function validCollectionData(data) {
  return data
    && data.version === 1
    && Array.isArray(data.sections)
    && Array.isArray(data.prayers);
}

async function parseBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 1500000) throw new Error('too_large');
  const body = await request.json();
  const encoded = JSON.stringify(body.data);
  if (!validCollectionData(body.data) || encoded.length > 1500000) throw new Error('invalid');
  return { ...body, encoded };
}

async function createCollection(request, env) {
  let body;
  try {
    body = await parseBody(request);
  } catch (error) {
    return json({ error: error.message === 'too_large' ? 'Collection is too large.' : 'Invalid collection data.' }, 400);
  }
  const collectionId = randomToken(9);
  const editToken = randomToken(32);
  const viewToken = randomToken(32);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO collections (id, title, payload, revision, edit_token_hash, view_token_hash, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)',
  ).bind(
    collectionId,
    String(body.title || 'Prayer Book').slice(0, 160),
    body.encoded,
    await tokenHash(editToken),
    await tokenHash(viewToken),
    now,
    now,
  ).run();
  return json({ collectionId, editToken, viewToken, revision: 1 }, 201);
}

async function findCollection(env, id) {
  return env.DB.prepare(
    'SELECT id, title, payload, revision, edit_token_hash, view_token_hash, updated_at FROM collections WHERE id = ?',
  ).bind(id).first();
}

async function readCollection(request, env, id) {
  const record = await findCollection(env, id);
  if (!record) return json({ error: 'Collection not found.' }, 404);
  const suppliedHash = await tokenHash(bearerToken(request));
  const canEdit = suppliedHash === record.edit_token_hash;
  const canView = canEdit || suppliedHash === record.view_token_hash;
  if (!canView) return json({ error: 'This sharing link is not valid.' }, 403);
  return json({
    collectionId: record.id,
    title: record.title,
    data: JSON.parse(record.payload),
    revision: record.revision,
    updatedAt: record.updated_at,
    canEdit,
  });
}

async function updateCollection(request, env, id) {
  const record = await findCollection(env, id);
  if (!record) return json({ error: 'Collection not found.' }, 404);
  if (await tokenHash(bearerToken(request)) !== record.edit_token_hash) {
    return json({ error: 'Editing permission is required.' }, 403);
  }
  let body;
  try {
    body = await parseBody(request);
  } catch (error) {
    return json({ error: error.message === 'too_large' ? 'Collection is too large.' : 'Invalid collection data.' }, 400);
  }
  if (!body.force && Number(body.revision) !== Number(record.revision)) {
    return json({ data: JSON.parse(record.payload), revision: record.revision, updatedAt: record.updated_at }, 409);
  }
  const nextRevision = Number(record.revision) + 1;
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE collections SET payload = ?, revision = ?, updated_at = ? WHERE id = ?',
  ).bind(body.encoded, nextRevision, updatedAt, id).run();
  return json({ collectionId: id, revision: nextRevision, updatedAt });
}

async function handleApi(request, env) {
  if (!env.DB) return json({ error: 'D1 database binding is missing.' }, 503);
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/collections') return createCollection(request, env);
  const match = url.pathname.match(/^\/api\/collections\/([A-Za-z0-9_-]+)$/);
  if (match && request.method === 'GET') return readCollection(request, env, match[1]);
  if (match && request.method === 'PUT') return updateCollection(request, env, match[1]);
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: 'The prayer collection service is temporarily unavailable.' }, 500);
    }
  },
};
