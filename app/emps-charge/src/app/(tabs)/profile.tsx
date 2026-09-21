import {
  Bell,
  CarFront,
  ChevronRight,
  CircleHelp,
  CreditCard,
  FileText,
  LogOut,
  ShieldCheck,
  Smartphone,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';

type MenuRowProps = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
};

function MenuRow({ icon: Icon, title, subtitle, onPress, danger }: MenuRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, danger && styles.dangerIcon]}>
        <Icon color={danger ? Colors.danger : Colors.textMuted} size={19} />
      </View>
      <View style={styles.menuCopy}>
        <Text style={[styles.menuTitle, danger && styles.dangerText]}>{title}</Text>
        {subtitle ? <Text style={styles.menuSubtitle}>{subtitle}</Text> : null}
      </View>
      <ChevronRight color={Colors.textFaint} size={18} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { isDemoMode, user, logout } = useApp();
  const initials = user?.name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  const comingSoon = (title: string) =>
    Alert.alert(title, 'Esta área visual já está pronta e será conectada à API na próxima etapa.');

  function confirmLogout() {
    Alert.alert('Sair da conta?', 'Sua sessão de recarga, se houver, continuará normalmente no carregador.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} role="main" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>MINHA CONTA</Text>
            <Text style={styles.title}>Perfil</Text>
          </View>

          <View style={styles.profileCard}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials || 'EM'}</Text></View>
            <View style={styles.profileCopy}>
              <Text style={styles.profileName}>{user?.name}</Text>
              <Text style={styles.profileEmail}>{user?.email}</Text>
              <View style={styles.verified}><ShieldCheck color={Colors.green} size={12} /><Text style={styles.verifiedText}>E-mail verificado</Text></View>
            </View>
            <Pressable accessibilityRole="button" onPress={() => comingSoon('Editar perfil')} style={styles.editButton}><Text style={styles.editText}>Editar</Text></Pressable>
          </View>

          <Text style={styles.sectionLabel}>PREFERÊNCIAS</Text>
          <View style={styles.menuCard}>
            <MenuRow icon={CreditCard} onPress={() => comingSoon('Formas de pagamento')} subtitle="Visa final 4242 · PIX" title="Formas de pagamento" />
            <View style={styles.separator} />
            <MenuRow icon={CarFront} onPress={() => comingSoon('Meu veículo')} subtitle="Adicione seu carro elétrico" title="Meu veículo" />
            <View style={styles.separator} />
            <MenuRow icon={Bell} onPress={() => comingSoon('Notificações')} subtitle="Recarga, recibos e avisos" title="Notificações" />
          </View>

          <Text style={styles.sectionLabel}>SEGURANÇA E SUPORTE</Text>
          <View style={styles.menuCard}>
            <MenuRow icon={Smartphone} onPress={() => comingSoon('Segurança')} title="Acesso e segurança" />
            <View style={styles.separator} />
            <MenuRow icon={CircleHelp} onPress={() => comingSoon('Central de ajuda')} title="Ajuda durante a recarga" />
            <View style={styles.separator} />
            <MenuRow icon={FileText} onPress={() => comingSoon('Privacidade')} title="Privacidade e dados" />
          </View>

          <View style={styles.logoutCard}>
            <MenuRow danger icon={LogOut} onPress={confirmLogout} title="Sair da conta" />
          </View>

          <Text style={styles.version}>
            EMPS Charge · {isDemoMode ? 'modo demonstração' : 'conectado à EMPS'} · 1.0.0
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scroll: { paddingBottom: 34 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 18, width: '100%' },
  header: { paddingBottom: 22, paddingTop: 26 },
  eyebrow: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.6 },
  title: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 27, letterSpacing: -0.8, marginTop: 5 },
  profileCard: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, flexDirection: 'row', gap: 13, padding: 16 },
  avatar: { alignItems: 'center', backgroundColor: Colors.coralAction, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  avatarText: { color: Colors.white, fontFamily: Fonts.bold, fontSize: 18 },
  profileCopy: { flex: 1 },
  profileName: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 15 },
  profileEmail: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 10, marginTop: 2 },
  verified: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 7 },
  verifiedText: { color: Colors.green, fontFamily: Fonts.medium, fontSize: 8 },
  editButton: { backgroundColor: Colors.surfaceSoft, borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 7 },
  editText: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 9 },
  sectionLabel: { color: Colors.textFaint, fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.3, marginBottom: 9, marginLeft: 5, marginTop: 26 },
  menuCard: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, overflow: 'hidden' },
  menuRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 66, paddingHorizontal: 14 },
  pressed: { backgroundColor: Colors.surfaceSoft },
  menuIcon: { alignItems: 'center', backgroundColor: Colors.surfaceSoft, borderRadius: 13, height: 40, justifyContent: 'center', width: 40 },
  dangerIcon: { backgroundColor: '#FF4D5717' },
  menuCopy: { flex: 1 },
  menuTitle: { color: Colors.text, fontFamily: Fonts.medium, fontSize: 12 },
  menuSubtitle: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 9, marginTop: 2 },
  dangerText: { color: Colors.danger },
  separator: { backgroundColor: Colors.borderSoft, height: 1, marginLeft: 66 },
  logoutCard: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, marginTop: 26, overflow: 'hidden' },
  version: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 9, marginTop: 24, textAlign: 'center' },
});
