'use strict';

require('dotenv').config();

const http = require('http');
const WebSocket = require('ws');

const { handleKpiDaily } = require('./kpi_daily.js');
const { handleKpiSummary } = require('./kpi_summary.js');

const redisStore = require('./redisStore.js');

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

  if (req.url === '/viaje' && req.method === 'POST') {

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {

      try {
        const { tenantId, unitId, action, viaje } = JSON.parse(body);
        const tId = Number(tenantId);

        const key = `unit:${tId}:${unitId}`;
        const data = await redisClient.get(key);

        if (!data) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'unit not found' }));
          return;
        }
        if (action === 'START') {
          await redisStore.setViaje(redisClient, tId, unitId, viaje);
        }
        if (action === 'END') {
          await redisStore.setViaje(redisClient, tId, unitId, null);
        }
        res.end(JSON.stringify({ ok: true }));

      } catch {
        res.writeHead(400);
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
      ws.tenantId = Number(msg.tenantId); // ← SIEMPRE número
      ws.unitId   = msg.unitId;           // string (device_uuid)
      return;
    }

    if (msg.type === 'pos') {

      const tenantId = Number(msg.tenantId);  // ← SIEMPRE número
      const deviceUuid = msg.unitId;          // string

      const {
        lat,
        lng,
        ts,
        viaje
      } = msg;

      console.log(`[RENDER-IN] unit=${deviceUuid} seq=${msg.seq}`);

      // Resolver device_uuid → vehicle_id con cache
      const cacheKey = `${tenantId}|${deviceUuid}`;
      
      const vehicleId = msg.vehicle_id;
      
      if (!vehicleId) {
        console.warn('No vehicle_id in message', deviceUuid);
        return;
      }

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
      
      if (tenantId !== ws.tenantId) return;
    }
  });
});

server.listen(PORT, () => {
  console.log(`WS core running on ${PORT}`);
});