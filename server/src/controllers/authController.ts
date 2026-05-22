import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/database';
import { config } from '../config/env';
import { AuthRequest } from '../middleware/auth';
import { sendVerificationEmail, sendPasswordResetEmail } from '../utils/email';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const signupSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one number or symbol'),
  deviceId: z.string().min(1, 'Device ID is required').optional(),
});

const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const resendCodeSchema = z.object({
  email: z.string().email(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
  deviceId: z.string().optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one number or symbol'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one number or symbol'),
});

const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  email: z.string().email().optional(),
});

const deleteAccountSchema = z.object({
  confirmation: z.literal('DELETE'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateAccessToken(user: { id: string; email: string; username: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    config.jwtSecret,
    { expiresIn: '24h' },
  );
}

function generateRefreshToken(user: { id: string }): string {
  return jwt.sign(
    { id: user.id },
    config.jwtRefreshSecret,
    { expiresIn: '7d' },
  );
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { username, email, password, deviceId } = parsed.data;

    // Check email uniqueness
    const emailCheck = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (emailCheck.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered.' });
      return;
    }

    // Check username uniqueness
    const usernameCheck = await query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (usernameCheck.rows.length > 0) {
      res.status(409).json({ error: 'Username already taken.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = generateCode();
    const codeExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Insert user with device lock
    const result = await query(
      `INSERT INTO users (username, email, password_hash, verification_code, verification_expires, device_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [username.toLowerCase(), email.toLowerCase(), hashedPassword, verificationCode, codeExpiry, deviceId || null],
    );

    const userId = result.rows[0].id;

    // Create wallet row
    await query(
      'INSERT INTO wallets (user_id, balance) VALUES ($1, 0)',
      [userId],
    );

    // In dev mode (no real SMTP), auto-verify and return tokens
    const devMode = config.smtp.pass === 'placeholder_for_now';
    if (devMode) {
      await query(
        'UPDATE users SET is_verified = true, verification_code = NULL, verification_expires = NULL WHERE id = $1',
        [userId],
      );
      const user = { id: userId, email: email.toLowerCase(), username: username.toLowerCase() };
      const token = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);
      res.status(201).json({ user, token, refreshToken });
    } else {
      await sendVerificationEmail(email, verificationCode);
      res.status(201).json({ message: 'Account created. Check your email for verification code.' });
    }
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  try {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email, code } = parsed.data;

    const result = await query(
      'SELECT id, verification_code, verification_expires, is_verified FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const user = result.rows[0];

    if (user.is_verified) {
      res.status(400).json({ error: 'Email is already verified.' });
      return;
    }

    if (user.verification_code !== code) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    if (new Date() > new Date(user.verification_expires)) {
      res.status(400).json({ error: 'Verification code has expired. Request a new one.' });
      return;
    }

    await query(
      'UPDATE users SET is_verified = true, verification_code = NULL, verification_expires = NULL WHERE id = $1',
      [user.id],
    );

    res.json({ message: 'Email verified successfully.' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function resendCode(req: Request, res: Response): Promise<void> {
  try {
    const parsed = resendCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email } = parsed.data;

    const result = await query(
      'SELECT id, is_verified FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (result.rows.length === 0) {
      // Don't reveal whether account exists
      res.json({ message: 'New verification code sent.' });
      return;
    }

    const user = result.rows[0];

    if (user.is_verified) {
      res.status(400).json({ error: 'Email is already verified.' });
      return;
    }

    const verificationCode = generateCode();
    const codeExpiry = new Date(Date.now() + 15 * 60 * 1000);

    await query(
      'UPDATE users SET verification_code = $1, verification_expires = $2 WHERE id = $3',
      [verificationCode, codeExpiry, user.id],
    );

    const devMode = config.smtp.pass === 'placeholder_for_now';
    if (!devMode) {
      await sendVerificationEmail(email, verificationCode);
    }

    res.json({ message: 'New verification code sent.' });
  } catch (err) {
    console.error('Resend code error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email, password, deviceId } = parsed.data;

    const result = await query(
      'SELECT id, username, email, password_hash, is_verified, device_id FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (!user.is_verified) {
      res.status(403).json({ error: 'Please verify your email before logging in.' });
      return;
    }

    // Device lock: if account has a registered device, reject logins from other devices
    if (user.device_id && deviceId && user.device_id !== deviceId) {
      console.warn(`[AntiCheat] Device mismatch for ${user.email}: expected ${user.device_id.slice(0, 8)}..., got ${deviceId.slice(0, 8)}...`);
      res.status(403).json({ error: 'This account is locked to another device. Contact support if you need to transfer.' });
      return;
    }

    // If user has no device_id yet (legacy account), bind it now
    if (!user.device_id && deviceId) {
      await query('UPDATE users SET device_id = $1 WHERE id = $2', [deviceId, user.id]);
    }

    const token = generateAccessToken({ id: user.id, email: user.email, username: user.username });
    const refresh = generateRefreshToken({ id: user.id });

    res.json({
      token,
      refreshToken: refresh,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function refreshToken(req: Request, res: Response): Promise<void> {
  try {
    const parsed = refreshTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { refreshToken: token } = parsed.data;

    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwtRefreshSecret);
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token.' });
      return;
    }

    const result = await query(
      'SELECT id, username, email FROM users WHERE id = $1',
      [decoded.id],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found.' });
      return;
    }

    const user = result.rows[0];
    const newToken = generateAccessToken({ id: user.id, email: user.email, username: user.username });

    res.json({ token: newToken });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email } = parsed.data;

    // Always return success to not reveal if email exists
    const result = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (result.rows.length > 0) {
      const resetCode = generateCode();
      const codeExpiry = new Date(Date.now() + 15 * 60 * 1000);

      await query(
        'UPDATE users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
        [resetCode, codeExpiry, result.rows[0].id],
      );

      const devMode = config.smtp.pass === 'placeholder_for_now';
      if (!devMode) {
        await sendPasswordResetEmail(email, resetCode);
      }
    }

    res.json({ message: 'If that email is registered, a reset code has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email, code, newPassword } = parsed.data;

    const result = await query(
      'SELECT id, reset_code, reset_expires FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired reset code.' });
      return;
    }

    const user = result.rows[0];

    if (user.reset_code !== code) {
      res.status(400).json({ error: 'Invalid or expired reset code.' });
      return;
    }

    if (new Date() > new Date(user.reset_expires)) {
      res.status(400).json({ error: 'Invalid or expired reset code.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await query(
      'UPDATE users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [hashedPassword, user.id],
    );

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;
    const userId = req.user!.id;

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT u.id, u.username, u.email, u.is_verified, u.created_at,
              COALESCE(w.balance, 0) AS balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const user = result.rows[0];

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isVerified: user.is_verified,
        createdAt: user.created_at,
      },
      wallet: {
        balance: parseInt(user.balance, 10),
      },
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { username, email } = parsed.data;
    const userId = req.user!.id;

    if (!username && !email) {
      res.status(400).json({ error: 'At least one field (username or email) must be provided.' });
      return;
    }

    // Check uniqueness for new values
    if (username) {
      const check = await query('SELECT id FROM users WHERE username = $1 AND id != $2', [username.toLowerCase(), userId]);
      if (check.rows.length > 0) {
        res.status(409).json({ error: 'Username already taken.' });
        return;
      }
    }

    if (email) {
      const check = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase(), userId]);
      if (check.rows.length > 0) {
        res.status(409).json({ error: 'Email already registered.' });
        return;
      }
    }

    // Build dynamic update
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (username) {
      setClauses.push(`username = $${paramIndex++}`);
      values.push(username.toLowerCase());
    }
    if (email) {
      setClauses.push(`email = $${paramIndex++}`);
      values.push(email.toLowerCase());
    }

    values.push(userId);

    const result = await query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, email`,
      values,
    );

    const user = result.rows[0];

    res.json({
      message: 'Profile updated successfully.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'You must send { "confirmation": "DELETE" } to delete your account.' });
      return;
    }

    const userId = req.user!.id;

    await query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}
