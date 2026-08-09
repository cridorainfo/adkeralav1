/** Minimal CSV export — no dependency, just enough to turn an array of flat objects into a
 * downloadable file. Used by the admin panels that only ever rendered data-only tables with no
 * export path (Fleet, Users, Ads Report, Route Catalog) — see the feature-gap audit's finding on
 * this; the only export that existed anywhere was BackupPanel's full-database JSON dump, not
 * useful for finance/ops spreadsheet work. */

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** `rows` is an array of objects; `columns` is [{ key, label }] in output order. */
export function toCsv(rows, columns) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

export function downloadCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
