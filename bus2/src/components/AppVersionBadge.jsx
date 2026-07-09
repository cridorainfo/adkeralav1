import { APP_VERSION } from '../lib/version';

/** Small, unobtrusive build version marker on the passenger screen. */
export default function AppVersionBadge() {
  return (
    <div className="app-version-badge" aria-hidden>
      v{APP_VERSION}
    </div>
  );
}
