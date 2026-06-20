import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';

const RESTRICTED_STATES = [
  'Arizona',
  'Arkansas',
  'Connecticut',
  'Delaware',
  'Louisiana',
  'Montana',
  'South Carolina',
  'South Dakota',
  'Tennessee',
];

const RESTRICTED_ABBREVS = [
  'AZ', 'AR', 'CT', 'DE', 'LA', 'MT', 'SC', 'SD', 'TN',
];

type GeoStatus = 'checking' | 'allowed' | 'restricted' | 'no_permission' | 'error' | 'outside_us';

interface Props {
  children: React.ReactNode;
}

export default function GeoRestrictedScreen({ children }: Props) {
  const [status, setStatus] = useState<GeoStatus>('checking');
  const [stateName, setStateName] = useState<string>('');

  const checkLocation = async () => {
    setStatus('checking');
    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        setStatus('no_permission');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const [geocode] = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (!geocode) {
        setStatus('error');
        return;
      }

      const country = geocode.isoCountryCode || geocode.country || '';
      if (country !== 'US' && country !== 'United States') {
        setStateName(geocode.country || country);
        setStatus('outside_us');
        return;
      }

      const region = geocode.region || '';
      const isRestricted =
        RESTRICTED_STATES.some(s => region.toLowerCase() === s.toLowerCase()) ||
        RESTRICTED_ABBREVS.some(a => region.toUpperCase() === a);

      if (isRestricted) {
        setStateName(region);
        setStatus('restricted');
      } else {
        setStatus('allowed');
      }
    } catch (err) {
      console.error('Geo check error:', err);
      setStatus('error');
    }
  };

  useEffect(() => {
    checkLocation();
  }, []);

  if (status === 'allowed') {
    return <>{children}</>;
  }

  if (status === 'checking') {
    return (
      <View style={styles.container}>
        <Ionicons name="location" size={48} color={colors.primary} />
        <Text style={styles.title}>VERIFYING LOCATION</Text>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
        <Text style={styles.subtitle}>Checking your region...</Text>
      </View>
    );
  }

  if (status === 'restricted') {
    return (
      <View style={styles.container}>
        <Ionicons name="ban" size={64} color={colors.secondary} />
        <Text style={styles.title}>NOT AVAILABLE</Text>
        <Text style={styles.message}>
          CoinProwl is not currently available in {stateName} due to local regulations regarding skill-based gaming.
        </Text>
        <Text style={styles.submessage}>
          We're working to expand availability. Check back soon!
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={checkLocation}>
          <Ionicons name="refresh" size={20} color={colors.text} />
          <Text style={styles.retryText}>Check Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'outside_us') {
    return (
      <View style={styles.container}>
        <Ionicons name="globe-outline" size={64} color={colors.warning} />
        <Text style={styles.title}>NOT AVAILABLE</Text>
        <Text style={styles.message}>
          CoinProwl is currently only available in the United States.
        </Text>
        <Text style={styles.submessage}>
          We're working to expand to more countries. Stay tuned!
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={checkLocation}>
          <Ionicons name="refresh" size={20} color={colors.text} />
          <Text style={styles.retryText}>Check Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'no_permission') {
    return (
      <View style={styles.container}>
        <Ionicons name="location-outline" size={64} color={colors.warning} />
        <Text style={styles.title}>LOCATION REQUIRED</Text>
        <Text style={styles.message}>
          CoinProwl requires location access to verify you're in an eligible region. Please enable location permissions to continue.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={checkLocation}>
          <Ionicons name="refresh" size={20} color={colors.text} />
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Ionicons name="warning-outline" size={64} color={colors.warning} />
      <Text style={styles.title}>LOCATION ERROR</Text>
      <Text style={styles.message}>
        We couldn't determine your location. Please make sure location services are enabled and try again.
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={checkLocation}>
        <Ionicons name="refresh" size={20} color={colors.text} />
        <Text style={styles.retryText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 4,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 24,
  },
  submessage: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  retryText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
