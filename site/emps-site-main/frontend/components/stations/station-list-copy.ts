export const stationListCopy = {
  'pt-BR': {
    title: 'Minhas instalações', filter: 'Filtro', name: 'Nome da instalação/dispositivo, SN', address: 'Endereço da instalação', email: 'E-mail',
    search: 'Buscar instalações', reset: 'Limpar filtros', refresh: 'Atualizar instalações', newStation: 'Nova instalação', reviews: 'Revisões da plataforma',
    language: 'Idioma', columnsTitle: 'Colunas da tabela', info: 'Informações da instalação', operation: 'Operação',
    tabs: { all: 'Todas', monthly: 'Criadas neste mês', running: 'Em operação', waiting: 'Aguardando', offline: 'Offline', fault: 'Falha', constructing: 'Em construção' },
    columns: { solarPower: 'Potência FV (kW)', equivalentHours: 'Horas equivalentes de carga plena (diária) (H)', dischargedTotal: 'Energia descarregada total (kWh)', chargedTotal: 'Energia carregada total (kWh)', solarCapacity: 'Capacidade solar (kWp)', batterySoc: 'SOC da bateria (%)', batteryPower: 'Potência da bateria (kW)', gridPower: 'Potência da rede (kW)', irradiance: 'Irradiância (W/m²)', kind: 'Tipo de instalação', irradiation: 'Irradiação diária (kWh/m²)', dischargedToday: 'Energia descarregada hoje (kWh)', chargedToday: 'Energia carregada hoje (kWh)', storageCapacity: 'Capacidade de armazenamento (kWh)', generationTotal: 'Geração acumulada (kWh)', status: 'Status da instalação' },
    kinds: { charging: 'Recarga', solar: 'Solar', storage: 'Armazenamento', hybrid: 'Solar e armazenamento' },
    advanced: { kind: 'Tipo de instalação', owner: 'Responsável', allOwners: 'Todos os responsáveis', power: 'Potência nominal', min: 'Mín.', max: 'Máx.', source: 'Origem da instalação', managed: 'Gerenciadas por mim', shared: 'Compartilhadas comigo', starred: 'Somente favoritas', confirm: 'Confirmar', reset: 'Redefinir', rangeError: 'A potência máxima deve ser maior ou igual à mínima.' },
    statuses: { running: 'Há carregadores habilitados com estado operacional disponível.', waiting: 'Aguardando aprovação ou confirmação do estado dos equipamentos.', offline: 'Instalação inativa ou equipamentos indisponíveis/offline.', fault: 'Instalação em manutenção ou carregador com falha.', constructing: 'Rascunho ou instalação em ajuste de cadastro.' },
    public: 'Pública', private: 'Privada', shared: 'Compartilhada', noAddress: 'Localização a completar', noData: 'Sem dados', loading: 'Carregando instalações', failed: 'Não foi possível carregar as instalações.', retry: 'Tentar novamente', noMetric: 'Leitura indisponível ou desatualizada', noPhoto: 'Sem foto',
    favorite: 'Adicionar aos favoritos', unfavorite: 'Remover dos favoritos', more: 'Mais opções', dashboard: 'Abrir painel', settings: 'Configurações', telemetry: 'Telemetria', continueDraft: 'Continuar cadastro',
    previous: 'Página anterior', next: 'Próxima página', page: 'Página', perPage: '/ página', results: 'instalações', sort: 'Ordenar por', close: 'Fechar',
  },
  en: {
    title: 'My installations', filter: 'Filter', name: 'Station/Device Name, SN', address: 'Station Address', email: 'Email',
    search: 'Search stations', reset: 'Clear filters', refresh: 'Refresh stations', newStation: 'New Station', reviews: 'Platform reviews',
    language: 'Language', columnsTitle: 'Table columns', info: 'Station Information', operation: 'Operation',
    tabs: { all: 'All', monthly: 'Monthly New', running: 'Running', waiting: 'Waiting', offline: 'Offline', fault: 'Fault', constructing: 'Constructing' },
    columns: { solarPower: 'PV Power (kW)', equivalentHours: 'Daily Equivalent Full Load Hours (H)', dischargedTotal: 'Total Discharged (kWh)', chargedTotal: 'Total Charged (kWh)', solarCapacity: 'PV Capacity (kWp)', batterySoc: 'Battery SOC (%)', batteryPower: 'Battery Power (kW)', gridPower: 'Grid Power (kW)', irradiance: 'Irradiance (W/m²)', kind: 'Station Type', irradiation: 'Daily Irradiation (kWh/m²)', dischargedToday: "Today's Discharged (kWh)", chargedToday: "Today's Charged (kWh)", storageCapacity: 'Energy Storage Capacity (kWh)', generationTotal: 'Cumulative Generation (kWh)', status: 'Station Status' },
    kinds: { charging: 'Charging', solar: 'Solar', storage: 'Energy storage', hybrid: 'Solar and storage' },
    advanced: { kind: 'Station Type', owner: 'Owner', allOwners: 'All owners', power: 'Rated Power', min: 'Min', max: 'Max', source: 'Station Source', managed: 'Managed by me', shared: 'Shared with me', starred: 'Starred only', confirm: 'Confirm', reset: 'Reset', rangeError: 'Maximum power must be greater than or equal to minimum power.' },
    statuses: { running: 'Enabled chargers report an operational state.', waiting: 'Waiting for approval or confirmed equipment status.', offline: 'Inactive station or unavailable/offline equipment.', fault: 'Station under maintenance or charger reporting a fault.', constructing: 'Draft station or registration changes in progress.' },
    public: 'Public', private: 'Private', shared: 'Shared', noAddress: 'Location pending', noData: 'No Data', loading: 'Loading stations', failed: 'Unable to load stations.', retry: 'Try again', noMetric: 'Reading unavailable or outdated', noPhoto: 'No photo',
    favorite: 'Add to favorites', unfavorite: 'Remove from favorites', more: 'More options', dashboard: 'Open dashboard', settings: 'Settings', telemetry: 'Telemetry', continueDraft: 'Continue setup',
    previous: 'Previous page', next: 'Next page', page: 'Page', perPage: '/ page', results: 'stations', sort: 'Sort by', close: 'Close',
  },
};

export type StationListCopy = (typeof stationListCopy)['pt-BR' | 'en'];
