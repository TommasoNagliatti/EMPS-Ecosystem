export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type ChargerStatus = 'available' | 'in_use' | 'offline' | 'maintenance';
export type ConnectorType = 'CCS2' | 'Tipo 2' | 'CHAdeMO';
export type PaymentMethod = 'pix' | 'card' | 'wallet';
export type SessionStatus = 'starting' | 'charging' | 'stopping' | 'completed' | 'payment_pending';

export type TariffDisclosure={tariff_version:string;current_tariff_per_kwh:string;minimum_tariff_per_kwh:string;maximum_tariff_per_kwh:string;overstay_grace_minutes:number;overstay_fee_per_minute:string;overstay_fee_cap:string};
export type Charger = {
  paymentOptions?:{paymentProvider:string;demoPayments:boolean};
  tariff?:TariffDisclosure;
  id: string;
  publicCode: string;
  qrToken: string;
  stationId: string;
  label: string;
  bay: string;
  connectorType: ConnectorType;
  powerKw: number;
  pricePerKwh: number;
  status: ChargerStatus;
  lastUpdatedAt: string;
};

export type Station = {
  description?: string | null;
  visibility?: 'PUBLIC'|'PRIVATE';
  timezone?: string;
  availability?: {alwaysOpen:boolean;windows:{day:number;start:string;end:string}[]} | null;
  availableNow?: boolean | null;
  photos?: {id:string;position:number;path:string}[];
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  coordinates: Coordinate;
  openingHours: string;
  amenities: string[];
  chargerIds: string[];
  featured?: boolean;
};

export type ConsumerUser = {
  id: string;
  name: string;
  email: string;
};

export type ChargingSession = {
  receipt?: { reservation?:{id:string;fee:string;startAt:string;endAt:string;provider:string|null;status:string;paymentReference:string|null;totalWithCharging:string}; disposition?:{authorizedAmount:string;consumedAmount:string;capturedAmount:string;releasedAmount:string;refundDueAmount:string;refundedAmount:string;refundStatus:string;provenance:string}; paymentId:string; transactionId:string; paidAt:string|null; method:string; status:string; amountPaid:string; energyAmount:string|null; overstayFee:string|null; provider:string; providerReference?:string|null; sandbox?:boolean; tariffVersion?:string|null; effectiveRate?:string|null; fixedFee?:string|null; durationSeconds?:number|null; energyKwh?:string };
  tariffVersion?:string;
  billing?:{energy_amount:string;overstay_fee:string;total_amount:string;energy_kwh:string;effective_energy_rate_per_kwh?:string};
  billingFrozen?:boolean;
  disconnectedAt?:string;
  requestedPowerKw?: number;
  managedPower?: boolean;
  telemetrySource?: string;
  id: string;
  stationId: string;
  chargerId: string;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  paymentMethod: PaymentMethod;
  spendingLimit: number | null;
  energyKwh: number;
  totalCost: number;
  powerKw: number;
  durationSeconds: number;
  simulatedSecondsOffset: number;
  transactionId?: string;
};

export type LiveSessionMetrics = {
  durationSeconds: number;
  energyKwh: number;
  totalCost: number;
  powerKw: number;
};
