import localFont from 'next/font/local';
import { StationList } from '@/components/stations/StationList';

const poppins = localFont({
  src: [
    { path: '../../public/fonts/poppins/Poppins-Regular.ttf', weight: '400' },
    { path: '../../public/fonts/poppins/Poppins-Medium.ttf', weight: '500' },
    { path: '../../public/fonts/poppins/Poppins-SemiBold.ttf', weight: '600' },
    { path: '../../public/fonts/poppins/Poppins-Bold.ttf', weight: '700' },
  ],
  display: 'swap',
});

export default function StationsPage() {
  return <StationList fontClassName={poppins.className} />;
}
