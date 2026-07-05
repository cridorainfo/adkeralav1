const url = "http://127.0.0.1:5174/api/state";
let last = "";
async function tick() {
  try {
    const res = await fetch(url);
    const json = await res.json();
    const s = json.data ?? {};
    const route = (s.routes ?? []).find(r => r.id === s.activeRouteId);
    const snap = {
      tripStarted: Boolean(s.tripStarted),
      tripEnded: Boolean(s.tripEnded),
      tripDeparted: Boolean(s.tripDeparted),
      stopIndex: s.currentStopIndex ?? 0,
      driveRevision: s.driveRevision ?? 0,
      activeRouteId: s.activeRouteId ?? null,
      routeName: route?.name ?? null,
      routesCount: (s.routes ?? []).length,
      assignedRouteIds: s.busProfile?.assignedRouteIds ?? [],
      driverLink: s.driverLink?.driverId ?? null,
      connectedDeviceCount: s.connectedDeviceCount ?? 0,
      savedAt: s.savedAt ?? 0,
      direction: s.routeDirection ?? "forward",
    };
    const line = JSON.stringify(snap);
    if (line !== last) {
      last = line;
      console.log(JSON.stringify({ at: new Date().toISOString(), ...snap }));
    }
  } catch (err) {
    console.log(JSON.stringify({ at: new Date().toISOString(), error: err.message }));
  }
}
setInterval(tick, 1500);
tick();
