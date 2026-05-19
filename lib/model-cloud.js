/* =========================================================
   lib/model-cloud.js — Hushh
   Optional anonymous cloud model sync via Supabase Storage.
   No SDK — plain fetch only (works in static export).

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

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL      || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const BUCKET = 'hushh-models';

const K_SYNC = 'hushh-cloud-sync';
const K_UID  = 'hushh-device-id';

export const isCloudConfigured = () => !!(SB_URL && SB_KEY);
export const isSyncEnabled     = () => isCloudConfigured() && localStorage.getItem(K_SYNC) === 'true';
export const setSyncEnabled    = val => localStorage.setItem(K_SYNC, val ? 'true' : 'false');

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

async function storageGet(path) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: sbHeaders({}),
  });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`storage download ${path}: ${r.status}`);
  return r.json();
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
 * Resolves on success, throws on failure.
 */
export async function uploadAndMerge(localModel) {
  const uid   = getDeviceId();
  const local = await serializeWeights(localModel);

  // 1. Save this device's contribution (for auditing / future re-weighting)
  await storagePut(`contributions/${uid}.json`, { weights: local, ts: Date.now() });

  // 2. Download current community model
  const community = await storageGet('models/community.json').catch(() => null);

  // 3. FedAvg: 80% old community + 20% new contribution
  const merged = (community?.weights?.length === local.length)
    ? fedAvg(community.weights, local, 0.8)
    : local; // first-ever contribution becomes the community baseline

  const contributors = (Number(community?.contributors) || 0) + 1;

  // 4. Publish updated community model (contributor count stored inline)
  await storagePut('models/community.json', { weights: merged, contributors, ts: Date.now() });
}

/**
 * Download community model and blend into localModel in-place (60% local / 40% community).
 * Returns true if the community model was applied, false if none exists yet.
 */
export async function downloadAndMerge(localModel) {
  const community = await storageGet('models/community.json');
  if (!community?.weights) return false;

  const local = await serializeWeights(localModel);
  if (local.length !== community.weights.length) return false;

  applyWeights(localModel, fedAvg(local, community.weights, 0.6));
  return true;
}
