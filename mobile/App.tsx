import React, { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { colors } from './src/theme';
import { setupIAP, loadProducts, teardownIAP } from './src/services/iap';
import GeoRestrictedScreen from './src/screens/game/GeoRestrictedScreen';

import LoginScreen from './src/screens/auth/LoginScreen';
import SignUpScreen from './src/screens/auth/SignUpScreen';
import VerifyEmailScreen from './src/screens/auth/VerifyEmailScreen';
import ForgotPasswordScreen from './src/screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/auth/ResetPasswordScreen';
import WaiverScreen from './src/screens/game/WaiverScreen';
import MainTabs from './src/navigation/MainTabs';
import HelpSupportScreen from './src/screens/game/HelpSupportScreen';

const AuthStackNav = createNativeStackNavigator();
const AppStackNav = createNativeStackNavigator();

const DarkTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.secondary,
  },
};

function AuthStack() {
  return (
    <AuthStackNav.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <AuthStackNav.Screen name="Login" component={LoginScreen} />
      <AuthStackNav.Screen name="SignUp" component={SignUpScreen} />
      <AuthStackNav.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      <AuthStackNav.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <AuthStackNav.Screen name="ResetPassword" component={ResetPasswordScreen} />
    </AuthStackNav.Navigator>
  );
}

function MainStack() {
  return (
    <AppStackNav.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '900',
          letterSpacing: 2,
          fontSize: 14,
        },
        animation: 'slide_from_right',
      }}
    >
      <AppStackNav.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <AppStackNav.Screen
        name="HelpSupport"
        component={HelpSupportScreen}
        options={{
          title: 'HELP & SUPPORT',
          headerBackTitle: 'Back',
        }}
      />
    </AppStackNav.Navigator>
  );
}

function LoadingScreen() {
  // Mirrors the native splash (same gold "C" logo on the same background) so the
  // handoff from the native splash to this screen is seamless — no flash/overlap
  // of the logo and wordmark on cold launch.
  return (
    <View style={styles.loadingContainer}>
      <Image
        source={require('./assets/splash-icon.png')}
        style={styles.loadingLogo}
        resizeMode="contain"
      />
      <Text style={styles.loadingTitle}>COINPROWL</Text>
      <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 22 }} />
    </View>
  );
}

function AppNavigator() {
  const { isAuthenticated, isLoading, user, refreshUser } = useAuth();

  if (isLoading) return <LoadingScreen />;

  if (isAuthenticated && user && !user.waiverAcceptedAt) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar style="light" />
        <WaiverScreen onAccepted={refreshUser} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={DarkTheme}>
      {isAuthenticated ? (
        <GeoRestrictedScreen>
          <MainStack />
        </GeoRestrictedScreen>
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    setupIAP().then(() => loadProducts());
    return () => { teardownIAP(); };
  }, []);

  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    width: 96,
    height: 96,
    marginBottom: 20,
  },
  loadingTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 5,
  },
});
