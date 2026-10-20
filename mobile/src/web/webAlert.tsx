/**
 * react-native-web's Alert.alert does nothing, so on the website every confirm / info popup would silently
 * vanish. This puts them on screen: Alert.alert(title, message, buttons) is queued and drawn by <AlertHost/>.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { isWeb } from './platform';

type Btn = { text?: string; onPress?: (v?: string) => void; style?: 'default' | 'cancel' | 'destructive' };
type Item = { title: string; message?: string; buttons: Btn[] };

const queue: Item[] = [];
let notify: (() => void) | null = null;

export function installWebAlert(): void {
  if (!isWeb) return;
  (Alert as any).alert = (title: string, message?: string, buttons?: Btn[]) => {
    queue.push({ title: title || '', message, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }] });
    notify && notify();
  };
}

export function AlertHost() {
  const [, force] = useState(0);
  useEffect(() => { notify = () => force(n => n + 1); return () => { notify = null; }; }, []);
  const cur = queue[0];
  if (!isWeb || !cur) return null;
  const press = (b: Btn) => { queue.shift(); force(n => n + 1); setTimeout(() => b.onPress && b.onPress(), 0); };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => { const c = cur.buttons.find(b => b.style === 'cancel'); press(c || cur.buttons[cur.buttons.length - 1]); }}>
      <View style={s.backdrop}>
        <View style={s.card}>
          {!!cur.title && <Text style={s.title}>{cur.title}</Text>}
          {!!cur.message && <Text style={s.msg}>{cur.message}</Text>}
          <View style={[s.row, cur.buttons.length > 2 && s.col]}>
            {cur.buttons.map((b, i) => (
              <Pressable key={i} onPress={() => press(b)} style={({ pressed }) => [s.btn, cur.buttons.length > 2 && s.btnFull, pressed && { opacity: 0.7 }]}>
                <Text style={[s.btnText, b.style === 'cancel' && s.cancel, b.style === 'destructive' && s.destructive]}>{b.text || 'OK'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 20 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  msg: { color: colors.textSecondary || colors.text, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: 18, gap: 10 },
  col: { flexDirection: 'column', alignItems: 'stretch' },
  btn: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  btnFull: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%' },
  btnText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  cancel: { color: colors.textSecondary || colors.text, fontWeight: '600' },
  destructive: { color: colors.secondary },
});
