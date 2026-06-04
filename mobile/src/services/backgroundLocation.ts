import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api } from '../api/client';

const BACKGROUND_LOCATION_TASK = 'coinprowl-background-location';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) {
    console.log('[BgLoc] Task error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    if (!locations?.length) return;
    const loc = locations[locations.length - 1];
    try {
      await api.post('/game/sessions/location', {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch (err: any) {
      console.log('[BgLoc] Update failed:', err.message);
    }
  }
});

export async function startBackgroundLocation(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;

  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') {
    console.log('[BgLoc] Background permission denied');
    return false;
  }

  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 1,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    foregroundService: {
      notificationTitle: 'CoinProwl',
      notificationBody: 'Your position is live on the map',
      notificationColor: '#00e5ff',
    },
  });

  console.log('[BgLoc] Background location started');
  return true;
}

export async function stopBackgroundLocation(): Promise<void> {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
