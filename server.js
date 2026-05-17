'use strict';

require('dotenv').config();

const http = require('http');
const WebSocket = require('ws');

const { handleKpiDaily } = require('./kpi_daily.js');
const { handleKpiSummary } = require('./kpi_summary.js');

const redisStore = require('./redisStore.js');
const deviceResolver = require('./deviceResolver.js');
const obdResolver = require('./obdResolver.js');

const PORT = process.env.PORT || 3000;
let debugSeq = 0;

/* --------------  REDIS ------------------------- */
const { createClient } = require('redis');
const redisClient = createClient({
  //url: 'redis://127.0.0.1:6379'
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});
redisClient.on('error', (err) => console.error('Redis Error', err));

redisClient.connect()
  .then(() => console.log('✅ Redis conectado'))
  .catch(err => console.error('❌ Redis error', err));
/* ----------------------------------------------- */
// ------------------- Scan ----------------------  
async function scanKeys(pattern) {
  let cursor = '0';
  const keys = [];

  do {
    const reply = await redisClient.scan(cursor, {
      MATCH: pattern,
      COUNT: 100
    });

    cursor = reply.cursor;
    keys.push(...reply.keys);

  } while (cursor !== '0');

  return keys;
}
// -------------------------------------------------

/* ================== HTTP ================== */
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health') {
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  if (req.url === '/stats') {

    (async () => {      
      const keys = await scanKeys('unit:*');

      res.end(JSON.stringify({
        connections: wss.clients.size,
        unitsTotal: keys.length
      }));
    })();
    return;
  }

  if (req.url.startsWith('/last')) {
    (async () => {
      const url = new URL(req.url, 'http://x');
      const tenantId = Number(url.searchParams.get('tenantId'));

      const pattern = `unit:${tenantId}:*`;      
      const keys = await scanKeys(pattern);

      const units = [];

      for (const key of keys) {
        const data = await redisClient.get(key);
        if (!data) continue;

        try {
          units.push(JSON.parse(data));
        } catch {}
      }

      res.end(JSON.stringify({ tenantId, units }));
    })();
    return;
  }


  if (req.url === '/obd' && req.method === 'POST') {

    let body = '';

    req.on('data', chunk => body += chunk);

    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);

        const obdUuid = msg.obd_uuid ?? msg.obdUuid;

        if (!obdUuid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing obd_uuid' }));
          return;
        }

        // resolver obd_uuid → tenant_id + vehicle_id
        const resolved = await obdResolver.resolveObd(
          redisClient,
          obdUuid
        );

        if (!resolved) {
          console.warn('[OBD-NOT-FOUND]', obdUuid);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'obd device not found' }));
          return;
        }

        const tenantId = resolved.tenant_id;
        const vehicleId = resolved.vehicle_id;

        const obdData = {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          obd_uuid: obdUuid,

          fuel_level: msg.fuel_level ?? null,
          rpm: msg.rpm ?? null,
          engine_temp: msg.engine_temp ?? null,
          odometer: msg.odometer ?? null,
          battery_voltage: msg.battery_voltage ?? null,
          engine_on: msg.engine_on ?? null,

          client_ts: msg.client_ts ?? null,
          server_ts: Date.now()
        };

        const key = `obd:${tenantId}:${vehicleId}`;

        await redisClient.set(
          key,
          JSON.stringify(obdData),
          {
            expiration: {
              type: 'EX',
              value: 480
            }
          }
        );

        //console.log('[OBD SET]', key, obdData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, key }));

      } catch (err) {
        console.error('[OBD ERROR]', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid obd body' }));
      }
    });

    return;
  }

  if (req.url === '/viaje' && req.method === 'POST') {

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {

      try {
        const { unitId, action, viaje } = JSON.parse(body);

        if (!unitId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing unitId' }));
          return;
        }

        const resolved = await deviceResolver.resolveDevice(
          redisClient,
          unitId
        );

        if (!resolved) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'device not found' }));
          return;
        }

        const tenantId = resolved.tenant_id;

        const key = `unit:${tenantId}:${unitId}`;
        const data = await redisClient.get(key);

        if (!data) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unit not found' }));
          return;
        }

        if (action === 'START') {
          await redisStore.setViaje(redisClient, tenantId, unitId, viaje);
        }

        if (action === 'END') {
          await redisStore.setViaje(redisClient, tenantId, unitId, null);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, unitId, tenantId }));

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid body' }));
      }
    });
    return;
  }

  res.end('WS core online');
});

/* ================== WS ================== */

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  ws.tenantId = null;
  ws.unitId = null;

  ws.on('message', async data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'register') {
      ws.unitId = msg.unitId; // device_uuid
      return;
    }

    if (msg.type === 'pos') {

        const deviceUuid = msg.unitId;

        const {
          lat,
          lng,
          ts,
          viaje
        } = msg;

        //console.log(`[RENDER-IN] unit=${deviceUuid} seq=${msg.seq}`);

        // resolver device_uuid → tenant_id + vehicle_id
        const resolved = await deviceResolver.resolveDevice(
          redisClient,
          deviceUuid
        );

        if (!resolved) {
          console.warn('[DEVICE-NOT-FOUND]', deviceUuid);
          return;
        }

        const tenantId = resolved.tenant_id;
        const vehicleId = resolved.vehicle_id;

        await redisStore.updateUnitPoint(redisClient, {
          tenantId,
          unitId: deviceUuid,
          vehicle_id: vehicleId,
          lat,
          lng,
          server_ts: ts,
          viaje
        });   
      // ---------------------------------------------------------------------------------       
      //if (tenantId !== ws.tenantId) return;
    }
    
  });
});

server.listen(PORT, () => {
  console.log(`WS core running on ${PORT}`);
});