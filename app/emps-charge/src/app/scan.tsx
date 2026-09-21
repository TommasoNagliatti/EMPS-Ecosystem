import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Flashlight, Keyboard, ScanLine, ShieldCheck, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';

export default function ScanScreen() {
  const router = useRouter();
  const { activeSession, resolveQrCode } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [nativeScannerOpening, setNativeScannerOpening] = useState(false);
  const [manualCode, setManualCode] = useState('EMPS-PAULISTA-A01');
  const [error, setError] = useState('');
  const scanLock = useRef(false);

  const processCode = useCallback(
    async (value: string, source: 'camera' | 'android-native' | 'manual') => {
      if (scanLock.current) return;
      scanLock.current = true;
      setScanned(true);
      setError('');
      console.info('[qr-scanner] código detectado', {
        source,
        preview: value.slice(0, 80),
      });
      try {
        const resolution = await resolveQrCode(value);
        console.info('[qr-scanner] carregador resolvido', {
          source,
          chargerId: resolution.charger.id,
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace(`/charger/${resolution.charger.id}`);
        return;
      } catch (resolutionError) {
        const message =
          resolutionError instanceof Error
            ? resolutionError.message
            : 'Não foi possível confirmar este QR.';
        console.warn('[qr-scanner] código rejeitado', { source, reason: message });
        setError(message);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => {
          scanLock.current = false;
          setScanned(false);
        }, 1800);
      }
    },
    [resolveQrCode, router],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = CameraView.onModernBarcodeScanned((result) => {
      void processCode(result.data, 'android-native');
    });
    return () => subscription.remove();
  }, [processCode]);

  useFocusEffect(
    useCallback(() => {
      scanLock.current = false;
      setScanned(false);
      setCameraReady(false);
      setIsFocused(true);

      return () => {
        setIsFocused(false);
        setCameraReady(false);
        setTorch(false);
      };
    }, []),
  );

  async function openNativeScanner() {
    if (!CameraView.isModernBarcodeScannerAvailable) {
      setError(
        'O leitor nativo não está disponível neste aparelho. Atualize o Google Play Services e use a câmera acima ou o código da vaga.',
      );
      console.warn('[qr-scanner] leitor nativo indisponível');
      return;
    }

    setError('');
    setNativeScannerOpening(true);
    console.info('[qr-scanner] abrindo leitor nativo');
    try {
      await CameraView.launchScanner({ barcodeTypes: ['qr'] });
    } catch (scannerError) {
      const message = scannerError instanceof Error ? scannerError.message : String(scannerError);
      if (!message.toLowerCase().includes('cancel')) {
        console.error('[qr-scanner] falha no leitor nativo', { message });
        setError(`Não foi possível abrir o leitor do Android: ${message}`);
      }
    } finally {
      setNativeScannerOpening(false);
    }
  }

  if (activeSession) return <Redirect href="/charging" />;

  const cameraGranted = Boolean(permission?.granted);
  const cannotAskAgain = permission && !permission.granted && !permission.canAskAgain;

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View role="main" style={styles.content}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Fechar leitor"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <X color={Colors.text} size={22} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.title}>Escanear QR</Text>
              <Text style={styles.subtitle}>Aponte para o adesivo da vaga</Text>
            </View>
            <Pressable
              accessibilityLabel={torch ? 'Desligar lanterna' : 'Ligar lanterna'}
              accessibilityRole="button"
              disabled={!cameraGranted}
              onPress={() => setTorch((current) => !current)}
              style={({ pressed }) => [
                styles.closeButton,
                torch && styles.torchActive,
                pressed && styles.pressed,
              ]}>
              <Flashlight color={torch ? Colors.coral : Colors.text} size={20} />
            </Pressable>
          </View>

          <View style={styles.cameraShell}>
            {cameraGranted && isFocused ? (
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                enableTorch={torch}
                facing="back"
                onBarcodeScanned={
                  scanned
                    ? undefined
                    : (result: BarcodeScanningResult) => processCode(result.data, 'camera')
                }
                onCameraReady={() => {
                  setCameraReady(true);
                  console.info('[qr-scanner] câmera pronta');
                }}
                onMountError={(event) => {
                  setCameraReady(false);
                  setError(`Não foi possível iniciar a câmera: ${event.message}`);
                  console.error('[qr-scanner] falha ao iniciar câmera', {
                    message: event.message,
                  });
                }}
                style={StyleSheet.absoluteFill}
              />
            ) : !cameraGranted ? (
              <View style={styles.permissionState}>
                <View style={styles.permissionIcon}>
                  <ScanLine color={Colors.coral} size={38} />
                </View>
                <Text style={styles.permissionTitle}>Permita o acesso à câmera</Text>
                <Text style={styles.permissionText}>
                  A câmera só é usada enquanto esta tela estiver aberta para ler o QR do carregador.
                </Text>
                <AppButton
                  onPress={cannotAskAgain ? Linking.openSettings : requestPermission}
                  style={styles.permissionButton}
                  title={cannotAskAgain ? 'Abrir ajustes' : 'Permitir câmera'}
                />
              </View>
            ) : null}

            {cameraGranted && isFocused ? (
              <>
                <View pointerEvents="none" style={styles.cameraShade} />
                <View pointerEvents="none" style={styles.frame}>
                  <View style={[styles.corner, styles.topLeft]} />
                  <View style={[styles.corner, styles.topRight]} />
                  <View style={[styles.corner, styles.bottomLeft]} />
                  <View style={[styles.corner, styles.bottomRight]} />
                  <View style={styles.scanLine} />
                </View>
                <View pointerEvents="none" style={styles.cameraHint}>
                  <Text style={styles.cameraHintText}>
                    {scanned
                      ? 'QR detectado · verificando código…'
                      : cameraReady
                        ? 'Câmera pronta · centralize o QR'
                        : 'Iniciando câmera…'}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {Platform.OS === 'android' ? (
            <AppButton
              icon={!nativeScannerOpening ? <ScanLine color={Colors.white} size={18} /> : undefined}
              loading={nativeScannerOpening}
              onPress={openNativeScanner}
              style={styles.nativeScannerButton}
              title="Usar leitor nativo do Android"
              variant="secondary"
            />
          ) : null}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.manualCard}>
            <View style={styles.manualHeader}>
              <View style={styles.manualIcon}>
                <Keyboard color={Colors.cyan} size={18} />
              </View>
              <View style={styles.manualCopy}>
                <Text style={styles.manualTitle}>Código da vaga</Text>
                <Text style={styles.manualSubtitle}>Use se a câmera não conseguir ler o QR</Text>
              </View>
            </View>
            <View style={styles.manualRow}>
              <TextInput
                autoCapitalize="characters"
                onChangeText={setManualCode}
                onSubmitEditing={() => processCode(manualCode, 'manual')}
                placeholder="Ex.: EMPS-PAULISTA-A01"
                placeholderTextColor={Colors.textFaint}
                selectionColor={Colors.coral}
                style={styles.manualInput}
                value={manualCode}
              />
              <Pressable
                accessibilityLabel="Confirmar código da vaga"
                accessibilityRole="button"
                onPress={() => processCode(manualCode, 'manual')}
                style={({ pressed }) => [styles.manualSubmit, pressed && styles.pressed]}>
                <Text style={styles.manualSubmitText}>OK</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.securityNote}>
            <ShieldCheck color={Colors.green} size={16} />
            <Text style={styles.securityText}>
              O QR identifica a vaga. Disponibilidade, tarifa e segurança são confirmadas novamente antes da recarga.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Colors.black, flex: 1 },
  safeArea: { flex: 1 },
  content: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: 18,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 66,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  torchActive: { backgroundColor: Colors.coralSoft, borderColor: `${Colors.coral}60` },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  headerCopy: { flex: 1 },
  title: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 17, textAlign: 'center' },
  subtitle: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 9,
    marginTop: 2,
    textAlign: 'center',
  },
  cameraShell: {
    backgroundColor: Colors.backgroundElevated,
    borderColor: Colors.border,
    borderRadius: Radius.large,
    borderWidth: 1,
    height: 360,
    marginTop: 10,
    overflow: 'hidden',
  },
  cameraShade: {
    backgroundColor: '#00000020',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  frame: {
    height: 218,
    left: '50%',
    marginLeft: -109,
    marginTop: -109,
    position: 'absolute',
    top: '48%',
    width: 218,
  },
  corner: { borderColor: Colors.coral, height: 42, position: 'absolute', width: 42 },
  topLeft: { borderLeftWidth: 4, borderTopLeftRadius: 16, borderTopWidth: 4, left: 0, top: 0 },
  topRight: { borderRightWidth: 4, borderTopRightRadius: 16, borderTopWidth: 4, right: 0, top: 0 },
  bottomLeft: { borderBottomLeftRadius: 16, borderBottomWidth: 4, borderLeftWidth: 4, bottom: 0, left: 0 },
  bottomRight: { borderBottomRightRadius: 16, borderBottomWidth: 4, borderRightWidth: 4, bottom: 0, right: 0 },
  scanLine: {
    backgroundColor: Colors.coralAction,
    boxShadow: `0 0 12px ${Colors.coral}`,
    height: 2,
    left: 18,
    position: 'absolute',
    right: 18,
    top: '50%',
  },
  cameraHint: {
    alignItems: 'center',
    bottom: 18,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  cameraHintText: {
    backgroundColor: '#000000B8',
    borderRadius: Radius.pill,
    color: Colors.white,
    fontFamily: Fonts.medium,
    fontSize: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  permissionState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  permissionIcon: {
    alignItems: 'center',
    backgroundColor: Colors.coralSoft,
    borderRadius: 28,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  permissionTitle: {
    color: Colors.text,
    fontFamily: Fonts.semiBold,
    fontSize: 15,
    marginTop: 16,
  },
  permissionText: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 7,
    textAlign: 'center',
  },
  permissionButton: { marginTop: 16, minHeight: 46, width: '82%' },
  errorBox: {
    backgroundColor: '#FF4D5718',
    borderColor: '#FF4D5750',
    borderRadius: Radius.medium,
    borderWidth: 1,
    marginTop: 10,
    padding: 11,
  },
  errorText: { color: Colors.danger, fontFamily: Fonts.medium, fontSize: 10, textAlign: 'center' },
  nativeScannerButton: { marginTop: 10, minHeight: 48 },
  manualCard: {
    backgroundColor: Colors.surface,
    borderColor: Colors.borderSoft,
    borderRadius: Radius.large,
    borderWidth: 1,
    gap: 12,
    marginTop: 14,
    padding: 14,
  },
  manualHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  manualIcon: {
    alignItems: 'center',
    backgroundColor: '#36C9DC18',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  manualCopy: { flex: 1 },
  manualTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  manualSubtitle: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 8, marginTop: 2 },
  manualRow: { flexDirection: 'row', gap: 8 },
  manualInput: {
    backgroundColor: Colors.backgroundElevated,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    borderWidth: 1,
    color: Colors.text,
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 10,
    height: 46,
    paddingHorizontal: 12,
  },
  manualSubmit: {
    alignItems: 'center',
    backgroundColor: Colors.coralAction,
    borderRadius: Radius.medium,
    height: 46,
    justifyContent: 'center',
    width: 52,
  },
  manualSubmitText: { color: Colors.white, fontFamily: Fonts.bold, fontSize: 12 },
  securityNote: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 5,
  },
  securityText: {
    color: Colors.textFaint,
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 8,
    lineHeight: 13,
  },
});
