import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import { acceptWaiver } from '../../api/auth';

interface WaiverScreenProps {
  onAccepted: () => void;
}

const WAIVER_TEXT = `COINPROWL USER AGREEMENT, LIABILITY WAIVER, AND ASSUMPTION OF RISK

PLEASE READ THIS AGREEMENT CAREFULLY BEFORE USING COINPROWL. BY TAPPING "I AGREE" BELOW, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY ALL TERMS AND CONDITIONS SET FORTH IN THIS AGREEMENT.

1. ASSUMPTION OF RISK AND PERSONAL RESPONSIBILITY

1.1. CoinProwl is a GPS-based mobile game that involves physical movement in real-world locations. By using this application, you voluntarily assume all risks associated with physical movement, including but not limited to: walking, running, or traveling to various locations in pursuit of in-game objectives.

1.2. You acknowledge that playing CoinProwl requires you to be aware of your physical surroundings at all times. You are solely responsible for your personal safety and the safety of others while using this application.

1.3. You understand and agree that CoinProwl, its developers, owners, officers, directors, employees, agents, affiliates, and licensors (collectively, "CoinProwl Parties") are NOT responsible for any injuries, damages, losses, or harm of any kind that may result from your use of this application.

2. COMPLIANCE WITH ALL APPLICABLE LAWS

2.1. You agree to comply with ALL federal, state, and local laws, regulations, ordinances, and rules of the United States and any jurisdiction in which you use this application. This includes, but is not limited to:

  a) TRAFFIC LAWS: You shall not exceed posted speed limits, run red lights or stop signs, drive recklessly, operate a vehicle while distracted by this application, or violate any traffic law or regulation while using CoinProwl. You agree to NEVER use CoinProwl while operating a motor vehicle, bicycle, scooter, or any other mode of transportation that requires your attention.

  b) TRESPASS LAWS: You shall not enter private property without the express permission of the property owner. You shall not enter restricted areas, military installations, government buildings, construction sites, or any area where public access is prohibited or restricted. You shall respect all posted signs including "No Trespassing," "Private Property," "Keep Out," and similar notices.

  c) CRIMINAL LAWS: You shall not engage in any criminal activity while using CoinProwl, including but not limited to theft, assault, harassment, stalking, vandalism, breaking and entering, disorderly conduct, or any other unlawful behavior.

  d) PARK AND PUBLIC SPACE REGULATIONS: You shall comply with all park hours, trail restrictions, wildlife protection rules, noise ordinances, and any other regulations governing public spaces.

  e) DRONE AND AVIATION LAWS: If applicable, you shall comply with all FAA regulations and local ordinances regarding the use of drones or any aerial equipment.

  f) DIGITAL AND PRIVACY LAWS: You shall not use CoinProwl to stalk, harass, or surveil any individual. You shall respect the privacy rights of all persons.

2.2. You acknowledge that laws vary by jurisdiction and it is YOUR sole responsibility to know and comply with all applicable laws in your specific location.

3. PROHIBITED CONDUCT

3.1. While using CoinProwl, you shall NOT:

  a) Exceed any posted speed limit or drive recklessly to reach game objectives
  b) Enter any private property without explicit authorization from the property owner
  c) Trespass on any restricted or prohibited area
  d) Operate any motor vehicle, bicycle, or other transportation device while actively interacting with the game interface
  e) Ignore traffic signals, crosswalks, or pedestrian safety measures
  f) Engage in any activity that poses a risk to yourself or others
  g) Play in dangerous locations such as highways, railroad tracks, bodies of water, cliffs, construction zones, or any hazardous area
  h) Harass, follow, stalk, threaten, or intimidate any person, player or non-player
  i) Use the application in any manner that would constitute a criminal offense
  j) Interfere with law enforcement, emergency services, or public safety operations
  k) Play while under the influence of alcohol, drugs, or any substance that impairs judgment or physical ability
  l) Allow minors under the age of 18 to use CoinProwl without direct adult supervision
  m) Use CoinProwl in any school zone, playground, or area primarily designated for children without appropriate caution and compliance with all applicable regulations

4. WAIVER AND RELEASE OF LIABILITY

4.1. TO THE FULLEST EXTENT PERMITTED BY LAW, YOU HEREBY RELEASE, WAIVE, DISCHARGE, AND COVENANT NOT TO SUE the CoinProwl Parties from any and all liability, claims, demands, actions, causes of action, costs, and expenses (including reasonable attorney fees) arising out of or related to any loss, damage, or injury, including death, that may be sustained by you, or to any property belonging to you, WHETHER CAUSED BY THE NEGLIGENCE OF THE COINPROWL PARTIES OR OTHERWISE, while participating in or as a result of using the CoinProwl application.

4.2. You agree that this release includes, but is not limited to, claims arising from:

  a) Personal injury, illness, or death
  b) Property damage or loss
  c) Claims arising from the actions of other players
  d) Claims arising from interactions with third parties encountered while playing
  e) Vehicle accidents or traffic incidents
  f) Injuries sustained from falls, collisions, or other physical impacts
  g) Injuries sustained from environmental hazards or weather conditions
  h) Any claims related to trespass or unauthorized entry onto property
  i) Any claims arising from criminal acts committed by the user
  j) Mental or emotional distress
  k) Loss of personal belongings
  l) Claims related to financial losses incurred through gameplay

5. INDEMNIFICATION

5.1. You agree to indemnify, defend, and hold harmless the CoinProwl Parties from and against any and all claims, damages, obligations, losses, liabilities, costs, debts, and expenses (including but not limited to attorney fees) arising from:

  a) Your use or misuse of CoinProwl
  b) Your violation of any term of this Agreement
  c) Your violation of any law, rule, or regulation
  d) Your violation of any rights of a third party
  e) Any claim or damages that arise as a result of your conduct or behavior while using CoinProwl
  f) Any bodily injury, property damage, or financial loss caused by your actions while using CoinProwl

6. ACKNOWLEDGMENT OF REAL-MONEY ELEMENTS

6.1. CoinProwl involves real-money transactions including buy-ins, coin purchases, and potential cash-outs. You acknowledge that:

  a) All buy-in amounts are final and non-refundable once a game session begins
  b) You may lose your entire buy-in amount through gameplay
  c) CoinProwl does not guarantee any financial return
  d) You are solely responsible for any financial decisions made within the application
  e) You will not hold CoinProwl liable for any financial losses incurred through gameplay

7. AGE REQUIREMENT

7.1. You represent and warrant that you are at least 18 years of age. If you are under 18, you may not use CoinProwl under any circumstances.

8. HEALTH AND PHYSICAL FITNESS

8.1. You represent that you are in adequate physical condition to participate in a game that involves walking and physical movement. You understand that physical activity carries inherent risks and you voluntarily assume those risks.

8.2. If you have any medical condition, disability, or physical limitation that could be affected by physical activity, you acknowledge that you have consulted with a healthcare professional before using CoinProwl and have received clearance to participate.

9. WEATHER AND ENVIRONMENTAL CONDITIONS

9.1. You agree to exercise sound judgment regarding weather and environmental conditions. You shall not use CoinProwl during severe weather events, in extreme temperatures, in areas with poor visibility, or in any environmental conditions that could pose a risk to your safety.

10. DISPUTE RESOLUTION

10.1. Any dispute arising out of or relating to this Agreement or the use of CoinProwl shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association. The arbitration shall take place in the State of Florida, and the decision of the arbitrator shall be final and binding.

10.2. You agree to waive any right to a jury trial or to participate in a class action lawsuit against the CoinProwl Parties.

11. GOVERNING LAW

11.1. This Agreement shall be governed by and construed in accordance with the laws of the State of Florida, United States of America, without regard to its conflict of law provisions.

12. SEVERABILITY

12.1. If any provision of this Agreement is held to be invalid, illegal, or unenforceable, the remaining provisions shall continue in full force and effect.

13. ENTIRE AGREEMENT

13.1. This Agreement constitutes the entire agreement between you and CoinProwl regarding your use of the application and supersedes all prior agreements and understandings, whether written or oral.

14. MODIFICATIONS

14.1. CoinProwl reserves the right to modify this Agreement at any time. Continued use of the application after any modifications constitutes acceptance of the modified terms.

15. ACKNOWLEDGMENT

15.1. BY TAPPING "I AGREE" BELOW, YOU ACKNOWLEDGE AND AGREE THAT:

  - You have read this entire Agreement
  - You understand all terms and conditions
  - You voluntarily agree to be bound by all terms
  - You are at least 18 years of age
  - You are solely responsible for your own safety and legal compliance
  - You assume all risks associated with using CoinProwl
  - You waive all claims against the CoinProwl Parties
  - Any violation of applicable laws while using CoinProwl is your sole legal responsibility
  - CoinProwl does not encourage, endorse, or condone any illegal activity
  - CoinProwl is not responsible for any actions taken by users while playing the game`;

export default function WaiverScreen({ onAccepted }: WaiverScreenProps) {
  const [loading, setLoading] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 60;
    if (isNearBottom && !scrolledToBottom) {
      setScrolledToBottom(true);
    }
  };

  const handleAccept = async () => {
    setLoading(true);
    try {
      await acceptWaiver();
      onAccepted();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to accept waiver. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = () => {
    Alert.alert(
      'Waiver Required',
      'You must accept the waiver to play CoinProwl. You cannot start a game session without agreeing to these terms.',
      [{ text: 'OK' }],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
        <Text style={styles.headerTitle}>PLAYER AGREEMENT</Text>
      </View>
      <Text style={styles.headerSub}>
        Please read the following agreement carefully. You must scroll to the bottom and accept to continue.
      </Text>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={true}
        indicatorStyle="white"
      >
        <Text style={styles.waiverText}>{WAIVER_TEXT}</Text>
        <View style={styles.endMarker}>
          <Ionicons name="checkmark-circle-outline" size={24} color={colors.primary} />
          <Text style={styles.endMarkerText}>END OF AGREEMENT</Text>
        </View>
      </ScrollView>

      {!scrolledToBottom && (
        <View style={styles.scrollHint}>
          <Ionicons name="chevron-down" size={16} color={colors.primary} />
          <Text style={styles.scrollHintText}>SCROLL TO BOTTOM TO ACCEPT</Text>
          <Ionicons name="chevron-down" size={16} color={colors.primary} />
        </View>
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.declineBtn} onPress={handleDecline} activeOpacity={0.8}>
          <Text style={styles.declineBtnText}>DECLINE</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.acceptBtn, !scrolledToBottom && styles.acceptBtnDisabled]}
          onPress={handleAccept}
          disabled={!scrolledToBottom || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color={scrolledToBottom ? colors.background : colors.textMuted} />
              <Text style={[styles.acceptBtnText, !scrolledToBottom && { color: colors.textMuted }]}>I AGREE</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  scrollContainer: {
    flex: 1,
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  waiverText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  endMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  endMarkerText: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 2,
  },
  scrollHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  scrollHintText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
  },
  declineBtn: {
    flex: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declineBtnText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.success,
  },
  acceptBtnDisabled: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  acceptBtnText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: fontSize.md,
    letterSpacing: 1,
  },
});
