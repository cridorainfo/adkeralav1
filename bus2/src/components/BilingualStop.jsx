import { createContext, useContext, useEffect, useState } from 'react';
import { normalizeStop } from '../store/busStore';

const LanguageAlternateContext = createContext(null);

/** Wall-clock phase keeps display tabs in sync. Even phases show Malayalam first. */
export function getLanguagePhase(intervalSec) {
  const sec = Math.max(1, intervalSec ?? 4);
  return Math.floor(Date.now() / (sec * 1000)) % 2 === 0 ? 'ml' : 'en';
}

export function LanguageAlternateProvider({ intervalSec = 4, children }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [intervalSec]);

  const activeLang = getLanguagePhase(intervalSec);

  return (
    <LanguageAlternateContext.Provider value={{ activeLang, intervalSec }}>
      {children}
    </LanguageAlternateContext.Provider>
  );
}

export function BilingualStop({
  stop,
  className = '',
  size = 'md',
  mode = 'both',
  as: Tag = 'span',
}) {
  const { en, ml } = normalizeStop(stop);
  const alternate = useContext(LanguageAlternateContext);
  const useAlternate = mode === 'alternate' && alternate;

  if (!en && !ml) return '—';

  if (useAlternate && en && ml) {
    const activeLang = alternate.activeLang;
    const text = activeLang === 'ml' ? ml : en;
    const langClass = activeLang === 'ml' ? 'bilingual-stop-ml' : 'bilingual-stop-en';

    return (
      <Tag
        className={`bilingual-stop bilingual-stop--${size} bilingual-stop--alternate ${className}`.trim()}
        key={activeLang}
      >
        <span className={`${langClass} bilingual-stop-active`}>{text}</span>
      </Tag>
    );
  }

  if (useAlternate) {
    const text = ml || en;
    const langClass = ml ? 'bilingual-stop-ml' : 'bilingual-stop-en';
    return (
      <Tag className={`bilingual-stop bilingual-stop--${size} bilingual-stop--alternate ${className}`.trim()}>
        <span className={langClass}>{text}</span>
      </Tag>
    );
  }

  return (
    <Tag className={`bilingual-stop bilingual-stop--${size} ${className}`.trim()}>
      {ml && <span className="bilingual-stop-ml">{ml}</span>}
      {en && <span className="bilingual-stop-en">{en}</span>}
    </Tag>
  );
}
