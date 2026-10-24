import { Alert, Linking, Platform } from 'react-native';

import type { Station } from '@/domain/models';
import { stationHasCoordinates } from '@/utils/coordinates';

export async function openDirections(station: Station) {
  if (!stationHasCoordinates(station)) {
    Alert.alert('Localização indisponível', 'Esta estação não possui coordenadas cadastradas. A recarga pelo QR continua disponível.');
    return;
  }
  const destination = `${station.coordinates.latitude},${station.coordinates.longitude}`;
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${destination}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  await Linking.openURL(url);
}
