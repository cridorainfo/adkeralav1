const CHANNEL_NAME = 'kerala-bus-fullscreen';

let channel = null;

function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

export function postBrowserFullscreenEnter() {
  getChannel()?.postMessage({ type: 'ENTER_BROWSER_FULLSCREEN' });
}

export function postBrowserFullscreenExit() {
  getChannel()?.postMessage({ type: 'EXIT_BROWSER_FULLSCREEN' });
}

export function subscribeBrowserFullscreen(onEnter, onExit) {
  const ch = getChannel();
  if (!ch) return () => {};

  const handler = (e) => {
    if (e.data?.type === 'ENTER_BROWSER_FULLSCREEN') onEnter?.();
    if (e.data?.type === 'EXIT_BROWSER_FULLSCREEN') onExit?.();
  };

  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}

export function requestBrowserFullscreen() {
  if (document.fullscreenElement || isLikelyBrowserFullscreen()) return Promise.resolve();

  const el = document.documentElement;
  if (!el.requestFullscreen) return Promise.resolve();

  try {
    return el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    return el.requestFullscreen().catch(() => {});
  }
}

export function exitBrowserFullscreen() {
  if (!document.fullscreenElement) return Promise.resolve();
  return document.exitFullscreen?.().catch(() => {});
}

export function isDocumentFullscreen() {
  return Boolean(document.fullscreenElement);
}

/** True when the page fills the screen (F11 launch or Fullscreen API). */
export function isLikelyBrowserFullscreen() {
  if (document.fullscreenElement) return true;
  return window.innerHeight >= screen.height - 80 && window.innerWidth >= screen.width - 80;
}
