require('dotenv').config();

const baseCache = new Map();

/*
// 🔧 SIMULAMOS acceso a DB (después lo conectamos real)
async function fetchBaseFromDB(tenantId) {
  // ⚠️ por ahora mock (luego lo cambiamos por fetch a tu backend)
  return {
    lat: -38.01006,
    lng: -57.54450,
    radius: 50
  };
}
*/

// 🔧 conexión real, llamamos al backend de nut host para abrir la base, no la abrimos directo desde acá.
async function fetchBaseFromDB(tenantId) {

const BASE_URL = process.env.ENV === 'prod'
  ? process.env.INGEST_URL_PROD
  : process.env.INGEST_URL_LOCAL;

  const root = BASE_URL.replace('/api/gps/ingest_position.php', '');
  const res = await fetch(`${root}/api/config/get_base.php?tenant_id=${tenantId}`);
  
  if (!res.ok) {
    throw new Error('Error fetching base from backend');
  }
  const json = await res.json();

  if (!json || !json.base_lat || !json.base_lng) {
    throw new Error('Invalid base data');
  }
  return {
    lat: json.base_lat,
    lng: json.base_lng,
    radius: json.base_radius || 100
  };
}

async function getBaseForTenant(tenantId) {  
  if (baseCache.has(tenantId)) {
    return baseCache.get(tenantId);
  }

  console.log('[BASE-CACHE-MISS] tenant=', tenantId);

  // 👉 no está en cache → ir a DB
  const base = await fetchBaseFromDB(tenantId);

  if (!base) {
    throw new Error(`Base not found for tenant ${tenantId}`);
  }

  baseCache.set(tenantId, base);

  return base;
}
module.exports = { getBaseForTenant };
