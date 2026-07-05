/** Server-authoritative bus profile — control phones must not wipe fleet fields. */
export function mergeBusProfile(currentProfile = {}, incomingProfile = {}, options = {}) {
  const cur = currentProfile ?? {};
  const inc = incomingProfile ?? {};
  const merged = { ...cur, ...inc };

  const curIds = Array.isArray(cur.assignedRouteIds) ? cur.assignedRouteIds : [];
  const incIds = Array.isArray(inc.assignedRouteIds) ? inc.assignedRouteIds : [];

  if (curIds.length) {
    merged.assignedRouteIds = curIds;
  } else if (incIds.length) {
    merged.assignedRouteIds = incIds;
  } else {
    merged.assignedRouteIds = [];
  }

  if (options.forcePairingCode && inc.pairingCode) {
    merged.pairingCode = inc.pairingCode;
  } else if (cur.pairingCode) {
    merged.pairingCode = cur.pairingCode;
  } else if (inc.pairingCode) {
    merged.pairingCode = inc.pairingCode;
  }

  if (cur.plate) merged.plate = cur.plate;
  else if (inc.plate) merged.plate = inc.plate;

  if (cur.plateDisplay) merged.plateDisplay = cur.plateDisplay;
  else if (inc.plateDisplay) merged.plateDisplay = inc.plateDisplay;

  if (cur.displayName) merged.displayName = cur.displayName;
  else if (inc.displayName) merged.displayName = inc.displayName;

  if (cur.driverControlOtp) merged.driverControlOtp = cur.driverControlOtp;
  if (cur.driverControlOtpUpdatedAt) {
    merged.driverControlOtpUpdatedAt = cur.driverControlOtpUpdatedAt;
  }

  return merged;
}
