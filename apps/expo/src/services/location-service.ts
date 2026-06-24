import * as Location from 'expo-location';

export interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export async function checkLocationPermission(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === 'granted';
}

export async function requestLocationPermission(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return bgStatus === 'granted';
}

export async function getCurrentLocation(): Promise<LocationResult | null> {
  try {
    const hasPermission = await checkLocationPermission();
    if (!hasPermission) {
      console.warn('Location permission not granted. Cannot capture GPS.');
      return null;
    }

    // Timeout of 10s to not block headless task indefinitely
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000));
    const locationPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const location = await Promise.race([locationPromise, timeoutPromise]);

    if (!location) {
      console.warn('Location request timed out.');
      return null;
    }

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
    };
  } catch (error) {
    console.error('Error fetching location:', error);
    return null;
  }
}
