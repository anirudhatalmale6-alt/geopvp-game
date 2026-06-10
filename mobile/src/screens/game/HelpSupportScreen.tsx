import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';

const RANK_TIERS = [
  { min: 0,     title: 'ROOKIE HUNTER',  icon: 'footsteps-outline', color: '#9e9e9e', desc: 'Starting rank for all new players' },
  { min: 100,   title: 'SCOUT',          icon: 'eye-outline',       color: '#78909c', desc: 'You\'ve started scouting the battlefield' },
  { min: 500,   title: 'TRACKER',        icon: 'compass-outline',   color: '#4caf50', desc: 'Skilled at tracking down opponents' },
  { min: 1500,  title: 'STALKER',        icon: 'navigate-outline',  color: '#2196f3', desc: 'A feared hunter on the prowl' },
  { min: 3000,  title: 'PROWLER',        icon: 'flash-outline',     color: '#7c4dff', desc: 'Lightning fast and deadly' },
  { min: 5000,  title: 'ENFORCER',       icon: 'flame-outline',     color: '#ff9100', desc: 'Enforcing dominance on the battlefield' },
  { min: 10000, title: 'APEX HUNTER',    icon: 'diamond-outline',   color: '#f50057', desc: 'Top of the food chain' },
  { min: 25000, title: 'LEGEND',         icon: 'star',              color: '#ffd700', desc: 'A legendary player known by all' },
  { min: 50000, title: 'MYTHIC PROWLER', icon: 'crown',             color: '#ffd700', iconLib: 'mci' as const, desc: 'The ultimate rank — mythic status' },
];

interface SectionProps {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({ title, icon, iconColor, children, defaultOpen }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionLeft}>
          <View style={[styles.sectionIcon, { backgroundColor: iconColor + '20' }]}>
            <Ionicons name={icon as any} size={18} color={iconColor} />
          </View>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

function BulletItem({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bullet} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

export default function HelpSupportScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* How to Play */}
      <CollapsibleSection
        title="HOW TO PLAY"
        icon="game-controller-outline"
        iconColor={colors.primary}
        defaultOpen={true}
      >
        <Text style={styles.paragraph}>
          CoinProwl is a GPS-based PvP game where you hunt other players in real-time on a live map. Buy in, collect prowl coins, attack nearby players, and climb the ranks!
        </Text>
        <Text style={styles.subheading}>Getting Started</Text>
        <BulletItem text="Tap 'Start Hunting' on the map to buy in and start a session" />
        <BulletItem text="Choose your buy-in tier ($1 - $25) to receive prowl coins" />
        <BulletItem text="Your location appears on the map — other active players can see you too" />
        <BulletItem text="Move around in the real world to find other players on the map" />

        <Text style={styles.subheading}>Attacking</Text>
        <BulletItem text="Tap on a nearby player's marker to attack them" />
        <BulletItem text="You must be within range (about 0.25 miles) to attack" />
        <BulletItem text="If your attack succeeds, you steal their prowl coins and earn sweep coins" />
        <BulletItem text="If you get eliminated, your session ends — buy in again to keep playing" />

        <Text style={styles.subheading}>Defending</Text>
        <BulletItem text="Standard Shield ($1) — protects you from attacks for 10 minutes" />
        <BulletItem text="Gold Shield ($5) — protects you from attacks for 2 hours" />
        <BulletItem text="While shielded, no one can attack you — not even bots" />
        <BulletItem text="You can buy up to 3 shields per 24 hours" />
      </CollapsibleSection>

      {/* Buy-In Tiers */}
      <CollapsibleSection
        title="BUY-IN TIERS"
        icon="layers-outline"
        iconColor="#ffd700"
      >
        <Text style={styles.paragraph}>
          Each tier gives you 10 prowl coins per dollar. Higher tiers mean more coins on the map — but more risk. You can only attack players at your tier or lower.
        </Text>
        <View style={styles.rankList}>
          {[
            { name: 'COPPER', price: '$1', coins: '10', color: '#b87333' },
            { name: 'TIN', price: '$2', coins: '20', color: '#8a9597' },
            { name: 'IRON', price: '$3', coins: '30', color: '#6a6a6a' },
            { name: 'NICKEL', price: '$4', coins: '40', color: '#7a7a7a' },
            { name: 'BRONZE', price: '$5', coins: '50', color: '#cd7f32' },
            { name: 'BRASS', price: '$6', coins: '60', color: '#b5a642' },
            { name: 'SILVER', price: '$7', coins: '70', color: '#c0c0c0' },
            { name: 'ELECTRUM', price: '$8', coins: '80', color: '#d4c675' },
            { name: 'GOLD', price: '$9', coins: '90', color: '#ffd700' },
            { name: 'ROSE GOLD', price: '$10', coins: '100', color: '#e8a090' },
            { name: 'PALLADIUM', price: '$11', coins: '110', color: '#ced0ce' },
            { name: 'PLATINUM', price: '$12', coins: '120', color: '#e5e4e2' },
            { name: 'OPAL', price: '$13', coins: '130', color: '#d4eaf7' },
            { name: 'TOPAZ', price: '$14', coins: '140', color: '#ffc87c' },
            { name: 'AMETHYST', price: '$15', coins: '150', color: '#9966cc' },
            { name: 'AQUAMARINE', price: '$16', coins: '160', color: '#7fffd4' },
            { name: 'EMERALD', price: '$17', coins: '170', color: '#50c878' },
            { name: 'PEARL', price: '$18', coins: '180', color: '#f0ead6' },
            { name: 'SAPPHIRE', price: '$19', coins: '190', color: '#0f52ba' },
            { name: 'ALEXANDRITE', price: '$20', coins: '200', color: '#008b8b' },
            { name: 'RUBY', price: '$21', coins: '210', color: '#e0115f' },
            { name: 'BLACK OPAL', price: '$22', coins: '220', color: '#1a1a2e' },
            { name: 'TANZANITE', price: '$23', coins: '230', color: '#4d4dff' },
            { name: 'RED BERYL', price: '$24', coins: '240', color: '#c41e3a' },
            { name: 'DIAMOND', price: '$25', coins: '250', color: '#b9f2ff' },
          ].map((t) => (
            <View key={t.name} style={styles.rankItem}>
              <View style={[styles.rankIcon, { backgroundColor: t.color + '20' }]}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t.color }} />
              </View>
              <View style={styles.rankInfo}>
                <Text style={[styles.rankTitle, { color: t.color }]}>{t.name}</Text>
                <Text style={styles.rankDesc}>{t.coins} prowl coins</Text>
              </View>
              <Text style={styles.rankCoins}>{t.price}</Text>
            </View>
          ))}
        </View>
      </CollapsibleSection>

      {/* Game Rules */}
      <CollapsibleSection
        title="GAME RULES"
        icon="document-text-outline"
        iconColor={colors.warning}
      >
        <Text style={styles.subheading}>General Rules</Text>
        <BulletItem text="You must be 18 or older to play CoinProwl" />
        <BulletItem text="One account per person — no multi-accounting" />
        <BulletItem text="GPS spoofing or location manipulation is strictly prohibited" />
        <BulletItem text="You can play as a passenger in a vehicle, but never while driving" />
        <BulletItem text="Always be aware of your surroundings and stay safe" />

        <Text style={styles.subheading}>Fair Play</Text>
        <BulletItem text="No teaming up to target specific players" />
        <BulletItem text="No harassment, threats, or intimidation of other players" />
        <BulletItem text="No exploiting bugs or glitches — report them to support" />
        <BulletItem text="Violations may result in account suspension or permanent ban" />

        <Text style={styles.subheading}>Battlefield</Text>
        <BulletItem text="Not every player on the map is a real person — bots are disguised as real players" />
        <BulletItem text="Bots can and will attack you, so stay alert at all times" />
        <BulletItem text="There is no way to tell a bot from a real player — treat every encounter as a real threat" />
        <BulletItem text="Bots carry coins and can be defeated just like real players" />

        <Text style={styles.subheading}>Sessions</Text>
        <BulletItem text="Each buy-in starts a new session with fresh prowl coins" />
        <BulletItem text="Your session ends when you get eliminated (lose all coins) or voluntarily end it" />
        <BulletItem text="You can only be in one active session at a time" />
        <BulletItem text="Leaving the app does not end your session — you remain on the map" />
      </CollapsibleSection>

      {/* Rank System */}
      <CollapsibleSection
        title="RANK SYSTEM"
        icon="ribbon-outline"
        iconColor={colors.gold}
      >
        <Text style={styles.paragraph}>
          Your rank is based on the total prowl coins you've accumulated through buy-ins. Ranks never decrease — once you earn a rank, you keep it forever!
        </Text>

        <View style={styles.rankList}>
          {RANK_TIERS.map((tier) => (
            <View key={tier.title} style={styles.rankItem}>
              <View style={[styles.rankIcon, { backgroundColor: tier.color + '20' }]}>
                {(tier as any).iconLib === 'mci'
                  ? <MaterialCommunityIcons name={tier.icon as any} size={18} color={tier.color} />
                  : <Ionicons name={tier.icon as any} size={18} color={tier.color} />}
              </View>
              <View style={styles.rankInfo}>
                <Text style={[styles.rankTitle, { color: tier.color }]}>{tier.title}</Text>
                <Text style={styles.rankDesc}>{tier.desc}</Text>
              </View>
              <Text style={styles.rankCoins}>{tier.min.toLocaleString()}</Text>
            </View>
          ))}
        </View>
      </CollapsibleSection>

      {/* Currency Guide */}
      <CollapsibleSection
        title="CURRENCY GUIDE"
        icon="cash-outline"
        iconColor={colors.success}
      >
        <View style={styles.currencyCard}>
          <View style={styles.currencyHeader}>
            <Ionicons name="trophy" size={20} color="#ffd700" />
            <Text style={[styles.currencyName, { color: '#ffd700' }]}>PROWL COINS</Text>
          </View>
          <BulletItem text="Earned by buying in to game sessions" />
          <BulletItem text="Used for your rank score — higher coins = higher rank" />
          <BulletItem text="Stolen or lost during PvP attacks" />
          <BulletItem text="Your total prowl coins earned determines your rank" />
          <BulletItem text="Rank progress never decreases even if you lose coins" />
        </View>

        <View style={[styles.currencyCard, { marginTop: spacing.sm }]}>
          <View style={styles.currencyHeader}>
            <Ionicons name="cash" size={20} color={colors.success} />
            <Text style={[styles.currencyName, { color: colors.success }]}>SWEEP COINS</Text>
          </View>
          <BulletItem text="Earned ONLY by successfully attacking other players" />
          <BulletItem text="Cannot be purchased or obtained for free" />
          <BulletItem text="Can be redeemed for real prizes via PayPal" />
          <BulletItem text="The more you win in attacks, the more sweep coins you earn" />
        </View>
      </CollapsibleSection>

      {/* FAQ */}
      <CollapsibleSection
        title="FAQ"
        icon="chatbubble-ellipses-outline"
        iconColor={colors.accent}
      >
        <Text style={styles.faqQ}>What happens when I get attacked?</Text>
        <Text style={styles.faqA}>
          If another player attacks you and wins, they take some of your prowl coins. If you lose all your prowl coins, your session ends and you'll need to buy in again.
        </Text>

        <Text style={styles.faqQ}>Can I play without spending money?</Text>
        <Text style={styles.faqA}>
          You need to buy in to start a session and appear on the map. Buy-ins start at just $1 for the Copper tier.
        </Text>

        <Text style={styles.faqQ}>How do I earn sweep coins?</Text>
        <Text style={styles.faqA}>
          Sweep coins are earned exclusively by successfully attacking other players. There is no other way to earn them — you have to win in combat.
        </Text>

        <Text style={styles.faqQ}>Do I lose my rank if I get defeated?</Text>
        <Text style={styles.faqA}>
          No! Your rank is permanent. It's based on the total prowl coins you've ever accumulated through buy-ins, not your current balance. Once you earn a rank, you keep it.
        </Text>

        <Text style={styles.faqQ}>What is the attack range?</Text>
        <Text style={styles.faqA}>
          You need to be within approximately 0.25 miles of another player to attack them. Get close on the map to engage!
        </Text>

        <Text style={styles.faqQ}>Can I play in the background?</Text>
        <Text style={styles.faqA}>
          Yes. If you have an active session, your location stays on the map even when the app is in the background. Other players can still find and attack you. You'll receive a push notification if you're attacked.
        </Text>

        <Text style={styles.faqQ}>How do shields work?</Text>
        <Text style={styles.faqA}>
          There are two shield types: Standard ($1, 10 minutes) and Gold ($5, 2 hours). You can buy up to 3 shields per 24 hours. While shielded, no player or bot can attack you.
        </Text>
      </CollapsibleSection>

      {/* Contact */}
      <CollapsibleSection
        title="CONTACT SUPPORT"
        icon="mail-outline"
        iconColor={colors.secondary}
      >
        <Text style={styles.paragraph}>
          Need help or have a question not covered here? Reach out to us and we'll get back to you as soon as possible.
        </Text>
        <TouchableOpacity
          style={styles.contactBtn}
          onPress={() => Linking.openURL('mailto:support@coinprowl.com')}
          activeOpacity={0.8}
        >
          <Ionicons name="mail" size={16} color={colors.background} />
          <Text style={styles.contactBtnText}>EMAIL SUPPORT</Text>
        </TouchableOpacity>
      </CollapsibleSection>

      {/* Legal */}
      <CollapsibleSection
        title="LEGAL"
        icon="document-outline"
        iconColor={colors.textMuted}
      >
        <TouchableOpacity
          style={styles.contactBtn}
          onPress={() => Linking.openURL('https://anirudhatalmale6-alt.github.io/coinprowl-privacy/')}
          activeOpacity={0.8}
        >
          <Ionicons name="shield-checkmark" size={16} color={colors.background} />
          <Text style={styles.contactBtnText}>PRIVACY POLICY</Text>
        </TouchableOpacity>
      </CollapsibleSection>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  sectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 1,
  },
  sectionBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  paragraph: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: 6,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  rankList: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  rankItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  rankIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankInfo: {
    flex: 1,
    gap: 2,
  },
  rankTitle: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    letterSpacing: 1,
  },
  rankDesc: {
    fontSize: 10,
    color: colors.textMuted,
  },
  rankCoins: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
  },
  currencyCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  currencyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  currencyName: {
    fontSize: fontSize.sm,
    fontWeight: '900',
    letterSpacing: 2,
  },
  faqQ: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  faqA: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  contactBtnText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
});
