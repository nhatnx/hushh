/* =========================================================
   lib/model-cloud.js — Hushh
   Optional anonymous cloud model sync via Firebase REST API.
   No SDK — uses plain fetch only (works in static export).

   Setup: in Vercel → Settings → Environment Variables, add:
     NEXT_PUBLIC_FIREBASE_API_KEY   = AIzaSy…
     NEXT_PUBLIC_FIREBASE_PROJECT   = your-project-id
     NEXT_PUBLIC_FIREBASE_BUCKET    = your-project-id.appspot.com

   Firebase Security Rules (paste into Firebase Console):
   ── Storage ──────────────────────────────────────────────
     rules_version = '2';
     service firebase.storage {
       match /b/{bucket}/o {
         match /models/community.json {
           allow read: if true;
           allow write: if request.auth != null;
         }
         match /contributions/{uid}.json {
           allow read: if request.auth != null;
           allow write: if request.auth.uid == uid;
         }
       }
     }
   ── Firestore ────────────────────────────────────────────
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /models/meta {
           allow read: if true;
           allow write: if request.auth != null;
         }
       }
     }
   ========================================================= */

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY  || '';
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT  || '';
const BUCKET  = process.env.NEXT_PUBLIC_FIREBASE_BUCKET   || '';

const K_TOKEN   = 'hushh-fb-token';
const K_EXP     = 'hushh-fb-exp';
const K_REFRESH = 'hushh-fb-refresh';
const K_UID     = 'hushh-fb-uid';
const K_SYNC    = 'hushh-cloud-sync';

export const isCloudConfigured = () => !!(API_KEY && PROJECT && BUCKET);
export const isSyncEnabled     = () => isCloudConfigured() && localStorage.getItem(K_SYNC) === 'true';
export const setSyncEnabled    = val => localStorage.setItem(K_SYNC, val ? 'true' : 'false');

/* ---- Firebase Anonymous Auth (REST) ---- */

async function refreshIdToken(refreshToken) {
  const r = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }) }
  );
  if (!r.ok) throw new Error(`token refresh: ${r.status}`);
  const { id_token, refresh_token: newRefresh, expires_in } = await r.json();
  localStorage.setItem(K_TOKEN, id_token);
  localStorage.setItem(K_EXP, String(Date.now() + Number(expires_in) * 1000));
  localStorage.setItem(K_REFRESH, newRefresh);
  return id_token;
}

async function getIdToken() {
  const cached  = localStorage.getItem(K_TOKEN);
  const exp     = Number(localStorage.getItem(K_EXP) || 0);
  const refresh = localStorage.getItem(K_REFRESH);

  if (cached && Date.now() < exp - 60_000) return cached;
  if (refresh) {
    try { return await refreshIdToken(refresh); } catch {}
  }

  // First time — create anonymous user
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }) }
  );
  if (!r.ok) throw new Error(`anon sign-in: ${r.status}`);
  const { idToken, localId, expiresIn, refreshToken } = await r.json();
  localStorage.setItem(K_TOKEN, idToken);
  localStorage.setItem(K_EXP, String(Date.now() + Number(expiresIn) * 1000));
  localStorage.setItem(K_REFRESH, refreshToken);
  localStorage.setItem(K_UID, localId);
  return idToken;
}

/* ---- Firebase Storage (REST) ---- */

async function storagePut(path, body, token) {
  const r = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(path)}`,
    { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body) }
  );
  if (!r.ok) throw new Error(`storage PUT ${path}: ${r.status}`);
}

async function storageGet(path) {
  const r = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`storage GET ${path}: ${r.status}`);
  return r.json();
}

/* ---- Firestore (REST) ---- */

const fsDocUrl = (col, id) =>
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${col}/${id}`;

export async function getContributorCount() {
  if (!isCloudConfigured()) return 0;
  try {
    const r = await fetch(fsDocUrl('models', 'meta'));
    if (!r.ok) return 0;
    const d = await r.json();
    return Number(d.fields?.contributors?.integerValue ?? 0);
  } catch { return 0; }
}

async function incrementContributors(token) {
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
    { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ writes: [{ transform: {
        document: `projects/${PROJECT}/databases/(default)/documents/models/meta`,
        fieldTransforms: [{ fieldPath: 'contributors', increment: { integerValue: '1' } }],
      }}] }) }
  );
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

/**
 * Upload localModel to cloud and update the community average.
 * Resolves on success, throws on failure.
 */
export async function uploadAndMerge(localModel) {
  const token = await getIdToken();
  const uid   = localStorage.getItem(K_UID);
  const local = await serializeWeights(localModel);

  // 1. Save this device's contribution
  await storagePut(`contributions/${uid}.json`, { weights: local, ts: Date.now() }, token);

  // 2. Running FedAvg: 80% old community + 20% new contribution
  const community = await storageGet('models/community.json').catch(() => null);
  const merged = (community?.weights?.length === local.length)
    ? fedAvg(community.weights, local, 0.8)
    : local;

  // 3. Publish updated community model
  await storagePut('models/community.json', { weights: merged, ts: Date.now() }, token);

  // 4. Bump contributor count (best-effort, non-blocking)
  incrementContributors(token).catch(() => {});
}

/**
 * Download community model and blend into localModel in-place (60% local / 40% community).
 * Returns true if applied, false if no community model exists yet.
 */
export async function downloadAndMerge(localModel) {
  const community = await storageGet('models/community.json');
  if (!community?.weights) return false;

  const local = await serializeWeights(localModel);
  if (local.length !== community.weights.length) return false;

  applyWeights(localModel, fedAvg(local, community.weights, 0.6));
  return true;
}
