import fs from 'fs';
import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config/env';

// ---------------------------------------------------------------------------
// The mail account the codes are sent from.
//
// Set from the admin panel (EMAIL tab): the owner types the mailbox password there himself, it is checked
// against the mail server, then kept in this file on the server only (chmod 600, never in git, never sent
// back to the browser). If the file is absent, the .env SMTP_* values are used — unless SMTP_PASS is still the
// launch placeholder, which means no email at all (sign-ups are auto-verified and password reset can't work).
// ---------------------------------------------------------------------------
const SETTINGS_FILE = path.resolve(__dirname, '../../.email-settings.json');

export interface MailSettings { host: string; port: number; secure: boolean; user: string; pass: string; from?: string }

export function loadMailSettings(): MailSettings | null {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (s && s.user && s.pass && s.host) return s;
  } catch { /* not set up from the panel */ }
  if (config.smtp.pass && config.smtp.pass !== 'placeholder_for_now') return { ...config.smtp };
  return null;
}

export function emailConfigured(): boolean {
  return loadMailSettings() !== null;
}

function makeTransport(s: MailSettings): Transporter {
  // timeouts: a mail server that stops answering must fail the request, not hang it (nodemailer waits minutes)
  return nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
  });
}

/** Log in to the mail server with these settings (throws with the server's reason if it refuses). */
export async function verifyMailSettings(s: MailSettings): Promise<void> {
  await makeTransport(s).verify();
}

export function saveMailSettings(s: MailSettings): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s), { mode: 0o600 });
  fs.chmodSync(SETTINGS_FILE, 0o600);
  cached = null;
}

let cached: { key: string; t: Transporter } | null = null;
function current(): { t: Transporter; from: string } {
  const s = loadMailSettings();
  if (!s) throw new Error('Email is not set up');
  const key = JSON.stringify(s);
  if (!cached || cached.key !== key) cached = { key, t: makeTransport(s) };
  return { t: cached.t, from: s.from || `${config.appName} <${s.user}>` };
}

function codeTemplate(title: string, code: string, message: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="420" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;border:1px solid #333;padding:40px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="color:#f5f5f5;font-size:22px;margin:0;">${config.appName}</h1>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:16px;">
              <h2 style="color:#e0e0e0;font-size:18px;margin:0;font-weight:500;">${title}</h2>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <p style="color:#999;font-size:14px;line-height:1.5;margin:0;">${message}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="background:#222;border:2px solid #b87333;border-radius:8px;padding:16px 32px;display:inline-block;">
                <span style="color:#f5f5f5;font-size:32px;letter-spacing:8px;font-weight:700;font-family:monospace;">${code}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <p style="color:#666;font-size:12px;margin:0;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const { t, from } = current();
  await t.sendMail({
    from,
    to,
    subject: `${config.appName} - Verify Your Email`,
    html: codeTemplate(
      'Verify Your Email',
      code,
      'Enter this code in the app to verify your account and start playing.'
    ),
  });
}

export async function sendPasswordResetEmail(to: string, code: string): Promise<void> {
  const { t, from } = current();
  await t.sendMail({
    from,
    to,
    subject: `${config.appName} - Password Reset`,
    html: codeTemplate(
      'Password Reset',
      code,
      'Enter this code in the app to reset your password.'
    ),
  });
}

export async function sendTestEmail(to: string): Promise<void> {
  const { t, from } = current();
  await t.sendMail({
    from,
    to,
    subject: `${config.appName} - Email is working`,
    html: codeTemplate('Email is working', 'OK', 'Players will now get their sign-up and password reset codes by email.'),
  });
}
