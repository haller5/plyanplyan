// api/state.js — stores the whole planner as one JSON document in Upstash Redis.
import { timingSafeEqual } from 'node:crypto';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PLANNER_KEY = process.env.PLANNER_KEY || '';
const DOC = 'techo:state';

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `Redis responded ${r.status}`);
  return j.result;
}

function authorized(req) {
  const h = req.headers.authorization || '';
  const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const want = Buffer.from(PLANNER_KEY);
  return PLANNER_KEY.length >= 8 && got.length === want.length && timingSafeEqual(got, want);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Redis isn’t connected to this Vercel project yet.' });
  if (PLANNER_KEY.length < 8) return res.status(500).json({ error: 'Set PLANNER_KEY (8+ characters) in Vercel, then redeploy.' });
  if (!authorized(req)) return res.status(401).json({ error: 'Wrong passphrase.' });

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', DOC]);
      return res.status(200).json(raw ? JSON.parse(raw) : {});
    }
    if (req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      if (!body || typeof body.state !== 'object') return res.status(400).json({ error: 'Body needs a state object.' });
      const doc = { state: body.state, updated: Number(body.updated) || Date.now(), client: String(body.client || '') };
      await redis(['SET', DOC, JSON.stringify(doc)]);
      return res.status(200).json({ ok: true, updated: doc.updated });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Use GET or PUT.' });
  } catch (err) {
    return res.status(502).json({ error: 'Saving to Redis failed. Try again in a moment.' });
  }
}
