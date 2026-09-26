'use strict';

const MOVE_THRESHOLD_M = 3;

function distanceMeters(p1, p2) {
  const dx = (p2.lng - p1.lng) * 111320;
  const dy = (p2.lat - p1.lat) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

function evaluatePositionTransition(previousPoint, candidatePoint) {
  if (typeof candidatePoint.serverTs !== 'number') {
    return { accepted: false, reason: 'invalid_server_ts' };
  }

  const serverTs = Date.now();

  if (
    previousPoint &&
    typeof previousPoint.serverTs === 'number' &&
    serverTs <= previousPoint.serverTs
  ) {
    return { accepted: false, reason: 'out_of_order' };
  }

  if (!previousPoint) {
    return { accepted: true, serverTs, moved: null };
  }

  const dt = (serverTs - previousPoint.serverTs) / 1000;

  const dist = distanceMeters(
    { lat: previousPoint.lat, lng: previousPoint.lng },
    { lat: candidatePoint.lat, lng: candidatePoint.lng }
  );

  if (dt > 0) {
    const speed = dist / dt;
    if (speed > 60) {
      return {
        accepted: false,
        reason: 'unrealistic_speed',
        speed
      };
    }
  }

  return {
    accepted: true,
    serverTs,
    moved: dist > MOVE_THRESHOLD_M
  };
}

module.exports = {
  evaluatePositionTransition
};
