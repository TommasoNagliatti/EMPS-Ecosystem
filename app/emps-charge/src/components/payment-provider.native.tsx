import { StripeProvider } from '@stripe/stripe-react-native';
import type { PropsWithChildren } from 'react';

import { STRIPE_PUBLISHABLE_KEY } from '@/config/runtime';

export function PaymentProvider({ children }: PropsWithChildren) {
  if (!STRIPE_PUBLISHABLE_KEY) return children;

  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} urlScheme="emps">
      <>{children}</>
    </StripeProvider>
  );
}
