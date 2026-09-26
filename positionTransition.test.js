'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluatePositionTransition } = require('./positionTransition.js');
const redisStore = require('./redisStore.js');

class FakeRedis {
  constructor(raw = null) {
    this.raw = raw;
    this.getCalls = [];
    this.setCalls = [];
  }

  async get(key) {
    this.getCalls.push(key);
    return this.raw;
  }

  async set(key, value, options) {
    this.setCalls.push({ key, value, options });
  }
}

async function withFixedNow(now, callback) {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

function previousPoint(overrides = {}) {
  return {
    lat: 0,
    lng: 0,
    serverTs: 9000,
    ...overrides
  };
}

function candidatePoint(overrides = {}) {
  return {
    lat: 0,
    lng: 0,
    serverTs: 1,
    ...overrides
  };
}

test('accepts the first point and captures server time', { concurrency: false }, async () => {
  await withFixedNow(10000, () => {
    assert.deepEqual(
      evaluatePositionTransition(null, candidatePoint()),
      { accepted: true, serverTs: 10000, moved: null }
    );
  });
});

test('rejects a non-number timestamp before calling Date.now', { concurrency: false }, () => {
  const originalNow = Date.now;
  Date.now = () => {
    throw new Error('Date.now must not be called');
  };
  try {
    assert.deepEqual(
      evaluatePositionTransition(null, candidatePoint({ serverTs: '1' })),
      { accepted: false, reason: 'invalid_server_ts' }
    );
  } finally {
    Date.now = originalNow;
  }
});

test('rejects equal and later previous timestamps', { concurrency: false }, async () => {
  await withFixedNow(10000, () => {
    assert.deepEqual(
      evaluatePositionTransition(previousPoint({ serverTs: 10000 }), candidatePoint()),
      { accepted: false, reason: 'out_of_order' }
    );
    assert.deepEqual(
      evaluatePositionTransition(previousPoint({ serverTs: 10001 }), candidatePoint()),
      { accepted: false, reason: 'out_of_order' }
    );
  });
});

test('uses strict movement and speed limits', { concurrency: false }, async () => {
  await withFixedNow(10000, () => {
    const exactlyThreeMeters = 3 / 111320;
    const overThreeMeters = 3.01 / 111320;
    const exactlySixtyMeters = 60 / 111320;
    const overSixtyMeters = 60.01 / 111320;

    assert.equal(
      evaluatePositionTransition(previousPoint(), candidatePoint({ lng: exactlyThreeMeters })).moved,
      false
    );
    assert.equal(
      evaluatePositionTransition(previousPoint(), candidatePoint({ lng: overThreeMeters })).moved,
      true
    );
    assert.deepEqual(
      evaluatePositionTransition(previousPoint(), candidatePoint({ lng: exactlySixtyMeters })),
      { accepted: true, serverTs: 10000, moved: true }
    );

    const rejected = evaluatePositionTransition(
      previousPoint(),
      candidatePoint({ lng: overSixtyMeters })
    );
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, 'unrealistic_speed');
    assert.ok(rejected.speed > 60);
  });
});

test('preserves behavior for a non-number previous timestamp and NaN coordinates', { concurrency: false }, async () => {
  await withFixedNow(10000, () => {
    assert.deepEqual(
      evaluatePositionTransition(
        previousPoint({ serverTs: 'invalid' }),
        candidatePoint({ lat: Number.NaN })
      ),
      { accepted: true, serverTs: 10000, moved: false }
    );
  });
});

test('writes the complete first-point JSON and TTL 480', { concurrency: false }, async () => {
  const redis = new FakeRedis();

  await withFixedNow(10000, () => redisStore.updateUnitPoint(redis, {
    tenantId: 7,
    unitId: 'device-1',
    vehicle_id: undefined,
    lat: -34.6,
    lng: -58.4,
    server_ts: 123,
    viaje: undefined
  }));

  assert.deepEqual(redis.getCalls, ['unit:7:device-1']);
  assert.equal(redis.setCalls.length, 1);
  assert.equal(redis.setCalls[0].key, 'unit:7:device-1');
  assert.deepEqual(JSON.parse(redis.setCalls[0].value), {
    tenant_id: 7,
    unit_id: 'device-1',
    vehicle_id: null,
    lat: -34.6,
    lng: -58.4,
    server_ts: 10000,
    prev_lat: null,
    prev_lng: null,
    prev_server_ts: null,
    viaje: null,
    stopped_since: null,
    no_data_since: null
  });
  assert.deepEqual(redis.setCalls[0].options, {
    expiration: {
      type: 'EX',
      value: 480
    }
  });
});

test('preserves previous fields, stopped_since, no_data_since and absent viaje', { concurrency: false }, async () => {
  const prev = {
    tenant_id: 7,
    unit_id: 'device-1',
    vehicle_id: 11,
    lat: -34.6,
    lng: -58.4,
    server_ts: 9000,
    prev_lat: -34.5,
    prev_lng: -58.3,
    prev_server_ts: 8000,
    viaje: { id: 3 },
    stopped_since: 5,
    no_data_since: 6
  };
  const redis = new FakeRedis(JSON.stringify(prev));

  await withFixedNow(10000, () => redisStore.updateUnitPoint(redis, {
    tenantId: 7,
    unitId: 'device-1',
    vehicle_id: 11,
    lat: -34.6,
    lng: -58.4,
    server_ts: 123,
    viaje: undefined
  }));

  assert.equal(redis.setCalls.length, 1);
  assert.deepEqual(JSON.parse(redis.setCalls[0].value), {
    tenant_id: 7,
    unit_id: 'device-1',
    vehicle_id: 11,
    lat: -34.6,
    lng: -58.4,
    server_ts: 10000,
    prev_lat: -34.6,
    prev_lng: -58.4,
    prev_server_ts: 9000,
    viaje: { id: 3 },
    stopped_since: 5,
    no_data_since: 6
  });
});

test('starts stopped_since for a stationary point and accepts explicit null viaje', { concurrency: false }, async () => {
  const prev = {
    lat: 0,
    lng: 0,
    server_ts: 9000,
    viaje: { id: 3 },
    stopped_since: null,
    no_data_since: null
  };
  const redis = new FakeRedis(JSON.stringify(prev));

  await withFixedNow(10000, () => redisStore.updateUnitPoint(redis, {
    tenantId: 7,
    unitId: 'device-1',
    vehicle_id: 11,
    lat: 0,
    lng: 0,
    server_ts: 123,
    viaje: null
  }));

  const written = JSON.parse(redis.setCalls[0].value);
  assert.equal(written.stopped_since, 10);
  assert.equal(written.viaje, null);
});

test('clears stopped_since after accepted movement beyond three meters', { concurrency: false }, async () => {
  const prev = {
    lat: 0,
    lng: 0,
    server_ts: 9000,
    viaje: null,
    stopped_since: 5,
    no_data_since: null
  };
  const redis = new FakeRedis(JSON.stringify(prev));

  await withFixedNow(10000, () => redisStore.updateUnitPoint(redis, {
    tenantId: 7,
    unitId: 'device-1',
    vehicle_id: 11,
    lat: 0,
    lng: 4 / 111320,
    server_ts: 123,
    viaje: undefined
  }));

  assert.equal(JSON.parse(redis.setCalls[0].value).stopped_since, null);
});

test('discarded points read Redis but do not write or refresh TTL', { concurrency: false }, async () => {
  const invalid = new FakeRedis();
  await redisStore.updateUnitPoint(invalid, {
    tenantId: 7,
    unitId: 'device-1',
    vehicle_id: 11,
    lat: 0,
    lng: 0,
    server_ts: 'invalid'
  });
  assert.deepEqual(invalid.getCalls, ['unit:7:device-1']);
  assert.equal(invalid.setCalls.length, 0);

  const outOfOrder = new FakeRedis(JSON.stringify({
    lat: 0,
    lng: 0,
    server_ts: 10000
  }));
  await withFixedNow(10000, () => redisStore.updateUnitPoint(outOfOrder, {
    tenantId: 7,
    unitId: 'device-1',
    vehicle_id: 11,
    lat: 0,
    lng: 0,
    server_ts: 1
  }));
  assert.equal(outOfOrder.setCalls.length, 0);
});

test('unrealistic speed preserves the warning and does not write', { concurrency: false }, async () => {
  const redis = new FakeRedis(JSON.stringify({
    lat: 0,
    lng: 0,
    server_ts: 9000
  }));
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    await withFixedNow(10000, () => redisStore.updateUnitPoint(redis, {
      tenantId: 7,
      unitId: 'device-1',
      vehicle_id: 11,
      lat: 0,
      lng: 61 / 111320,
      server_ts: 1
    }));
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(redis.setCalls.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[DROP] velocidad irreal');
  assert.equal(warnings[0][1].unitId, 'device-1');
  assert.ok(warnings[0][1].speed > 60);
});
