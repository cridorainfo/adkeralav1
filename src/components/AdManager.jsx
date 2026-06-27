import { useRef, useState } from 'react';
import { readMediaForAd } from '../lib/fileUtils';
import { getAdSpec } from '../lib/adSpecs';
import { uploadMediaFile } from '../lib/fileStorage';

async function uploadProcessedAdMedia(file, adFormat) {
  const category = adFormat === 'banner' ? 'banners' : 'ads';

  if (file.type.startsWith('video/')) {
    const uploaded = await uploadMediaFile(category, file, file.name);
    return {
      type: 'video',
      mediaUrl: uploaded.url,
      adFormat: getAdSpec(adFormat).id,
      width: getAdSpec(adFormat).width,
      height: getAdSpec(adFormat).height,
    };
  }

  const media = await readMediaForAd(file, adFormat);
  const blob = await (await fetch(media.mediaUrl)).blob();
  const ext = file.type.startsWith('image/') ? '.jpg' : '';
  const uploadName = file.name.replace(/\.[^.]+$/, '') + ext;
  const uploaded = await uploadMediaFile(
    category,
    new File([blob], uploadName, { type: blob.type || 'image/jpeg' }),
    uploadName
  );

  const { aspectWarning, mediaUrl, ...rest } = media;
  return { ...rest, mediaUrl: uploaded.url, aspectWarning };
}

export default function AdManager({
  ads,
  onAddAd,
  onAddAds,
  onRemoveAd,
  onUpdateAd,
  compact = false,
  adFormat = 'fullscreen',
  title = '📢 Tourism Advertisements',
  uploadHint,
  emptyHint = 'No ads yet. Upload tourism promos — they rotate automatically on the display.',
  durationLabel = 'Each ad duration (sec)',
  defaultDuration = 12,
  showAudioUpload = true,
}) {
  const spec = getAdSpec(adFormat);
  const resolvedUploadHint = uploadHint ?? spec.uploadHint;
  const mediaRef = useRef(null);
  const uploadingRef = useRef(false);
  const [duration, setDuration] = useState(defaultDuration);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadWarning, setUploadWarning] = useState(null);

  const handleMediaUpload = async (e) => {
    const input = e.currentTarget;
    const files = [...(input.files ?? [])];
    input.value = '';

    if (!files.length || uploadingRef.current) return;

    uploadingRef.current = true;
    setUploading(true);
    setUploadError(null);
    setUploadWarning(null);

    try {
      const warnings = [];
      const items = await Promise.all(
        files.map(async (file) => {
          const media = await uploadProcessedAdMedia(file, adFormat);
          if (media.aspectWarning) warnings.push(media.aspectWarning);
          const { aspectWarning, ...rest } = media;
          return {
            ...rest,
            durationSec: duration,
            audioUrl: null,
          };
        })
      );

      if (warnings.length) {
        setUploadWarning(warnings[0]);
      }

      if (onAddAds) {
        onAddAds(items);
      } else {
        items.forEach((item) => onAddAd(item));
      }
    } catch (err) {
      setUploadError(err?.message ?? 'Upload failed. Try a smaller file.');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const handleAudioUpload = async (adId, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUpdateAd) return;

    try {
      const category = adFormat === 'banner' ? 'banners' : 'ads';
      const uploaded = await uploadMediaFile(category, file, file.name);
      onUpdateAd(adId, { audioUrl: uploaded.url });
    } catch {
      setUploadError('Could not attach audio file.');
    }
  };

  return (
    <div className="panel">
      <h3 className="panel-title">{title}</h3>

      {!compact && (
        <>
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 160 }}>
              <label>{durationLabel}</label>
              <input
                type="number"
                min={3}
                max={120}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>

          <label className="upload-zone">
            <input
              ref={mediaRef}
              type="file"
              accept="image/*,video/*"
              multiple
              disabled={uploading}
              onChange={handleMediaUpload}
            />
            <div>{uploading ? '⏳ Uploading...' : '📷 Upload Images or Videos'}</div>
            <small style={{ color: 'var(--kerala-muted)', marginTop: '0.5rem', display: 'block' }}>
              {resolvedUploadHint}
            </small>
            <small className="ad-spec-badge">{spec.resolutionLabel}</small>
          </label>

          {uploadError && (
            <p className="upload-error" role="alert">
              {uploadError}
            </p>
          )}
          {uploadWarning && (
            <p className="upload-warning" role="status">
              {uploadWarning}
            </p>
          )}
        </>
      )}

      {ads.length > 0 ? (
        <div className="ad-grid" style={{ marginTop: compact ? 0 : '1rem' }}>
          {ads.map((ad, index) => (
            <div key={ad.id} className="ad-card">
              <button type="button" className="ad-card-remove" onClick={() => onRemoveAd(ad.id)}>
                ✕
              </button>
              <div className={`ad-card-preview ad-card-preview--${adFormat}`}>
                {ad.type === 'video' ? (
                  <video src={ad.mediaUrl} muted />
                ) : (
                  <img src={ad.mediaUrl} alt="" />
                )}
              </div>
              <div className="ad-card-info">
                <strong>Ad {index + 1}</strong>
                <small>
                  {ad.type === 'video' ? 'Video' : 'Image'} · {spec.resolutionLabel} · {ad.durationSec}s
                  {ad.audioUrl ? ' · 🔊 audio' : ''}
                </small>
                {!compact && showAudioUpload && (
                  <label
                    style={{
                      display: 'block',
                      marginTop: '0.35rem',
                      cursor: 'pointer',
                      color: 'var(--kerala-teal)',
                    }}
                  >
                    + Add audio
                    <input
                      type="file"
                      accept="audio/*"
                      style={{ display: 'none' }}
                      onChange={(e) => handleAudioUpload(ad.id, e)}
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--kerala-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
          {emptyHint}
        </p>
      )}
    </div>
  );
}
