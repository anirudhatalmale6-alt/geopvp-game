import React, { useState, useRef, useMemo, useCallback } from 'react';
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
const CODE_LENGTH = 6;

interface Props {
  navigation: any;
  route?: { params?: { email?: string } };
}

interface PasswordRequirement {
  label: string;
  met: boolean;
}

export default function ResetPasswordScreen({ navigation, route }: Props) {
  const email = route?.params?.email || '';
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const inputRefs = useRef<(TextInput | null)[]>([]);

  const passwordRequirements: PasswordRequirement[] = useMemo(
    () => [
      { label: 'At least 8 characters', met: newPassword.length >= 8 },
      { label: 'One uppercase letter', met: /[A-Z]/.test(newPassword) },
      { label: 'One number or symbol', met: /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword) },
    ],
    [newPassword]
  );

  const allRequirementsMet = passwordRequirements.every((r) => r.met);

  const handleCodeChange = useCallback(
    (value: string, index: number) => {
      const digit = value.replace(/[^0-9]/g, '');

      if (digit.length <= 1) {
        const newCode = [...code];
        newCode[index] = digit;
        setCode(newCode);

        if (digit && index < CODE_LENGTH - 1) {
          inputRefs.current[index + 1]?.focus();
        }
      } else if (digit.length > 1) {
        // Handle paste
        const digits = digit.split('').slice(0, CODE_LENGTH - index);
        const newCode = [...code];
        digits.forEach((d, i) => {
          if (index + i < CODE_LENGTH) {
            newCode[index + i] = d;
          }
        });
        setCode(newCode);
        const nextIndex = Math.min(index + digits.length, CODE_LENGTH - 1);
        inputRefs.current[nextIndex]?.focus();
      }
    },
    [code]
  );

  const handleKeyPress = useCallback(
    (key: string, index: number) => {
      if (key === 'Backspace' && !code[index] && index > 0) {
        const newCode = [...code];
        newCode[index - 1] = '';
        setCode(newCode);
        inputRefs.current[index - 1]?.focus();
      }
    },
    [code]
  );

  const handleResetPassword = async () => {
    setError('');

    const fullCode = code.join('');
    if (fullCode.length !== CODE_LENGTH) {
      setError('Please enter the complete 6-digit code');
      return;
    }
    if (!allRequirementsMet) {
      setError('Password does not meet all requirements');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          code: fullCode,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Password reset failed');
      }

      navigation.navigate('Login');
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
            <Ionicons name="refresh" size={48} color={colors.primary} />
          </View>
          <Text style={styles.headerTitle}>RESET PASSWORD</Text>
          <Text style={styles.headerSubtitle}>
            Enter the code and your new password
          </Text>
        </View>

        {/* Form Card */}
        <View style={styles.formCard}>
          {/* Section Label */}
          <Text style={styles.sectionLabel}>VERIFICATION CODE</Text>

          {/* Code Input Boxes */}
          <View style={styles.codeRow}>
            {Array.from({ length: CODE_LENGTH }).map((_, index) => (
              <TextInput
                key={index}
                ref={(ref) => {
                  inputRefs.current[index] = ref;
                }}
                style={[
                  styles.codeInput,
                  code[index] ? styles.codeInputFilled : null,
                ]}
                value={code[index]}
                onChangeText={(value) => handleCodeChange(value, index)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
                keyboardType="number-pad"
                maxLength={index === 0 ? CODE_LENGTH : 1}
                selectTextOnFocus
                editable={!loading}
                autoFocus={index === 0}
              />
            ))}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* New Password Label */}
          <Text style={styles.sectionLabel}>NEW PASSWORD</Text>

          {/* New Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.primary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={colors.textMuted}
              value={newPassword}
              onChangeText={setNewPassword}
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

          {/* Confirm New Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.primary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
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

          {/* Reset Password Button */}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleResetPassword}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Text style={styles.buttonText}>RESET PASSWORD</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Back to Login */}
        <View style={styles.bottomLink}>
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.backLink}>
              <Ionicons name="arrow-back" size={14} color={colors.primary} /> Back to Login
            </Text>
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
    lineHeight: 22,
  },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    ...fonts.headingLarge,
    color: colors.primary,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  codeInput: {
    width: 48,
    height: 56,
    backgroundColor: colors.inputBg,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    color: colors.text,
    fontSize: fontSize.xl,
    ...fonts.headingLarge,
    textAlign: 'center',
  },
  codeInputFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
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
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  backLink: {
    color: colors.primary,
    fontSize: fontSize.md,
    ...fonts.bodyBold,
  },
});
