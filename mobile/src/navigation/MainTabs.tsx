import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import MapScreen from '../screens/game/MapScreen';
import WalletScreen from '../screens/game/WalletScreen';
import ProfileScreen from '../screens/game/ProfileScreen';

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
          height: Platform.OS === 'ios' ? 82 : 62,
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
        component={MapScreen}
        options={{
          title: 'BATTLEFIELD',
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
