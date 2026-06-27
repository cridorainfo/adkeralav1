import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToDataUrl, readFileAsDataUrl } from '../lib/fileUtils';

export default function VoiceRecorder({
  label,
  audioUrl,
  onSave,
  onClear,
  compact = false,
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => {
    return () => {
      mediaRef.current?.stream?.getTracks().forEach((t) => t.stop());
      clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          const dataUrl = await blobToDataUrl(blob);
          onSave?.(dataUrl);
        }
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    } catch {
      alert('Microphone access denied. Upload an audio file instead.');
    }
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    setRecording(false);
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.stop();
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    onSave?.(dataUrl);
    e.target.value = '';
  };

  const playPreview = () => {
    if (!audioUrl || !previewRef.current) return;
    previewRef.current.src = audioUrl;
    previewRef.current.play().catch(() => {});
  };

  return (
    <div className={`voice-recorder ${compact ? 'voice-recorder-compact' : ''}`}>
      <audio ref={previewRef} />
      {label && <span className="voice-recorder-label">{label}</span>}
      <div className="voice-recorder-actions">
        {!recording ? (
          <button type="button" className="btn btn-ghost voice-btn-record" onClick={startRecording}>
            🎙 Record
          </button>
        ) : (
          <button type="button" className="btn btn-danger voice-btn-stop" onClick={stopRecording}>
            ⏹ Stop ({elapsed}s)
          </button>
        )}
        <label className="btn btn-ghost voice-btn-upload">
          📁 Upload
          <input type="file" accept="audio/*" hidden onChange={handleUpload} />
        </label>
        {audioUrl && (
          <>
            <button type="button" className="btn btn-ghost voice-btn-play" onClick={playPreview}>
              ▶
            </button>
            <button type="button" className="btn btn-ghost voice-btn-clear" onClick={onClear}>
              ✕
            </button>
          </>
        )}
      </div>
      {audioUrl && <span className="voice-recorder-status">🔊 saved</span>}
    </div>
  );
}
