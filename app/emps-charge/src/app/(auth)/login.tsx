import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { LockKeyhole, Mail } from 'lucide-react-native';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand } from '@/components/brand';
import { AppButton } from '@/components/ui/app-button';
import { AppInput } from '@/components/ui/app-input';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';

export default function LoginScreen() {
  const router = useRouter();
  const { chargerId, qrToken } = useLocalSearchParams<{ chargerId?: string; qrToken?: string }>();
  const { isDemoMode, login } = useApp();
  const [email, setEmail] = useState(isDemoMode ? 'motorista@emps.com' : '');
  const [password, setPassword] = useState(isDemoMode ? 'emps123' : '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (qrToken) router.replace(`/c/${encodeURIComponent(qrToken)}`);
      else if (chargerId) router.replace(`/charger/${chargerId}`);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Não foi possível entrar.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={['#FF323A24', '#0B0C0F00']}
        end={{ x: 0.8, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.glow}
      />
      <View style={styles.orb} />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            role="main">
            <View style={styles.inner}>
              <Brand subtitle="Charge" />

              <View style={styles.hero}>
                <Text style={styles.eyebrow}>ENERGIA DO SEU JEITO</Text>
                <Text accessibilityRole="header" style={styles.title}>Sua próxima recarga começa aqui.</Text>
                <Text style={styles.subtitle}>
                  Encontre um eletroposto, escaneie o QR da vaga e acompanhe tudo pelo celular.
                </Text>
              </View>

              <View style={styles.form}>
                <AppInput
                  autoCapitalize="none"
                  autoComplete="email"
                  icon={Mail}
                  keyboardType="email-address"
                  label="E-mail"
                  onChangeText={setEmail}
                  placeholder="voce@email.com"
                  value={email}
                />
                <AppInput
                  autoComplete="current-password"
                  icon={LockKeyhole}
                  label="Senha"
                  onChangeText={setPassword}
                  onSubmitEditing={handleLogin}
                  placeholder="Sua senha"
                  returnKeyType="go"
                  secureTextEntry
                  value={password}
                />

                <View style={styles.options}>
                  <Text style={styles.demoText}>
                    {isDemoMode ? 'Acesso demonstrativo preenchido' : 'Acesso protegido pela EMPS'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      Alert.alert(
                        'Recuperar senha',
                        'Entre em contato com o suporte EMPS para recuperar seu acesso.',
                      )
                    }>
                    <Text style={styles.linkText}>Esqueci a senha</Text>
                  </Pressable>
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AppButton loading={loading} onPress={handleLogin} title="Entrar" />

                <View style={styles.registerRow}>
                  <Text style={styles.muted}>Ainda não tem uma conta?</Text>
                  <Link
                    href={
                      qrToken
                        ? { pathname: '/register', params: { qrToken } }
                        : chargerId
                        ? { pathname: '/register', params: { chargerId } }
                        : { pathname: '/register' }
                    }
                    asChild>
                    <Pressable><Text style={styles.linkText}>Criar conta</Text></Pressable>
                  </Link>
                </View>
              </View>

              <Text style={styles.legal}>
                Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade da EMPS.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Colors.background, flex: 1 },
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  glow: { height: 440, left: 0, position: 'absolute', top: 0, width: '100%' },
  orb: {
    backgroundColor: '#FF323A16',
    borderRadius: 180,
    height: 360,
    position: 'absolute',
    right: -220,
    top: 70,
    width: 360,
  },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20 },
  inner: { alignSelf: 'center', flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  hero: { marginTop: 54 },
  eyebrow: {
    color: Colors.coralText,
    fontFamily: Fonts.semiBold,
    fontSize: 10,
    letterSpacing: 2.1,
  },
  title: {
    color: Colors.text,
    fontFamily: Fonts.bold,
    fontSize: 34,
    letterSpacing: -1.1,
    lineHeight: 40,
    marginTop: 12,
    maxWidth: 420,
  },
  subtitle: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 14,
    maxWidth: 480,
  },
  form: { gap: 16, marginTop: 42 },
  options: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  demoText: { color: Colors.green, fontFamily: Fonts.medium, fontSize: 10 },
  linkText: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 12 },
  error: {
    backgroundColor: '#FF4D5714',
    borderColor: '#FF4D5745',
    borderRadius: Radius.medium,
    borderWidth: 1,
    color: Colors.danger,
    fontFamily: Fonts.medium,
    fontSize: 12,
    padding: 12,
  },
  registerRow: { flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 2 },
  muted: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 12 },
  legal: {
    color: Colors.textFaint,
    fontFamily: Fonts.regular,
    fontSize: 9,
    lineHeight: 15,
    marginTop: 30,
    paddingHorizontal: 18,
    textAlign: 'center',
  },
});
