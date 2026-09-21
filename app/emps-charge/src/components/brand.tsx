import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';

type BrandProps = {
  compact?: boolean;
  subtitle?: string;
};

export function Brand({ compact = false, subtitle }: BrandProps) {
  if (compact) {
    return (
      <View style={styles.compactRow}>
        <View style={styles.compactMark}>
          <Image
            source={require('@/assets/images/emps-icon-silver.png')}
            style={styles.compactImage}
            contentFit="contain"
            alt=""
            accessibilityLabel=""
          />
        </View>
        <View>
          <Text style={styles.compactName}>EMPS</Text>
          <Text style={styles.compactProduct}>CHARGE</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Image
        source={require('@/assets/images/emps-logo-red.png')}
        style={styles.logo}
        contentFit="contain"
        contentPosition="left"
        alt="Logotipo EMPS Charge"
        accessibilityLabel="Logotipo EMPS Charge"
      />
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={require('@/assets/images/emps-icon-silver.png')}
        style={{ width: size * 0.38, height: size * 0.58 }}
        contentFit="contain"
        alt="Símbolo EMPS"
        accessibilityLabel="Símbolo EMPS"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 154,
    height: 52,
  },
  subtitle: {
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 12,
    letterSpacing: 2.4,
    marginLeft: 3,
    marginTop: -3,
    textTransform: 'uppercase',
  },
  compactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  compactMark: {
    alignItems: 'center',
    backgroundColor: Colors.coral,
    borderRadius: Radius.small,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  compactImage: {
    height: 27,
    width: 18,
  },
  compactName: {
    color: Colors.text,
    fontFamily: Fonts.bold,
    fontSize: 16,
    letterSpacing: 1,
    lineHeight: 18,
  },
  compactProduct: {
    color: Colors.coralText,
    fontFamily: Fonts.semiBold,
    fontSize: 8,
    letterSpacing: 2,
    lineHeight: 10,
  },
  mark: {
    alignItems: 'center',
    backgroundColor: Colors.coral,
    justifyContent: 'center',
  },
});
