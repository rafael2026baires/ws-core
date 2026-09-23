'use strict';

const crypto = require('crypto');

const HEADER_NAME = 'x-internal-api-token';
const MAX_BODY_BYTES = 4096;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function tokensMatch(expected, received) {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof received !== 'string' || received.length === 0) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function readIdentity(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new Error('invalid_content_type');
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error('body_too_large');
    }
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('invalid_json');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('invalid_body');
  }

  const keys = Object.keys(data);
  if (keys.length !== 1 || keys[0] !== 'identity') {
    throw new Error('invalid_body');
  }

  if (
    typeof data.identity !== 'string' ||
    data.identity.length === 0 ||
    data.identity.length > 255 ||
    data.identity !== data.identity.trim()
  ) {
    throw new Error('invalid_identity');
  }

  return data.identity;
}

async function handleIdentityInternalRequest(req, res, {
  redisClient,
  identityAdapter,
  internalApiToken
}) {
  const operation = req.url === '/identities/revoke'
    ? 'revoke'
    : req.url === '/identities/clear-revocation'
      ? 'clear'
      : req.url === '/identities/invalidate-mapping'
        ? 'invalidate-mapping'
        : null;

  if (!operation) return false;

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  }

  if (typeof internalApiToken !== 'string' || internalApiToken.length === 0) {
    sendJson(res, 503, { error: 'internal_api_not_configured' });
    return true;
  }

  if (!tokensMatch(internalApiToken, req.headers[HEADER_NAME])) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  let identity;
  try {
    identity = await readIdentity(req);
  } catch (err) {
    const statusCode = err.message === 'body_too_large' ? 413 : 400;
    sendJson(res, statusCode, { error: err.message });
    return true;
  }

  try {
    if (operation === 'revoke') {
      await identityAdapter.revokeIdentity(redisClient, identity);
      console.log('[IDENTITY-REVOKED]', identity);
    } else if (operation === 'clear') {
      await identityAdapter.clearRevocation(redisClient, identity);
      console.log('[IDENTITY-REVOCATION-CLEARED]', identity);
    } else {
      await identityAdapter.invalidateIdentityMapping(redisClient, identity);
      console.log('[IDENTITY-MAPPING-INVALIDATED]', identity);
    }

    sendJson(res, 200, { ok: true, identity });
  } catch (err) {
    console.error('[IDENTITY-REVOCATION-ERROR]', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }

  return true;
}

module.exports = { handleIdentityInternalRequest };
