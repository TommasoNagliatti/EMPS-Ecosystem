import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { Colors, Fonts } from '@/constants/theme';
import { useApp } from '@/context/app-context';

export default function ChargerDeepLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { resolveQrCode, user } = useApp();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || typeof token !== 'string') return;
    let active = true;
    resolveQrCode(token)
      .then((resolution) => {
        if (active) router.replace(`/charger/${resolution.charger.id}`);
      })
      .catch((resolutionError) => {
        if (active) {
          setError(
            resolutionError instanceof Error
              ? resolutionError.message
              : 'Não foi possível confirmar este QR.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [resolveQrCode, router, token, user]);

  if (!user) {
    return (
      <Redirect
        href={
          typeof token === 'string'
            ? { pathname: '/login', params: { qrToken: token } }
            : '/login'
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {error ? (
          <>
            <Text style={styles.title}>QR não confirmado</Text>
            <Text style={styles.message}>{error}</Text>
            <AppButton onPress={() => router.replace('/scan')} title="Ler outro QR" />
          </>
        ) : (
          <>
            <ActivityIndicator color={Colors.coral} size="large" />
            <Text style={styles.title}>Confirmando QR com a EMPS…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  content: { flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  title: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 20, textAlign: 'center' },
  message: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 12, textAlign: 'center' },
});
