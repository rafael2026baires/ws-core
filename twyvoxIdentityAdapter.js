'use strict';

const deviceResolver = require('./deviceResolver.js');

function buildRevocationKey(identity) {
  return `identity:${identity}:revoked`;
}

async function isIdentityRevoked(redisClient, identity) {
  return await redisClient.get(buildRevocationKey(identity)) !== null;
}

// Traduce la identidad técnica del dispositivo al contexto de TwyVox.
function resolveTwyVoxIdentity(redisClient, deviceUuid) {
  return deviceResolver.resolveDevice(redisClient, deviceUuid);
}

async function resolveAuthorizedTwyVoxIdentity(redisClient, deviceUuid) {
  if (await isIdentityRevoked(redisClient, deviceUuid)) {
    return { status: 'revoked', identity: null };
  }

  const identity = await resolveTwyVoxIdentity(redisClient, deviceUuid);
  return identity
    ? { status: 'authorized', identity }
    : { status: 'unresolved', identity: null };
}

async function revokeIdentity(redisClient, identity) {
  await redisClient.set(buildRevocationKey(identity), '1');
  await redisClient.del(`device:${identity}:map`);
}

async function clearRevocation(redisClient, identity) {
  await redisClient.del(buildRevocationKey(identity));
}

async function invalidateIdentityMapping(redisClient, identity) {
  await redisClient.del(`device:${identity}:map`);
}

module.exports = {
  resolveTwyVoxIdentity,
  resolveAuthorizedTwyVoxIdentity,
  revokeIdentity,
  clearRevocation,
  invalidateIdentityMapping
};
