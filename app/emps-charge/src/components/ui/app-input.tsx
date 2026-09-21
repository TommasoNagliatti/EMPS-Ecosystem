import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';

type AppInputProps = TextInputProps & {
  label: string;
  icon: LucideIcon;
  error?: string;
};

export function AppInput({ label, icon: Icon, error, secureTextEntry, ...props }: AppInputProps) {
  const [isSecure, setIsSecure] = useState(Boolean(secureTextEntry));

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, error && styles.fieldError]}>
        <Icon color={Colors.textMuted} size={19} strokeWidth={2} />
        <TextInput
          {...props}
          accessibilityLabel={props.accessibilityLabel ?? label}
          placeholderTextColor={Colors.textFaint}
          secureTextEntry={isSecure}
          selectionColor={Colors.coral}
          style={styles.input}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityLabel={isSecure ? 'Mostrar senha' : 'Ocultar senha'}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setIsSecure((current) => !current)}>
            {isSecure ? (
              <Eye color={Colors.textMuted} size={19} />
            ) : (
              <EyeOff color={Colors.textMuted} size={19} />
            )}
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  label: {
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 12,
    marginLeft: 4,
  },
  field: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 54,
    paddingHorizontal: 17,
  },
  fieldError: { borderColor: Colors.danger },
  input: {
    color: Colors.text,
    flex: 1,
    fontFamily: Fonts.medium,
    fontSize: 14,
    minHeight: 52,
    paddingVertical: 0,
  },
  error: {
    color: Colors.danger,
    fontFamily: Fonts.medium,
    fontSize: 11,
    marginLeft: 5,
  },
});
