import { ChevronLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
};

export function PageHeader({ title, subtitle, onBack, right }: PageHeaderProps) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel="Voltar"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack ?? (() => router.back())}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ChevronLeft color={Colors.text} size={22} />
      </Pressable>
      <View style={styles.copy}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 54 },
  back: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  pressed: { opacity: 0.7 },
  copy: { flex: 1 },
  title: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 17 },
  subtitle: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    marginTop: 1,
  },
  right: { minWidth: 42 },
});
