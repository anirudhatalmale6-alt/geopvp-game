import { query } from '../config/database';

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const result = await query('SELECT push_token FROM users WHERE id = $1', [userId]);
    const token = result.rows[0]?.push_token;
    if (!token) return;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: token,
        title,
        body,
        sound: 'default',
        priority: 'high',
      }),
    });
  } catch (err) {
    console.error('[Push] Error sending notification:', err);
  }
}
