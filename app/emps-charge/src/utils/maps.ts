import { Linking, Platform } from 'react-native';

import type { Station } from '@/domain/models';

export async function openDirections(station: Station) {
  const destination = `${station.coordinates.latitude},${station.coordinates.longitude}`;
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${destination}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  await Linking.openURL(url);
}
