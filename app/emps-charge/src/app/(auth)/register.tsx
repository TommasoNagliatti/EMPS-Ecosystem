import * as Haptics from 'expo-haptics';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, LockKeyhole, Mail, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import {
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

export default function RegisterScreen() {
  const router = useRouter();
  const { chargerId, qrToken } = useLocalSearchParams<{ chargerId?: string; qrToken?: string }>();
  const { register } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!accepted) {
      setError('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await register(name, email, password);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (qrToken) router.replace(`/c/${encodeURIComponent(qrToken)}`);
      else if (chargerId) router.replace(`/charger/${chargerId}`);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Não foi possível criar a conta.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.glow} />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            role="main"
            showsVerticalScrollIndicator={false}>
            <View style={styles.inner}>
              <Brand subtitle="Charge" />
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>BEM-VINDO À EMPS</Text>
                <Text accessibilityRole="header" style={styles.title}>Crie sua conta.</Text>
                <Text style={styles.subtitle}>
                  Só precisamos do essencial para você começar a carregar.
                </Text>
              </View>

              <View style={styles.form}>
                <AppInput
                  autoCapitalize="words"
                  autoComplete="name"
                  icon={UserRound}
                  label="Nome completo"
                  onChangeText={setName}
                  placeholder="Seu nome"
                  value={name}
                />
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
                  autoComplete="new-password"
                  icon={LockKeyhole}
                  label="Senha"
                  onChangeText={setPassword}
                  placeholder="Mínimo de 8 caracteres"
                  secureTextEntry
                  value={password}
                />

                <Pressable
                  aria-checked={accepted}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: accepted }}
                  onPress={() => setAccepted((current) => !current)}
                  style={styles.termsRow}>
                  <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
                    {accepted ? <Check color={Colors.white} size={14} strokeWidth={3} /> : null}
                  </View>
                  <Text style={styles.termsText}>
                    Li e aceito os <Text style={styles.termsLink}>Termos de Uso</Text> e a{' '}
                    <Text style={styles.termsLink}>Política de Privacidade</Text>.
                  </Text>
                </Pressable>

                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AppButton loading={loading} onPress={handleRegister} title="Criar minha conta" />

                <View style={styles.loginRow}>
                  <Text style={styles.muted}>Já tem uma conta?</Text>
                  <Link
                    href={
                      qrToken
                        ? { pathname: '/login', params: { qrToken } }
                        : chargerId
                        ? { pathname: '/login', params: { chargerId } }
                        : { pathname: '/login' }
                    }
                    asChild>
                    <Pressable><Text style={styles.linkText}>Entrar</Text></Pressable>
                  </Link>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Colors.background, flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  glow: {
    backgroundColor: '#FF323A17',
    borderRadius: 240,
    height: 480,
    left: -310,
    position: 'absolute',
    top: -90,
    width: 480,
  },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20 },
  inner: { alignSelf: 'center', maxWidth: MaxContentWidth, width: '100%' },
  hero: { marginTop: 46 },
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
    letterSpacing: -1,
    marginTop: 10,
  },
  subtitle: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  form: { gap: 16, marginTop: 36 },
  termsRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 11, paddingHorizontal: 4 },
  checkbox: {
    alignItems: 'center',
    borderColor: Colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 21,
    justifyContent: 'center',
    marginTop: 1,
    width: 21,
  },
  checkboxChecked: { backgroundColor: Colors.coral, borderColor: Colors.coral },
  termsText: {
    color: Colors.textMuted,
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 11,
    lineHeight: 18,
  },
  termsLink: { color: Colors.text, fontFamily: Fonts.semiBold },
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
  loginRow: { flexDirection: 'row', gap: 7, justifyContent: 'center' },
  muted: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 12 },
  linkText: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 12 },
});
