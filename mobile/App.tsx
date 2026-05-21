import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { colors } from './src/theme';

import LoginScreen from './src/screens/auth/LoginScreen';
import SignUpScreen from './src/screens/auth/SignUpScreen';
import VerifyEmailScreen from './src/screens/auth/VerifyEmailScreen';
import ForgotPasswordScreen from './src/screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/auth/ResetPasswordScreen';
import MainTabs from './src/navigation/MainTabs';

const AuthStackNav = createNativeStackNavigator();

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
  return <MainTabs />;
}

function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <Text style={styles.loadingTitle}>GEOPVP</Text>
      <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
    </View>
  );
}

function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;

  return (
    <NavigationContainer theme={DarkTheme}>
      {isAuthenticated ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}

export default function App() {
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
  loadingTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 6,
  },
});
