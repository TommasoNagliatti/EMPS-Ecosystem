export type DemoAnalyticsGrain = 'day' | 'week' | 'month' | 'year';

export type DemoAnalyticsEnergy = {
  intervalCount: number;
  buildingKwh: number | null;
  solarKwh: number | null;
  evDeliveredKwh: number | null;
  gridImportKwh: number | null;
  evRequestedKwhDerived: number | null;
};

export type DemoStationAnalytics = {
  context: 'SIMULATED';
  station: { id: number | string; name: string; timezone: string };
  source: {
    batchId: number | string;
    datasetKey: string;
    datasetSha256: string;
    scenarioVersion: string;
    sourceScenarioVersion?: string;
    periodStart: string | null;
    periodEnd: string | null;
    timezone: string;
    utcOffset: string;
    origin: 'SIMULATED';
  } | null;
  period: { from: string | null; to: string | null; grain: DemoAnalyticsGrain };
  totals: DemoAnalyticsEnergy & {
    peakBuildingKw: number | null;
    peakEvDeliveredKw: number | null;
    peakEvRequestedKw: number | null;
    utilizationPct: number | null;
    queueIntervals: number | null;
    chargerUtilization: { sourceChargerId: string; utilizationPct: number | null }[];
  };
  estimates?: {
    gridImportProxyKwh: number | null;
    solarSurplusProxyKwh: number | null;
    intervalCount: number;
    method: string;
    measured: false;
    kind: 'HYPOTHETICAL_PROXY';
  };
  points: {
    at: string;
    buildingKw: number | null;
    solarKw: number | null;
    evDeliveredKw: number | null;
    evRequestedKw: number | null;
    gridKw: number | null;
    intervalCount: number;
  }[];
  buckets: (DemoAnalyticsEnergy & { start: string; end: string })[];
};
