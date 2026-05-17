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

async function resolveDevice(redisClient, deviceUuid) {

  const redisKey = `device:${deviceUuid}:map`;

  // 1️⃣ buscar cache redis
  const cached = await redisClient.get(redisKey);

  if (cached) {
    //console.log('[DEVICE-CACHE-HIT]', deviceUuid);
    try {
      return JSON.parse(cached);
    } catch {}
  }

  // 2️⃣ fallback mysql
  console.log('[DEVICE-LOOKUP-DB]', deviceUuid);

  const conn = getPool();

  const [rows] = await conn.execute(`
    SELECT
      d.tenant_id,
      v.id AS vehicle_id
    FROM devices d
    JOIN vehicle_devices vd
      ON vd.device_id = d.id
    JOIN vehicles v
      ON v.id = vd.vehicle_id
    WHERE d.device_uuid = ?
    LIMIT 1
  `, [deviceUuid]);

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
  resolveDevice
};