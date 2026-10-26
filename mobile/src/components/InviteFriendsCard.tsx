/** Profile: the player's invite code + link, share button, what it has earned; or add a friend's code. */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../theme';
import { getMyReferrals, claimReferral, ReferralInfo } from '../api/referrals';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function InviteFriendsCard() {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [claimCode, setClaimCode] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { getMyReferrals().then(setInfo).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const share = async () => {
    if (!info) return;
    const message = `Join me on CoinProwl, the GPS hunting game! Use my invite code ${info.code} and get +${info.welcomeCoins} bonus coins on your first buy-in: ${info.link}`;
    try {
      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav && nav.share) { await nav.share({ title: 'CoinProwl', text: message, url: info.link }); return; }
        if (nav && nav.clipboard) { await nav.clipboard.writeText(message); Alert.alert('Copied!', 'Your invite link is copied. Paste it in a text, Instagram, TikTok…'); return; }
        Alert.alert('Your invite link', info.link);
        return;
      }
      await Share.share({ message });
    } catch { /* closed the share sheet */ }
  };

  const claim = async () => {
    if (!claimCode.trim()) return;
    setBusy(true);
    try {
      const r = await claimReferral(claimCode.trim());
      Alert.alert('Invite code added', `You joined with ${r.invitedBy}'s invite. You'll get +${info?.welcomeCoins ?? 10} bonus coins on your first buy-in.`);
      setClaimCode(''); load();
    } catch (e: any) {
      Alert.alert('Invite code', e?.message || 'That code could not be added.');
    } finally { setBusy(false); }
  };

  if (!info) {
    return <View style={[s.card, { alignItems: 'center' }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  return (
    <View style={s.card}>
      <Text style={s.lead}>
        Earn {info.ratePct}% of every buy-in your friends make in their first {info.days} days, paid in Sweep coins. Friends get +{info.welcomeCoins} coins on their first buy-in.
      </Text>
      <View style={s.codeRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.codeLabel}>YOUR INVITE CODE</Text>
          <Text style={s.code} selectable>{info.code}</Text>
          <Text style={s.link} selectable>{info.link.replace('https://', '')}</Text>
        </View>
        <TouchableOpacity style={s.shareBtn} onPress={share} activeOpacity={0.85}>
          <Ionicons name="share-social" size={18} color={colors.background} />
          <Text style={s.shareText}>SHARE</Text>
        </TouchableOpacity>
      </View>
      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statVal}>{info.friendsJoined}</Text><Text style={s.statLbl}>JOINED</Text></View>
        <View style={s.stat}><Text style={s.statVal}>{info.friendsPlayed}</Text><Text style={s.statLbl}>PLAYED</Text></View>
        <View style={s.stat}><Text style={[s.statVal, { color: colors.success }]}>{usd(info.earnedCents)}</Text><Text style={s.statLbl}>EARNED</Text></View>
      </View>
      {info.recent.slice(0, 3).map((r, i) => (
        <Text key={i} style={s.recent}>+{usd(r.rewardCents)} from {r.friend}'s {usd(r.buyinCents)} buy-in</Text>
      ))}
      {info.invitedBy ? <Text style={s.invited}>You joined with {info.invitedBy}'s invite</Text> : null}
      {info.canClaim && !info.invitedBy ? (
        <View style={s.claimRow}>
          <TextInput
            style={s.claimInput}
            placeholder="Got a friend's code?"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            value={claimCode}
            onChangeText={setClaimCode}
          />
          <TouchableOpacity style={s.claimBtn} onPress={claim} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={s.claimText}>ADD</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  lead: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19, marginBottom: spacing.md },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  codeLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  code: { color: colors.primary, fontSize: 22, fontWeight: '900', letterSpacing: 2, marginTop: 2 },
  link: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 11, borderRadius: borderRadius.md },
  shareText: { color: colors.background, fontWeight: '900', letterSpacing: 1, fontSize: 13 },
  stats: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.background, borderRadius: borderRadius.md, paddingVertical: 8, alignItems: 'center' },
  statVal: { color: colors.text, fontSize: 17, fontWeight: '800' },
  statLbl: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  recent: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  invited: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  claimRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  claimInput: { flex: 1, minWidth: 0, backgroundColor: colors.background, color: colors.text, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  claimBtn: { paddingHorizontal: 16, justifyContent: 'center', borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.primary },
  claimText: { color: colors.primary, fontWeight: '900', letterSpacing: 1 },
});
