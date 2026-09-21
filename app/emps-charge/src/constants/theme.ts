import { Platform } from 'react-native';

export const Colors = {
  background: '#0B0C0F',
  backgroundElevated: '#111318',
  surface: '#202224',
  surfaceSoft: '#2B2D30',
  surfaceRaised: '#34363A',
  border: '#34363A',
  borderSoft: '#292B2F',
  text: '#F5F7FB',
  textMuted: '#A7ADB5',
  textFaint: '#858C94',
  coral: '#FF323A',
  coralText: '#FF3F48',
  coralAction: '#D91F32',
  coralDark: '#B3122D',
  coralSoft: '#FF323A1F',
  cyan: '#36C9DC',
  blue: '#4D91FF',
  green: '#2CD28A',
  greenSoft: '#2CD28A1F',
  orange: '#FF785C',
  yellow: '#F5BE4F',
  violet: '#9580FF',
  danger: '#FF4D57',
  white: '#FFFFFF',
  black: '#000000',
  overlay: '#000000A8',
  light: {
    text: '#0B0C0F',
    background: '#F5F7FB',
    backgroundElement: '#E8EAED',
    backgroundSelected: '#D8DADF',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#F5F7FB',
    background: '#0B0C0F',
    backgroundElement: '#202224',
    backgroundSelected: '#2B2D30',
    textSecondary: '#A7ADB5',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 10,
  medium: 16,
  large: 22,
  xlarge: 30,
  pill: 999,
} as const;

export const Shadow = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 8,
  },
  coral: {
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

export const MaxContentWidth = 760;
export const BottomTabInset = Platform.select({ ios: 74, android: 82, web: 76 }) ?? 76;
