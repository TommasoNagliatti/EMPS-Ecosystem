import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors, Fonts, Radius, Shadow } from '@/constants/theme';

type AppButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  style,
  accessibilityHint,
}: AppButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        variant === 'primary' && Shadow.coral,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}>
      {loading ? <ActivityIndicator color={Colors.white} size="small" /> : icon}
      <Text style={[styles.label, variant === 'ghost' && styles.ghostLabel]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 22,
  },
  primary: { backgroundColor: Colors.coralAction },
  secondary: {
    backgroundColor: Colors.surfaceSoft,
    borderColor: Colors.border,
    borderWidth: 1,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: Colors.border,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: Colors.coralSoft,
    borderColor: `${Colors.coral}66`,
    borderWidth: 1,
  },
  label: { color: Colors.white, fontFamily: Fonts.semiBold, fontSize: 15 },
  ghostLabel: { color: Colors.text },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },
});
