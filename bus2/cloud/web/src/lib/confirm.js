/** Two sequential native confirms, for destructive actions that can't be undone (deleting a
 * file off the Railway volume, deleting a whole campaign) — everywhere else in this app a single
 * window.confirm() is enough, but a slip on those two shouldn't be one click away. */
export function doubleConfirm(message, finalMessage = 'This cannot be undone. Delete it anyway?') {
  if (!window.confirm(message)) return false;
  return window.confirm(finalMessage);
}
