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

// device_uuid (string) → vehicle_id (number)
async function resolveVehicleId(tenantId, deviceUuid) {

  console.log('DB LOOKUP EXECUTED', tenantId, deviceUuid);
  
  const conn = getPool();
  
  const [rows] = await conn.execute(`  
    SELECT v.id AS vehicle_id
    FROM devices d
    JOIN vehicle_devices vd ON vd.device_id = d.id
    JOIN vehicles v ON v.id = vd.vehicle_id
    WHERE d.tenant_id = ?
      AND d.device_uuid = ?
      AND v.active = 1
    LIMIT 1
  `, [tenantId, deviceUuid]);

  if (!rows.length) return null;

  return rows[0].vehicle_id;
}

module.exports = {
  resolveVehicleId
};
