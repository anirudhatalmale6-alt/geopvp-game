import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api } from '../api/client';

const BACKGROUND_LOCATION_TASK = 'coinprowl-background-location';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) return;
  if (data) {
    const { locations } = data;
    const loc = locations?.[0];
    if (!loc) return;
    try {
      await api.post('/game/location', {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch {}
  }
});

export async function startBackgroundLocation(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return false;

  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isStarted) return true;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 10000,
    distanceInterval: 10,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'CoinProwl',
      notificationBody: 'Tracking your position on the map',
      notificationColor: '#00e5ff',
    },
  });

  return true;
}

export async function stopBackgroundLocation(): Promise<void> {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
