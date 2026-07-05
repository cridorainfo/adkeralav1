import { adMediaPreviewUrl } from '../lib/adMedia.js';

export default function AdMediaPreview({
  ad,
  format = 'fullscreen',
  playing = false,
  showControls = false,
  className = '',
}) {
  const src = adMediaPreviewUrl(ad?.mediaFile);
  const label = ad?.name?.trim() || ad?.mediaFile?.split('/').pop() || 'Ad';

  if (!src) {
    return (
      <div className={`ad-media-preview ad-media-preview--${format} ad-media-preview--empty ${className}`.trim()}>
        <span>No media</span>
      </div>
    );
  }

  const isVideo = ad?.type === 'video';

  return (
    <div
      className={`ad-media-preview ad-media-preview--${format}${playing ? ' ad-media-preview--playing' : ''} ${className}`.trim()}
    >
      {playing && <span className="ad-media-preview-badge">Now playing</span>}
      {isVideo ? (
        <video src={src} muted playsInline controls={showControls} preload="metadata" />
      ) : (
        <img src={src} alt={label} loading="lazy" />
      )}
    </div>
  );
}
