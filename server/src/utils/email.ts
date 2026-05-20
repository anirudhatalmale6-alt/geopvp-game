import nodemailer from 'nodemailer';
import { config } from '../config/env';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

const fromAddress = config.smtp.from || `${config.appName} <${config.smtp.user}>`;

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
  await transporter.sendMail({
    from: fromAddress,
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
  await transporter.sendMail({
    from: fromAddress,
    to,
    subject: `${config.appName} - Password Reset`,
    html: codeTemplate(
      'Password Reset',
      code,
      'Enter this code in the app to reset your password.'
    ),
  });
}
