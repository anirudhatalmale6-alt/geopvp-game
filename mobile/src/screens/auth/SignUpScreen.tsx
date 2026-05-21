import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius, fonts } from '../../theme';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';

interface Props {
  navigation: any;
}

interface PasswordRequirement {
  label: string;
  met: boolean;
}

export default function SignUpScreen({ navigation }: Props) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordRequirements: PasswordRequirement[] = useMemo(
    () => [
      { label: 'At least 8 characters', met: password.length >= 8 },
      { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
      { label: 'One number or symbol', met: /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) },
    ],
    [password]
  );

  const allRequirementsMet = passwordRequirements.every((r) => r.met);

  const handleSignUp = async () => {
    setError('');

    if (!username.trim()) {
      setError('Hunter name is required');
      return;
    }
    if (username.trim().length < 3) {
      setError('Hunter name must be at least 3 characters');
      return;
    }
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!allRequirementsMet) {
      setError('Password does not meet all requirements');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Sign up failed');
      }

      navigation.navigate('VerifyEmail', { email: email.trim().toLowerCase() });
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerArea}>
          <View style={styles.iconCircle}>
            <Ionicons name="person-add" size={44} color={colors.primary} />
          </View>
          <Text style={styles.headerTitle}>JOIN THE HUNT</Text>
          <Text style={styles.headerSubtitle}>Create your account and start tracking</Text>
        </View>

        {/* Form Card */}
        <View style={styles.formCard}>
          {/* Username Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={20} color={colors.primary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Choose a hunter name"
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          {/* Email Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={20} color={colors.primary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          {/* Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.primary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              editable={!loading}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Confirm Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.primary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              placeholderTextColor={colors.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              editable={!loading}
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              style={styles.eyeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Password Requirements Box */}
          <View style={styles.requirementsBox}>
            <Text style={styles.requirementsTitle}>PASSWORD REQUIREMENTS</Text>
            {passwordRequirements.map((req, index) => (
              <View key={index} style={styles.requirementRow}>
                <Ionicons
                  name={req.met ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={req.met ? colors.success : colors.textMuted}
                />
                <Text style={[styles.requirementText, req.met && styles.requirementMet]}>
                  {req.label}
                </Text>
              </View>
            ))}
          </View>

          {/* Error Message */}
          {error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Sign Up Button */}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Text style={styles.buttonText}>SIGN UP</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login Link */}
        <View style={styles.bottomLink}>
          <Text style={styles.bottomText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.bottomLinkText}>Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  headerArea: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    ...fonts.headingLarge,
    color: colors.primary,
    textAlign: 'center',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerSubtitle: {
    fontSize: fontSize.md,
    ...fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    paddingVertical: spacing.md,
    ...fonts.body,
  },
  eyeButton: {
    padding: spacing.xs,
  },
  requirementsBox: {
    backgroundColor: colors.accentDim,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: '#7c4dff30',
  },
  requirementsTitle: {
    fontSize: fontSize.xs,
    ...fonts.headingLarge,
    color: colors.accent,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  requirementText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
    ...fonts.body,
  },
  requirementMet: {
    color: colors.success,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondaryDim,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
    flex: 1,
    ...fonts.body,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.background,
    fontSize: fontSize.lg,
    ...fonts.headingLarge,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  bottomLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  bottomText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    ...fonts.body,
  },
  bottomLinkText: {
    color: colors.primary,
    fontSize: fontSize.md,
    ...fonts.bodyBold,
  },
});
