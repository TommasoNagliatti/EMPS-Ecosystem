import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LogoMark } from '@/components/brand';
import { PaymentProvider } from '@/components/payment-provider';
import { Colors } from '@/constants/theme';
import { AppProvider, useApp } from '@/context/app-context';

SplashScreen.preventAutoHideAsync();

function Navigation() {
  const { isHydrated, user } = useApp();
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  const ready = isHydrated && (fontsLoaded || Boolean(fontError));

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <LogoMark size={88} />
      </View>
    );
  }

  return (
    <>
      <Head>
        <title>EMPS Charge</title>
        <meta
          name="description"
          content="Encontre eletropostos, escaneie o QR Code e acompanhe sua recarga com o EMPS Charge."
        />
      </Head>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: Colors.background },
          headerShown: false,
        }}>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(user)}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="station/[id]" />
          <Stack.Screen name="charger/[id]" />
          <Stack.Screen name="checkout" />
          <Stack.Screen name="charging" options={{ gestureEnabled: false }} />
          <Stack.Screen name="receipt" />
          <Stack.Screen
            name="scan"
            options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }}
          />
        </Stack.Protected>
        <Stack.Screen name="c/[token]" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <PaymentProvider>
        <AppProvider>
          <Navigation />
        </AppProvider>
      </PaymentProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  splash: {
    alignItems: 'center',
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
