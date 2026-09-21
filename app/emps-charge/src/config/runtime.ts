export const EMPS_DEMO_MODE = process.env.EXPO_PUBLIC_EMPS_DEMO_MODE === 'true';
export const EMPS_API_URL = process.env.EXPO_PUBLIC_EMPS_API_URL?.trim() ?? '';
export const STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? '';
