/** Website on a computer: the map game is phone-only (GPS); account, wallet and ranks work here. */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

export default function PlayOnPhoneScreen() {
  return (
    <View style={s.wrap}>
      <Ionicons name="phone-portrait-outline" size={54} color={colors.primary} />
      <Text style={s.title}>PLAY ON YOUR PHONE</Text>
      <Text style={s.msg}>
        CoinProwl is played with your phone's GPS, so the map only opens on a phone. Scan the code, or open
        coinprowl.com/play in your phone's browser, and log in with this same account.
      </Text>
      <Image source={require('../../assets/play-qr.png')} style={s.qr} />
      <Text style={s.small}>Your wallet, ranks and profile work here on the computer.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900', letterSpacing: 3, marginTop: 14 },
  msg: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 420, marginTop: 12 },
  qr: { width: 200, height: 200, marginTop: 22, borderRadius: 10 },
  small: { color: colors.textMuted, fontSize: 13, marginTop: 18, textAlign: 'center' },
});
