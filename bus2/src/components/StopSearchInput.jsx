import { normalizeStop } from '../store/busStore';

export default function StopSearchInput({
  id,
  label,
  value,
  onValueChange,
  suggestions = [],
  loading = false,
  isOpen = false,
  onFocus,
  onPick,
  placeholder = 'Search library or type new name…',
}) {
  return (
    <div className="form-group stop-autocomplete-wrap">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading && isOpen && value.trim() && (
        <small className="stop-search-loading">Searching library…</small>
      )}
      {isOpen && suggestions.length > 0 && value.trim() && (
        <ul className="stop-autocomplete-list" role="listbox">
          {suggestions.map((s) => {
            const n = normalizeStop(s);
            return (
              <li key={`${id}-${n.en}`}>
                <button type="button" onClick={() => onPick(n)}>
                  {n.en}
                  {n.ml ? ` · ${n.ml}` : ''}
                  {n.lat != null ? ' 📍' : ''}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
