import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import {
  ensureReferralCode, linkReferral, canClaim, normalizeCode,
  REFERRAL_RATE, REFERRAL_DAYS, WELCOME_COINS, CLAIM_WINDOW_DAYS,
} from '../services/referrals';

// GET /api/referrals/me — my invite code, link and what it has earned
export async function getMyReferrals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const code = await ensureReferralCode(userId);
    const [friends, earned, recent, me] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS joined,
                COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.type = 'buyin')
                                  OR EXISTS (SELECT 1 FROM referral_rewards r WHERE r.friend_id = u.id))::int AS played
           FROM users u WHERE u.referred_by = $1`,
        [userId],
      ),
      query(`SELECT COALESCE(SUM(reward_cents), 0)::int AS cents FROM referral_rewards WHERE referrer_id = $1`, [userId]),
      query(
        `SELECT r.reward_cents, r.buyin_cents, r.created_at, f.username
           FROM referral_rewards r JOIN users f ON f.id = r.friend_id
          WHERE r.referrer_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
        [userId],
      ),
      query(`SELECT i.username AS invited_by FROM users u LEFT JOIN users i ON i.id = u.referred_by WHERE u.id = $1`, [userId]),
    ]);
    res.json({
      code,
      link: `https://coinprowl.com/r/${code}`,
      ratePct: Math.round(REFERRAL_RATE * 100),
      days: REFERRAL_DAYS,
      welcomeCoins: WELCOME_COINS,
      friendsJoined: friends.rows[0].joined,
      friendsPlayed: friends.rows[0].played,
      earnedCents: earned.rows[0].cents,
      recent: recent.rows.map((r) => ({ friend: r.username, buyinCents: r.buyin_cents, rewardCents: r.reward_cents, at: r.created_at })),
      invitedBy: me.rows[0]?.invited_by || null,
      canClaim: await canClaim(userId),
      claimWindowDays: CLAIM_WINDOW_DAYS,
    });
  } catch (err) {
    console.error('getMyReferrals error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// POST /api/referrals/claim { code } — add a friend's code after signing up (young account, before any buy-in)
export async function claimReferral(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const code = normalizeCode((req.body || {}).code);
    if (!code) { res.status(400).json({ error: 'Enter your friend\'s invite code.' }); return; }
    if (!(await canClaim(userId))) {
      res.status(400).json({ error: `Invite codes can only be added within ${CLAIM_WINDOW_DAYS} days of signing up, before your first buy-in.` });
      return;
    }
    const inviter = await linkReferral(userId, code);
    if (!inviter) { res.status(400).json({ error: 'That invite code doesn\'t exist (or it\'s your own).' }); return; }
    res.json({ ok: true, invitedBy: inviter });
  } catch (err) {
    console.error('claimReferral error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}
