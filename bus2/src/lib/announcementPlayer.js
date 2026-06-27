let activeController = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playOne(url, signal) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    const cleanup = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      audio.pause();
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);

    audio.play().catch(onError);
  });
}

/**
 * Play a sequence of audio URLs and optional pause markers.
 * Cancels any in-flight sequence when a new one starts.
 */
export async function playAnnouncementSequence(sequence, { onStart, onEnd, onFragment } = {}) {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;

  onStart?.();

  try {
    for (const item of sequence) {
      if (controller.signal.aborted) break;

      if (typeof item === 'object' && item.pause) {
        await wait(item.pause);
        continue;
      }

      if (typeof item === 'string' && item) {
        onFragment?.(item);
        await playOne(item, controller.signal);
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') throw err;
  } finally {
    if (activeController === controller) {
      activeController = null;
      onEnd?.();
    }
  }
}

export function cancelAnnouncement() {
  activeController?.abort();
  activeController = null;
}
