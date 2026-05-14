'use strict';

const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });
  }

  return pool;
}

async function resolveObd(redisClient, obdUuid) {

  const redisKey = `obd_device:${obdUuid}:map`;

  // 1️⃣ buscar cache redis
  const cached = await redisClient.get(redisKey);

  if (cached) {
    // console.log('[OBD-CACHE-HIT]', obdUuid);
    try {
      return JSON.parse(cached);
    } catch {}
  }

  // 2️⃣ fallback mysql
  // console.log('[OBD-LOOKUP-DB]', obdUuid);

  const conn = getPool();

  const [rows] = await conn.execute(`
    SELECT
      od.tenant_id,
      v.id AS vehicle_id
    FROM obd_devices od
    JOIN vehicle_obd_devices vod
      ON vod.obd_device_id = od.id
    JOIN vehicles v
      ON v.id = vod.vehicle_id
    WHERE od.obd_uuid = ?
      AND od.active = 1
      AND vod.active = 1
    LIMIT 1
  `, [obdUuid]);

  if (!rows.length) {
    return null;
  }

  const result = {
    tenant_id: Number(rows[0].tenant_id),
    vehicle_id: Number(rows[0].vehicle_id)
  };

  // 3️⃣ guardar cache redis
  await redisClient.set(
    redisKey,
    JSON.stringify(result),
    {
      expiration: {
        type: 'EX',
        value: 86400
      }
    }
  );

  return result;
}

module.exports = {
  resolveObd
};