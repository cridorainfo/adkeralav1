import { fleetBroadcast } from './api.js';

export function basename(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts[parts.length - 1] || path;
}

/** Queue MERGE_STATE on selected buses after catalog audio change. */
export async function pushAudioMergeToBuses({
  targetBusIds,
  stopAudio,
  audioFragments,
  mediaFiles = [],
  removedMediaFiles = [],
}) {
  if (!targetBusIds?.length) return null;
  const payload = {};
  if (stopAudio) payload.stopAudio = stopAudio;
  if (audioFragments) payload.audioFragments = audioFragments;
  if (mediaFiles.length) payload.mediaFiles = mediaFiles;
  if (removedMediaFiles.length) payload.removedMediaFiles = removedMediaFiles;
  if (!Object.keys(payload).length) return null;
  return fleetBroadcast({
    targetBusIds,
    commandType: 'MERGE_STATE',
    payload,
  });
}
