// Plain JS, no bundler — Capacitor auto-injects `window.Capacitor` into the WebView, so the
// native plugin is reachable directly as Capacitor.Plugins.GpsTest.* with no import step. This
// keeps the whole web layer to two static files with zero build tooling — one less thing that
// can break before a commute test even starts.
const GpsTest = () => window.Capacitor?.Plugins?.GpsTest;

const els = {
  cloudUrl: document.getElementById('cloudUrl'),
  loadRoutesBtn: document.getElementById('loadRoutesBtn'),
  routeSelect: document.getElementById('routeSelect'),
  routeInfo: document.getElementById('routeInfo'),
  direction: document.getElementById('direction'),
  goForwardBtn: document.getElementById('goForwardBtn'),
  goReverseBtn: document.getElementById('goReverseBtn'),
  running: document.getElementById('running'),
  statusPhase: document.getElementById('statusPhase'),
  statusDetail: document.getElementById('statusDetail'),
  statusMeta: document.getElementById('statusMeta'),
  stopBtn: document.getElementById('stopBtn'),
  eventLog: document.getElementById('eventLog'),
};

let routes = [];
let selectedRoute = null;
let pollTimer = null;
let lastEventCount = 0;

function cloudUrl() {
  return els.cloudUrl.value.trim().replace(/\/+$/, '');
}

async function loadRoutes() {
  els.loadRoutesBtn.disabled = true;
  els.loadRoutesBtn.textContent = 'Loading…';
  try {
    const res = await fetch(`${cloudUrl()}/api/testlab/routes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    routes = json.routes ?? [];
    els.routeSelect.innerHTML = routes.length
      ? routes.map((r) => `<option value="${r.id}">${r.name} (${r.stops.length} stops)</option>`).join('')
      : '<option value="">No test routes yet — add one in the admin Test Lab</option>';
  } catch (err) {
    els.routeSelect.innerHTML = `<option value="">Failed to load: ${err.message}</option>`;
  } finally {
    els.loadRoutesBtn.disabled = false;
    els.loadRoutesBtn.textContent = 'Load routes';
  }
}

function onRouteChange() {
  const id = els.routeSelect.value;
  selectedRoute = routes.find((r) => r.id === id) ?? null;
  if (selectedRoute) {
    els.routeInfo.textContent = selectedRoute.stops.map((s) => s.en).join(' → ');
    els.direction.classList.remove('hidden');
  } else {
    els.routeInfo.textContent = '';
    els.direction.classList.add('hidden');
  }
}

async function startTest(direction) {
  const plugin = GpsTest();
  if (!plugin) {
    alert('Native GpsTest plugin not available — this only works in the installed Android app, not a browser preview.');
    return;
  }
  if (!selectedRoute) return;

  const stops = direction === 'reverse' ? [...selectedRoute.stops].reverse() : selectedRoute.stops;

  const perms = await plugin.checkPermissions();
  if (perms.location !== 'granted') {
    const req = await plugin.requestPermissions();
    if (req.location !== 'granted') {
      alert('Location permission is required for the test to run.');
      return;
    }
  }

  await plugin.start({
    routeId: selectedRoute.id,
    routeName: selectedRoute.name,
    direction,
    cloudUrl: cloudUrl(),
    stops: JSON.stringify(stops),
  });

  document.getElementById('setup').classList.add('hidden');
  els.direction.classList.add('hidden');
  els.running.classList.remove('hidden');
  els.eventLog.innerHTML = '';
  lastEventCount = 0;
  appendEvent({ type: 'started', message: `Started — ${direction === 'reverse' ? 'Going Home' : 'Going to Office'}`, at: Date.now() });

  pollTimer = setInterval(pollStatus, 2000);
  pollStatus();
}

async function stopTest() {
  const plugin = GpsTest();
  if (plugin) await plugin.stop();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  appendEvent({ type: 'stopped', message: 'Test ended', at: Date.now() });
  els.running.classList.add('hidden');
  document.getElementById('setup').classList.remove('hidden');
}

async function pollStatus() {
  const plugin = GpsTest();
  if (!plugin) return;
  try {
    const status = await plugin.getStatus();
    renderStatus(status);
    const events = await plugin.getEvents();
    const list = JSON.parse(events.events ?? '[]');
    if (list.length > lastEventCount) {
      for (const ev of list.slice(lastEventCount)) appendEvent(ev);
      lastEventCount = list.length;
    }
  } catch {
    /* transient — next poll retries */
  }
}

function renderStatus(status) {
  els.statusPhase.textContent = status.phase ?? 'watching';
  els.statusDetail.textContent = status.detail ?? '—';
  const bits = [];
  if (status.accuracy != null) bits.push(`±${Math.round(status.accuracy)}m accuracy`);
  if (status.lastFixAt) bits.push(`last fix ${Math.round((Date.now() - status.lastFixAt) / 1000)}s ago`);
  if (status.pushCount != null) bits.push(`${status.pushCount} events synced`);
  els.statusMeta.textContent = bits.join(' · ') || '—';
}

function appendEvent(ev) {
  const div = document.createElement('div');
  div.className = `ev ${ev.type ?? ''}`;
  const time = new Date(ev.at ?? Date.now()).toLocaleTimeString();
  div.innerHTML = `<span class="t">${time}</span><span class="m">${ev.message ?? ''}</span>`;
  els.eventLog.prepend(div);
}

els.loadRoutesBtn.addEventListener('click', loadRoutes);
els.routeSelect.addEventListener('change', onRouteChange);
els.goForwardBtn.addEventListener('click', () => startTest('forward'));
els.goReverseBtn.addEventListener('click', () => startTest('reverse'));
els.stopBtn.addEventListener('click', stopTest);

loadRoutes();
