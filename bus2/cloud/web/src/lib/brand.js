export const APP_NAME = 'AdKerala';
export const LOGO_SRC = '/adkerala-logo.png';
export const APP_TAGLINE = "God's Own Country — Bus Route & Advertising";

export const ROLE_LABELS = {
  admin: 'Platform Admin',
  bus_owner: 'Bus Owner',
  driver: 'Driver',
  advertiser: 'Advertiser',
};

export function dashboardPathForRole(role) {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'bus_owner':
      return '/owner';
    case 'advertiser':
      return '/advertiser';
    case 'driver':
      return '/driver/portal';
    default:
      return '/';
  }
}
