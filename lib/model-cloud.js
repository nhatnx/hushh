/* =========================================================
   lib/model-cloud.js — Hushh
   Optional anonymous cloud model sync via Supabase Storage.
   No SDK — plain fetch only (works in static export).

   Storage format v2: weights are int8-quantized and
   base64-encoded (~9× smaller than v1 float JSON arrays).
   v1 format is still accepted for backwards compatibility.

   Setup:
   1. Create a Supabase project at https://supabase.com
   2. Go to Storage → New bucket → name it "hushh-models" (private)
   3. Run these policies in the SQL editor:

      CREATE POLICY "anon read"
        ON storage.objects FOR SELECT TO anon
        USING (bucket_id = 'hushh-models');

      CREATE POLICY "anon insert"
        ON storage.objects FOR INSERT TO anon
        WITH CHECK (bucket_id = 'hushh-models');

      CREATE POLICY "anon update"
        ON storage.objects FOR UPDATE TO anon
        USING (bucket_id = 'hushh-models');

   4. In Vercel → Settings → Environment Variables, add:
        NEXT_PUBLIC_SUPABASE_URL      = https://xxxx.supabase.co
        NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
   ========================================================= */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Set > 0 to slow down progress animation for demo/dev visibility.
// Each real network chunk is spread across DEMO_STEPS ticks × DEMO_STEP_MS ms.
// Set to 0 for production (progress reflects actual network speed).
const DEMO_STEP_MS = 60;
const DEMO_STEPS = 20;
const BUCKET = 'hushh-models';

const K_SYNC = 'hushh-cloud-sync';
const K_UID = 'hushh-device-id';

export const isCloudConfigured = () => !!(SB_URL && SB_KEY);
export const isSyncEnabled = () => isCloudConfigured() && localStorage.getItem(K_SYNC) === 'true';
export const setSyncEnabled = val => localStorage.setItem(K_SYNC, val ? 'true' : 'false');

function getDeviceId() {
  let id = localStorage.getItem(K_UID);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(K_UID, id); }
  return id;
}

/* ---- Supabase Storage (REST) ---- */

const sbHeaders = extra => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  ...extra,
});

async function storagePut(path, data) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`storage upload ${path}: ${r.status}`);
}

/**
 * Fetch a Supabase storage object.
 * - Checks Cache API first (stale-while-revalidate):
 *   cached hit → return immediately, revalidate in background.
 *   no cache  → fetch with optional ReadableStream progress, then cache.
 * - onProgress(0..1) is called only during an actual network download.
 */
async function storageGet(path, onProgress) {
  const url = `${SB_URL}/storage/v1/object/${BUCKET}/${path}`;

  if ('caches' in globalThis) {
    try {
      const cache = await caches.open('hushh-models-v1');
      const cached = await cache.match(url);
      if (cached) {
        // Return stale data immediately, refresh cache in background
        _revalidateCache(url, cache).catch(() => { });
        return cached.json();
      }
    } catch { /* caches unavailable in this context, fall through */ }
  }

  return _fetchAndCache(url, path, onProgress);
}

async function _revalidateCache(url, cache) {
  // Fire-and-forget: update cache without blocking the caller
  const r = await fetch(url, { headers: sbHeaders({}) });
  if (r.ok) {
    const text = await r.text();
    await cache.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
  }
}

async function _fetchAndCache(url, path, onProgress) {
  const r = await fetch(url, { headers: sbHeaders({}) });
  if (r.status === 404) return null;
  if (r.status === 400) {
    const body = await r.json().catch(() => ({}));
    const msg = (body?.error ?? body?.message ?? '').toLowerCase();
    if (msg.includes('not found')) return null;
    throw new Error(body?.message ?? body?.error ?? `storage 400: ${path}`);
  }
  if (!r.ok) throw new Error(`storage download ${path}: ${r.status}`);

  let text;

  if (onProgress && DEMO_STEP_MS > 0) {
    // Demo mode: Supabase omits Content-Length, so decouple animation from bytes.
    // Fetch and animate in parallel — whichever takes longer determines total wait.
    const animPromise = (async () => {
      for (let i = 1; i <= DEMO_STEPS; i++) {
        await new Promise(res => setTimeout(res, DEMO_STEP_MS));
        onProgress(i / DEMO_STEPS);
      }
    })();
    [text] = await Promise.all([r.text(), animPromise]);
  } else if (onProgress) {
    const total = parseInt(r.headers.get('content-length') || '0', 10);
    if (r.body && total > 0) {
      // Real streaming progress when content-length is known
      let loaded = 0;
      const reader = r.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress(Math.min(loaded / total, 1));
      }
      text = new TextDecoder().decode(_concatChunks(chunks));
    } else {
      // No content-length (common with Supabase) — fetch and snap to 100%
      text = await r.text();
      onProgress(1);
    }
  } else {
    text = await r.text();
  }

  const data = JSON.parse(text);

  if ('caches' in globalThis) {
    caches.open('hushh-models-v1')
      .then(c => c.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } })))
      .catch(() => { });
  }

  return data;
}

function _concatChunks(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

/* ---- int8 weight quantization (symmetric, per-tensor) ---- */
// Reduces the Supabase payload ~9× vs storing raw float32 JSON arrays.

function _quantizeWeights(weights) {
  return weights.map(w => {
    const arr = w.data;
    let absMax = 0;
    for (let i = 0; i < arr.length; i++) {
      const a = Math.abs(arr[i]);
      if (a > absMax) absMax = a;
    }
    const scale = (absMax / 127) || 1e-8;
    const q = new Int8Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      q[i] = Math.max(-127, Math.min(127, Math.round(arr[i] / scale)));
    }
    // Encode Int8 bytes as base64 without spread (avoids call-stack limit on large arrays)
    const bytes = new Uint8Array(q.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { shape: w.shape, b64: btoa(binary), scale };
  });
}

function _dequantizeWeights(qWeights) {
  return qWeights.map(qw => {
    // Accept legacy v1 format (plain float arrays) transparently
    if (Array.isArray(qw.data)) return qw;
    const bytes = Uint8Array.from(atob(qw.b64), c => c.charCodeAt(0));
    const q = new Int8Array(bytes.buffer);
    const data = new Array(q.length);
    for (let i = 0; i < q.length; i++) data[i] = q[i] * qw.scale;
    return { shape: qw.shape, data };
  });
}

/* ---- Weight serialization ---- */

async function serializeWeights(model) {
  // getWeights() returns refs to the model's own tensors — do NOT dispose them
  return Promise.all(
    model.getWeights().map(async w => ({ shape: w.shape, data: Array.from(await w.data()) }))
  );
}

function applyWeights(model, ws) {
  const tensors = ws.map(w => window.tf.tensor(w.data, w.shape));
  model.setWeights(tensors);
  tensors.forEach(t => t.dispose());
}

/* Weighted average (FedAvg) of two weight arrays */
function fedAvg(wA, wB, ratioA) {
  return wA.map((la, i) => {
    const lb = wB[i];
    if (!lb || la.data.length !== lb.data.length) return la;
    return { shape: la.shape, data: la.data.map((v, j) => v * ratioA + lb.data[j] * (1 - ratioA)) };
  });
}

/* ---- Public API ---- */

/** Returns the number of contributors stored inline in community.json */
export async function getContributorCount() {
  if (!isCloudConfigured()) return 0;
  try {
    const d = await storageGet('models/community.json');
    return Number(d?.contributors ?? 0);
  } catch { return 0; }
}

/**
 * Upload local model weights → FedAvg into community model → increment contributor count.
 * Uploads in v2 (quantized) format. Resolves on success, throws on failure.
 */
export async function uploadAndMerge(localModel) {
  const uid = getDeviceId();
  const local = await serializeWeights(localModel);

  // Save this device's contribution (for auditing / future re-weighting)
  await storagePut(`contributions/${uid}.json`, { weights: local, ts: Date.now() });

  // Download current community model (v1 or v2)
  const community = await storageGet('models/community.json').catch(() => null);

  // Normalize to float arrays regardless of storage format
  const communityWeights = community?.v === 2
    ? _dequantizeWeights(community.qWeights)
    : community?.weights ?? null;

  // FedAvg: 80% old community + 20% new contribution
  const merged = (communityWeights?.length === local.length)
    ? fedAvg(communityWeights, local, 0.8)
    : local; // first-ever contribution becomes the community baseline

  const contributors = (Number(community?.contributors) || 0) + 1;

  // Publish v2 (quantized) format
  await storagePut('models/community.json', {
    v: 2,
    qWeights: _quantizeWeights(merged),
    contributors,
    ts: Date.now(),
  });
}

/**
 * Download community model and blend into localModel in-place (60% local / 40% community).
 * Returns true if the community model was applied, false if none exists yet.
 * onProgress(0..1) is called during network download (not when served from cache).
 */
export async function downloadAndMerge(localModel, onProgress) {
  const community = await storageGet('models/community.json', onProgress);
  if (!community) return false;

  // Handle v1 (plain floats) and v2 (quantized) transparently
  const communityWeights = community.v === 2
    ? _dequantizeWeights(community.qWeights)
    : community.weights;
  if (!communityWeights) return false;

  const local = await serializeWeights(localModel);
  if (local.length !== communityWeights.length) return false;

  applyWeights(localModel, fedAvg(local, communityWeights, 0.6));
  return true;
}
