'use strict';

const { evaluatePositionTransition } = require('./positionTransition.js');

function buildKey(tenantId, unitId) {
  return `unit:${tenantId}:${unitId}`;
}

async function getUnit(redisClient, tenantId, unitId) {
  const raw = await redisClient.get(buildKey(tenantId, unitId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setUnit(redisClient, tenantId, unitId, data) {
  const key = buildKey(tenantId, unitId);
 
  await redisClient.set(
    key,
    JSON.stringify(data),
    {
      expiration: {
        type: 'EX',
        value: 480 // cambiá a 30 para probar rápido
      }
    }
  );
}

async function updateUnitPoint(redisClient, {
  tenantId,
  unitId,
  vehicle_id,
  lat,
  lng,
  server_ts,
  viaje
}) {

  const prev = await getUnit(redisClient, tenantId, unitId);

  const transition = evaluatePositionTransition(
    prev ? {
      lat: prev.lat,
      lng: prev.lng,
      serverTs: prev.server_ts
    } : null,
    {
      lat,
      lng,
      serverTs: server_ts
    }
  );

  if (!transition.accepted) {
    if (transition.reason === 'unrealistic_speed') {
      console.warn('[DROP] velocidad irreal', {
        unitId,
        speed: transition.speed
      });
    }
    return;
  }

  server_ts = transition.serverTs;

  let stopped_since = prev?.stopped_since ?? null;

  if (prev) {
    if (transition.moved) {
      stopped_since = null;
    } else {
      if (prev?.stopped_since == null) {
        stopped_since = Math.floor(server_ts / 1000);
      } else {
        stopped_since = prev.stopped_since;
      }
    }
  }

  let no_data_since = prev?.no_data_since ?? null;

  const newData = {
    tenant_id: tenantId,
    unit_id: unitId,
    vehicle_id: vehicle_id ?? null,
    lat,
    lng,
    server_ts,
    prev_lat: prev?.lat ?? null,
    prev_lng: prev?.lng ?? null,
    prev_server_ts: prev?.server_ts ?? null,
    viaje: (viaje === undefined ? (prev?.viaje ?? null) : viaje),
    stopped_since,
    no_data_since
  };

  await setUnit(redisClient, tenantId, unitId, newData);
}

async function setViaje(redisClient, tenantId, unitId, viajeValue) {
  const unit = await getUnit(redisClient, tenantId, unitId);
  if (!unit) return false;

  unit.viaje = viajeValue;

  await setUnit(redisClient, tenantId, unitId, unit);
  return true;
}

module.exports = {
  updateUnitPoint,
  getUnit,
  setViaje
};
