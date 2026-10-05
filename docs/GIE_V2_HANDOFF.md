# GIE V2 — handoff da Platform V2

01/10/2026. Este documento define a fronteira entre o que existe e o próximo trabalho específico do GIE. A Platform V2 não alterou Python, MPC, modelos ou artefatos congelados. Não executar treinamento/migração/ativação como consequência de ler este documento.

## Estado real atual

`gie/GIE/service/api.py` declara uma estação e uma instância serializada de controle. `GIE_STATION_ID` e `GIE_SERVICE_TOKEN` configuram o processo; há um RLock, um contexto e um GIEControl. `/context` recebe station_id, latitude/longitude, timezone e demandas, mas não cria instâncias por estação. Demand aceita no máximo quatro posições EVSE, até 22 kW por posição. Rotas atuais incluem `/health`, `/state`, `/mode`, `/context`, `/presentation/*`, `/manual-demo/event` e `/cycle`.

NORMAL, MANUAL_DEMO e PRESENTATION permanecem preservados, assim como o modo SIMULATION existente. NORMAL com `GIE_NORMAL_DEMO` produz entradas sintéticas explícitas; o nome NORMAL não torna essas entradas físicas. Presentation é demonstração visual e não autoridade comercial. Sessões/pagamentos e autorização pertencem ao Backend.

`GieService` no Backend possui uma seleção de estação, um cache e polling compartilhado para essa seleção. Envia demandas de sessões usando `gieEvseMapping`, consulta `/state` e publica atualização. Não é pool multiestação. O código impede fabricar amostras de potência quando há OCPP_GATEWAY_URL. Regras de cutover da tarifação impedem repricing/avanço de sessões históricas. No preview Platform V2 o polling está desabilitado.

O runtime usa History, CurrentState, previsão do prédio, previsão de demanda EV, solar, gerenciamento e load balancer. CurrentState tem SOC agregado; o controle individual de múltiplas baterias não existe. O perfil `Commercial_HighAutonomy_V2` é validado contra a política congelada. `motor_gerenciamento_v2/runtime_adapter.py` reutiliza a implementação do ciclo com dependências isoladas; não foi reescrito nesta tarefa.

## Integração existente e mudanças da Platform V2

A integração anterior já levava identidade de estação/demandas ao GIE, recebia estado/modos, mapeava quatro EVSEs e separava Presentation de sessão comercial. Nesta Platform V2 foram adicionados escopo de estação no controller e evento realtime, autorização por associação e capability de apresentação para operações de modo/eventos. Modelos, otimização, alocação e política energética não mudaram.

Agora existem ativos individuais, ciclo de aprovação, telemetria com fonte/proveniência, histórico importado, dataset selecionável e readiness. Aprovação persiste um snapshot `gieProvisioning`; não chama Python nem ativa hardware. `gie-v2-contract.ts` expande o snapshot em um contrato de handoff somente leitura.

## Contrato preparado por estação

GET `/v2/stations/:id/telemetry/readiness` inclui `gieContract`, exportável no Site. Campos principais:

- schema_version 2.0, contract_status PREPARED_NOT_ACTIVATED;
- station_id, timezone IANA, grid.powerLimitKw;
- chargers com identidade, potência e identidade OCPP;
- batteries e solarAssets individuais, identidade/status e parâmetros cadastrados;
- compatibilityStorage agregado e individualControlAvailable false;
- availability com janelas da estação e availabilityContext CURRENT_STATION_CONFIGURATION;
- model GIE Base, personalized false, registryStatus FUTURE;
- runtime.multiStationAvailable false, individualBatteryControlAvailable false;
- contrato de origens/intervalo/tempo/features e automaticActivation false.

Ativos técnicos vêm do snapshot aprovado. Disponibilidade é a configuração operacional atual autorizada, também incluída nos próximos snapshots de aprovação; esse contexto é explícito para snapshots anteriores sem availability. A exportação não atualiza silenciosamente o snapshot antigo. O consumidor futuro deve validar capacidades habilitadas, versões e estado atual antes de operar; ainda não há endpoint Python que consuma esse contrato completo.

Rede limita capacidade; não é medição. Solar pode ser ausente. Array vazio não significa irradiância medida zero. Baterias preservam IDs e INACTIVE; agregado considera apenas ativas e pondera SOC por kWh, sem converter SOC cadastrado em telemetria. Múltiplos carregadores podem existir na plataforma; o limite atual de quatro slots GIE continua real. Não mapear silenciosamente carregadores adicionais ou somar ativos heterogêneos como se fossem controlados individualmente.

## Proveniência e confiança

| Origem | Semântica e uso |
| --- | --- |
| MEASURED | Leitura física de fonte verificada por revisor, com evidência auditada |
| CALCULATED | Derivação rastreável; média de parents físicos da mesma estação no fluxo atual |
| EXTERNAL | Fonte externa; autenticidade física local não é presumida |
| FORECAST | Previsão com instante futuro; nunca alvo medido |
| SIMULATED | Demo/simulação explícita; nunca alvo medido |
| IMPORTED | Histórico fornecido em arquivo; não promovido a leitura física |

Token opaco da fonte é salvo como hash e vinculado a station_id/origem. Verificação física é decisão humana autorizada com evidência; não é certificação automática ou prova de hardware por um teste sintético. Revogação bloqueia novos envios e preserva histórico. Reclassificação automática não existe. Qualidade GOOD é validação registrada de entrada, não atestado metrológico. `readingSource=MANUAL` é enum legado de transporte usado em novos envios/importação; não substitui provenance/sourceId como critério de confiança.

Leituras usam StationEnergyReading; fontes usam TelemetrySource; auditoria usa StationAuditEvent. Snapshots completos de intervalo reutilizam GieIntervalSnapshot, com provenance JSON contendo kind/source_id/reading_id ou import_batch_id. Intervalo já existente não é sobrescrito nem reetiquetado. Legado sem proveniência permanece fora do dataset físico.

Nenhuma fonte física persistente foi falsamente verificada para demonstrar readiness. Fixtures visuais da estação 24 contêm seis registros IMPORTED. Fonte física verificada dos testes existiu apenas dentro de transação revertida. UI mostra zero dias/intervalos físicos, qualidade indisponível e nenhuma última leitura confiável.

## Histórico, tempo e features

Importação aceita CSV/XLSX canônicos em intervalos contínuos de 15 minutos, uma planilha, ISO textual com offset, sem fórmulas/duplicatas/lacunas. Limites: 8 MB e 10000 linhas. Timezone declarado deve ser o da estação; o offset do timestamp é a autoridade do instante. A importação não deduz unidade, não imputa ausência, não altera timezone implicitamente e não ativa modelo. Hash/lote/fonte permitem replay e auditoria; arquivo bruto não fica armazenado pelo endpoint.

Exportação exige station_id via rota autorizada e origem MEASURED verificada ou IMPORTED escolhida explicitamente. FORECAST/SIMULATED/EXTERNAL/CALCULATED não são alvos brutos do exportador atual. Para uso futuro de derivados, exigir contrato de lineage e qualidade; não remover a distinção de origem.

Cada intervalo possui timestamp inicial e available_at após 15 minutos. Um treino/backtest só pode usar intervalos encerrados e disponíveis no instante de decisão. Não juntar estações, preencher gaps ou transformar previsão em alvo para satisfazer comprimento mínimo.

| Motor | Colunas atuais / histórico |
| --- | --- |
| Prédio V1 | consumo_predio_kw, temperatura_externa_c, umidade_relativa_pct; lags 1,2,4,8,12,24,48,96,672; janelas 4,12,24,96 |
| Carregadores | potencia_solicitada_kw, potencia_entregue_kw, carregadores_ocupados, carros_conectados, carros_chegando, carros_na_fila, ocupacao_pct, energia_entregue_kwh; lags até 2688 e janelas 4,12,24,96 |

O motor prédio gera 48 horizontes de 15 min (12 horas), modelos diretos LightGBM. O pipeline congelado usa treino Jan–Abr/2026, seleção Maio e Junho diagnóstico. O motor de carregadores mantém limites da base: 88 kW, 4 carregadores, 6 chegadas e 3 na fila; ocupação = ocupados × 25%, conectados = ocupados, energia entregue = potência média × 0,25 h. Exportador informa baseModelCompatible; dados válidos de estação diferente não garantem compatibilidade com esse modelo.

GIE legado espera timestamp local sem offset no contrato de features. Dataset V2 fornece ISO UTC com offset e timezone separado. É obrigatório adaptador temporal explícito, com testes de timezone/DST e disponibilidade, antes de treinar ou chamar predictor. Não apenas remover o sufixo Z. A opção chargers exige snapshot completo; ela não inventa chegadas/ocupação a partir de potência.

## Readiness, GIE Base e registro futuro

Modelo GIE Base no contrato indica a base preparada; runtimeActivated permanece false. Readiness consulta até 730 dias, distingue dados físicos de importados e devolve dias observados, intervalos completos, qualidade GOOD sobre leituras físicas verificadas, cobertura entre primeira/última observação e maior sequência contínua. Zero dado não é 0% de qualidade: qualidade e última leitura são nulas. latestTrustedTelemetryAt consulta a última leitura física GOOD no histórico. Truncamento de análise é explícito, sem afirmar análise completa.

Mínimos de features: 673 intervalos contínuos para prédio e 2689 para carregadores. São pré-condições de dataset, não elegibilidade automática para personalização. Treinamento, avaliação por estação, promoção e rollback de modelo ainda não existem; personalizationAvailable fica false mesmo com histórico suficiente. Importado pode preparar experimento separado, sem inflar o indicador físico.

O futuro model registry deve registrar station_id, família/versão, schema de features, timezone/unidades, manifesto e hashes imutáveis de dataset/origem/fontes, período de treino/validação/teste, métricas versus Base, versão do código, estado candidato/aprovado/ativo/revertido e responsáveis. Armazenar referência de artefato, não sobrescrever Base/frozen. Planejar schema somente no trabalho específico futuro, com aprovação de migration.

Treinamento futuro deve exigir autorização e orçamento, verificar qualidade/quantidade e drift, separar tempo sem leakage, avaliar faltas/gaps/sazonalidade, comparar com Base e permitir aprovação humana de promoção. Não usar percentual fictício de progresso; publicar estados derivados de jobs reais. Retreinamento não pode alterar reserva, pagamento, tarifa ou emitir comando físico por si.

## Retenção e operação

Política preparada: 24 meses. Exportação limita janela a 731 dias e 100000 registros; readiness usa 730 dias. Não há job de expurgo/arquivamento, portanto dados existentes não são apagados. Antes de implementar retenção, definir backup, arquivo imutável, rastreabilidade de datasets/modelos e recuperação, e obter autorização para qualquer descarte. Financeiro e histórico de sessões não devem ser limpos junto com telemetria.

No preview, restrição de estações 19/24 e polling GIE desligado preservam apresentação. Não remover esses limites para validar multiestação. Primeiro criar isolamento de processos/estado/filas/tokens/config/modelos por estação e testes de concorrência, depois discutir ativação.

## Próximo trabalho GIE V2

| Cenário | Configuração / critérios necessários |
| --- | --- |
| Posto 24h | Alta concorrência, janela sempre aberta, múltiplos carregadores, rede/solar/baterias, limites por conector e fallback seguro; reserva respeitada pelo Backend |
| Condomínio | Tarifa de reserva pode ser zero, RFID/morador/unidade e rateio continuam no Backend; carga do prédio e distribuição justa, sem pagamento individual inventado |
| Residencial/renda extra | Horários restritos, privacidade, poucos carregadores, solar/bateria opcionais, prioridade doméstica e limites elétricos locais; modelo não assume quatro EVSEs |

Arquivos Backend preparados/alterados: `platform-stations.service.ts`, `platform-access.service.ts`, `platform-domain.ts`, `station-visibility.ts`, `gie-v2-contract.ts`, `gie.service.ts`, `telemetry.service.ts`, `telemetry-domain.ts`, `telemetry-import.ts`, `telemetry.controller.ts`, `app.module.ts`, `prisma/schema.prisma`. Reservas/recarga permanecem em `charge-reservations.ts`, `reservations.service.ts`, `mobile.service.ts`, `admin-operations.service.ts` e `rfid.service.ts`; não duplicar essa autoridade em Python.

Arquivos GIE candidatos à próxima etapa (não alterados aqui):

- `service/api.py`: ciclo de vida/roteamento autenticado por estação, sem singleton compartilhado indevido;
- `src/gie_runtime/models.py`, `adapters.py`, `orchestrator.py`: contexto/proveniência temporal/config por estação e validação antes do ciclo;
- `src/gie_control/control.py`, `engine.py`, `profile.py`, `outputs.py`: perfil/config/estado segregados e origem explícita nas saídas;
- `src/motor_consumo/v1/features.py`, `train.py` e schema do modelo: adaptador versionado e pipeline de candidato por estação;
- `src/motor_carregadores/features.py`, `src/motor_carregadores_v2/features.py`, `train.py`: capacidades variáveis somente após revisão de features/modelos;
- `src/load_balancer/state.py` e configuração: estado/justiça por estação e número variável de EVSEs;
- `src/motor_gerenciamento_v2/runtime_adapter.py` e configuração: contrato seguro para novos perfis; qualquer mudança MPC/política exige tarefa própria e revisão;
- `service/normal_demo.py`: conservar origem SIMULATED e separar fontes reais, sem converter Demo em coleta física.

## Testes exigidos antes de ativar GIE V2

1. Duas estações simultâneas com tokens, ativos, caches, modelos, modos e estado de alocação separados; tentar ID errado e replay cruzado.
2. Contrato faltando/obsoleto/incompatível, capacidades e ativos INACTIVE; rejeição segura sem comando.
3. Zero/uma/várias baterias de capacidades diferentes, SOC desconhecido, carga/descarga/eficiência/limites individuais, falhas parciais; agregado não prova dispatch individual.
4. Solar ausente/zero/externo/previsto/desatualizado; fonte não pode ser promovida a MEASURED.
5. Um/quatro/mais carregadores, falhas/offline/minima elétricos, justiça e concorrência; respeitar teto físico de rede sem sobrescrever reservas.
6. Horários/timezones/DST, gaps/duplicatas, available_at, relógio futuro, dados incompletos e proveniência/lineage, isolamento de datasets.
7. Base versus candidato por estação, validação temporal, drift, falha de treino, promoção e rollback sem perder artefatos.
8. NORMAL/Manual Demo/Presentation preservados, modo visual sem faturamento, stale/offline/fallback seguro e ausência de comando real em Demo.
9. Integração com adaptador físico em bancada: ack, timeout, medidor, identidade/conector, stop e reconciliação; autenticação e auditoria.
10. Cenários posto24h/condomínio/residencial, recuperação de processo e concorrência; regressão congelada de MPC/modelos antes de qualquer alteração desses componentes.

Evidência desta tarefa: importação/readiness via UI+API reais, testes MySQL de proveniência/dataset com rollback e regressão da integração Backend GIE. Não foi executada regressão Python desnecessária, pois nenhum arquivo Python/modelo foi alterado. Nenhum resultado aqui certifica hardware ou multiestação GIE.
