import { useEffect } from 'react';

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function useAppViewHotkeys({ enterDisplayMode, exitToControl }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;

      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        enterDisplayMode();
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        exitToControl();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterDisplayMode, exitToControl]);
}
