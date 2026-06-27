import { useEffect } from 'react';

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function useFullscreenHotkey(onToggle) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'F11') {
        e.preventDefault();
        onToggle();
        return;
      }
      if (e.key === 'f' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        onToggle();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);
}
