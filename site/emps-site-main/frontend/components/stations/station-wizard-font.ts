import localFont from 'next/font/local';

export const stationWizardFont = localFont({
  src: [
    { path: '../../public/fonts/poppins/Poppins-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/poppins/Poppins-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../../public/fonts/poppins/Poppins-SemiBold.ttf', weight: '600', style: 'normal' },
  ],
  display: 'swap',
});
