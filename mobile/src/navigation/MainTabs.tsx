import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import MapScreen from '../screens/game/MapScreen';
import WalletScreen from '../screens/game/WalletScreen';
import RanksScreen from '../screens/game/RanksScreen';
import ProfileScreen from '../screens/game/ProfileScreen';
import PlayOnPhoneScreen from '../web/PlayOnPhoneScreen';
import { isWeb, isPhoneBrowser } from '../web/platform';

// a computer browser gets everything but the map (see PlayOnPhoneScreen)
const MapTab = isWeb && !isPhoneBrowser() ? PlayOnPhoneScreen : MapScreen;

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          // @ts-ignore web only
          ...(Platform.OS === 'web' ? { boxShadow: 'none' } : {}),
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '900',
          letterSpacing: 2,
          fontSize: 14,
        },
        tabBarStyle: {
          backgroundColor: '#111827',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          // website: the browser's default 49 px left the labels 4 px tall; the iPhone notch / home bar are padded
          // around the whole page in the web index.html (env(safe-area-inset-*)), not here
          height: Platform.OS === 'ios' ? 82 : Platform.OS === 'web' ? 64 : 62,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#4b5563',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 1,
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'home';

          if (route.name === 'Map') {
            iconName = focused ? 'locate' : 'locate-outline';
          } else if (route.name === 'Wallet') {
            iconName = focused ? 'cash' : 'cash-outline';
          } else if (route.name === 'Ranks') {
            iconName = focused ? 'ribbon' : 'ribbon-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return (
            <View style={focused ? styles.activeIconWrapper : undefined}>
              <Ionicons name={iconName} size={size} color={color} />
            </View>
          );
        },
      })}
    >
      <Tab.Screen
        name="Map"
        component={MapTab}
        options={{
          headerShown: false,
          tabBarLabel: 'MAP',
        }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{
          title: 'WALLET',
          tabBarLabel: 'WALLET',
        }}
      />
      <Tab.Screen
        name="Ranks"
        component={RanksScreen}
        options={{
          title: 'RANKS',
          tabBarLabel: 'RANKS',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'PROFILE',
          tabBarLabel: 'PROFILE',
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  activeIconWrapper: {
    // @ts-ignore web
    ...(Platform.OS === 'web' ? {
      filter: `drop-shadow(0 0 6px ${colors.primary})`,
    } : {}),
  },
});
