import { Capacitor } from '@capacitor/core';

let channelReady = false;

async function ensureChannel() {
  if (channelReady || Capacitor.getPlatform() !== 'android') return;
  const { ForegroundService } = await import(
    '@capawesome-team/capacitor-android-foreground-service'
  );
  try {
    await ForegroundService.createNotificationChannel({
      id: 'adkerala_gps',
      name: 'GPS tracking',
      description: 'Keeps live location active for the fleet map',
      importance: 3,
    });
  } catch {
    /* channel may already exist */
  }
  channelReady = true;
}

export async function startAndroidTrackingService() {
  if (Capacitor.getPlatform() !== 'android') return;
  await ensureChannel();
  const { ForegroundService } = await import(
    '@capawesome-team/capacitor-android-foreground-service'
  );
  await ForegroundService.startForegroundService({
    id: 1001,
    title: 'AdKerala Driver',
    body: 'Live GPS tracking active',
    smallIcon: 'ic_launcher',
    notificationChannelId: 'adkerala_gps',
    serviceType: 8,
    silent: true,
  });
}

export async function stopAndroidTrackingService() {
  if (Capacitor.getPlatform() !== 'android') return;
  const { ForegroundService } = await import(
    '@capawesome-team/capacitor-android-foreground-service'
  );
  try {
    await ForegroundService.stopForegroundService();
  } catch {
    /* ignore */
  }
}
