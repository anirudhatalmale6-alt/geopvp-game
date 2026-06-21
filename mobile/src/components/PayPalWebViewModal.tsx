import React, { useState, useRef } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  SafeAreaView,
  Platform,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../theme';

const RETURN_URL = 'https://api.coinprowl.com/api/paypal/return';
const CANCEL_URL = 'https://api.coinprowl.com/api/paypal/cancel';

interface PayPalWebViewModalProps {
  visible: boolean;
  approvalUrl: string;
  onApproved: () => void;
  onCancelled: () => void;
}

export default function PayPalWebViewModal({
  visible,
  approvalUrl,
  onApproved,
  onCancelled,
}: PayPalWebViewModalProps) {
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef<WebView>(null);

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    const { url } = navState;
    if (url.startsWith(RETURN_URL)) {
      onApproved();
    } else if (url.startsWith(CANCEL_URL)) {
      onCancelled();
    }
  };

  const handleShouldStartLoad = (event: { url: string }) => {
    if (event.url.startsWith(RETURN_URL)) {
      onApproved();
      return false;
    }
    if (event.url.startsWith(CANCEL_URL)) {
      onCancelled();
      return false;
    }
    return true;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancelled}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
            <Text style={styles.headerTitle}>Secure Payment</Text>
          </View>
          <TouchableOpacity onPress={onCancelled} style={styles.closeBtn}>
            <Ionicons name="close-circle" size={28} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading PayPal...</Text>
          </View>
        )}

        {approvalUrl ? (
          <WebView
            ref={webViewRef}
            source={{ uri: approvalUrl }}
            style={styles.webview}
            onNavigationStateChange={handleNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState={false}
            scalesPageToFit
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            userAgent={Platform.select({
              ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
              android: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            })}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: '#333',
  },
  closeBtn: {
    padding: 4,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    zIndex: 10,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: '#666',
  },
});
