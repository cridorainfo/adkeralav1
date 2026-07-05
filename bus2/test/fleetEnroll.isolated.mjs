import assert from 'node:assert/strict';
import {
  enrollDevice,
  getEnrollmentStatus,
  acknowledgeEnrollment,
  claimBusByCode,
  listPendingEnrollments,
} from '../cloud/fleet.js';

const installId = 'a1111111-1111-4111-8111-111111111111';
const code = '482913';

const enroll = await enrollDevice({ installId, fleetClaimCode: code, appVersion: 'test' });
assert.equal(enroll.ok, true);

let pending = await listPendingEnrollments();
assert.equal(pending.length, 1);

const claim = await claimBusByCode({
  fleetClaimCode: code,
  plate: 'KL 01 AB 1234',
  ownerId: 'owner-test',
  admin: true,
});
assert.equal(claim.ok, true);
assert.ok(claim.deviceToken);

pending = await listPendingEnrollments();
assert.equal(pending.length, 0);

const first = await getEnrollmentStatus(installId);
assert.equal(first.claimed, true);
assert.equal(first.deviceToken, claim.deviceToken);

const second = await getEnrollmentStatus(installId);
assert.equal(second.deviceToken, claim.deviceToken);

await acknowledgeEnrollment(installId);

const afterAck = await getEnrollmentStatus(installId);
assert.equal(afterAck.claimed, true);
assert.equal(afterAck.deviceToken, undefined);

console.log('fleetEnroll.isolated ok');
