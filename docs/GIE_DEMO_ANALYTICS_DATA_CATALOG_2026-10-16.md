# Catálogo de dados para inteligência demonstrativa do EMPS — 16/10/2026

Escopo: três históricos `SIMULATED` dos GIEs, importados pelas tabelas
`demo_*` do MySQL local. Este catálogo descreve o que as fontes efetivamente
permitem calcular. Não autoriza modificar o visual, criar novos cards, alterar
o GIE treinado, usar o banco oficial ou lançar movimentos financeiros reais.

## Fontes, cobertura e reconciliação

| Estação | Período local | Leituras de 15 min | Tentativas / atendidas | EV entregue por sessões | Edifício | Solar AC |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Shopping Frei Caneca | 01/01–30/06/2026 | 17.376 | 5.477 / 2.917 | 46.082,44141759 kWh | 438.815,989860 kWh | Sem fonte |
| Posto 24h | 01/01–31/12/2025 | 35.040 | 2.289 / 2.085 | 39.495,7439304049 kWh | 85.791,8520369158 kWh | 75.464,7779918946 kWh |
| Residência | 01/01–31/12/2025 | 35.040 | 42 / 42 | 756,4236898176 kWh | 2.794,5579281403 kWh | 8.301,1255791069 kWh |

As somas dos intervalos EV divergem das sessões em menos de `3 × 10⁻⁷ kWh`
por estação por arredondamento do CSV. O parser exige sequência contínua,
sem duplicatas, em quartos de hora; valida `kWh = kW × 0,25 h`, identidade da
estação, cronologia das sessões e a reconciliação EV com tolerância de
`10⁻⁵ kWh`. Para Posto e Residência confere também os SHA-256 dos CSVs com
`manifest.json`, a origem `SIMULATED`, `America/Sao_Paulo` e `−03:00`.
O comercial legado não possui manifesto equivalente nesse importador; o lote
guarda hashes individuais dos arquivos e SHA-256 composto do dataset.
Os históricos de Posto e Residência derivam de simulações EnergyPlus/EV e
clima TMYx de São Carlos usado como proxy regional: não são medições físicas
de 2025. Os dados da Shopping também são simulação comercial de 2026.

## Variáveis presentes e uso correto

| Campo / origem | Unidade e resolução | Uso demonstrativo possível | Restrição |
| --- | --- | --- | --- |
| `demo_energy_readings.building_energy_kwh`, `building_power_kw` | kWh por 15 min; kW médio do intervalo | Consumo do prédio, somas diária/semanal/mensal/anual, demanda máxima do conjunto de intervalos | Não representa potência instantânea atual. |
| `ev_delivered_energy_kwh`, `ev_delivered_power_kw`, `ev_requested_power_kw` | kWh/15 min; kW médio/15 min | EV entregue e potência solicitada/entregue por tempo; picos e horários de carga | `ev_requested_energy_kwh` tipado é nulo; se necessário, derivar `requested_power_kw × 0,25 h` como demanda dos veículos conectados, diferente da energia solicitada nas tentativas. |
| `solar_energy_kwh`, `solar_power_kw` | kWh/15 min; kW médio/15 min | Geração solar de Posto e Residência, por período | Nulos na Shopping; não substituir nulo por zero. |
| `grid_power_kw`, `grid_energy_kwh` | Potencial kW/kWh | Nenhuma importação medida | Nulos nas três estações. `grid_available` dos CSVs novos é apenas booleano de disponibilidade. |
| `battery_states` | Estado de disponibilidade por 15 min | Existência/disponibilidade simulada de `BAT_01` e `BAT_02` no Posto | Não há SoC nem despacho histórico; `batteryStates` é nulo na Residência e Shopping. Residência tem bateria somente em *template opcional hipotético*, não instalada. |
| `demo_charging_sessions` | Uma linha por tentativa | Sessões atendidas, tentativas não atendidas, energia por carregador, tarifa e custo simulados, duração de conexão, horários de início/fim | `ended_at` é saída do veículo, que pode ocorrer depois de `fim_carga`; `duration_seconds` é permanência conectada, não necessariamente duração de carregamento ativo. |
| `demo_payments` | Uma linha por sessão cobrada no cenário v1 | Receita demonstrativa v1, App/Web/Caixa, Pix/crédito/débito/dinheiro | `SIMULATED_SETTLED` sem provedor, intenção externa ou recebimento real; a Residência v2 não usa essa receita. |
| `demo_session_scenarios` | Uma linha por sessão residencial e versão financeira | Uso próprio/visitante, credencial hipotética, motorista fictício, custo e receita v2 | Camada demonstrativa adicional, sem usuário, RFID físico ou pagamento operacional. |
| `source_payload.ev` e `source_payload` da sessão | Valores originais com intervalo/sessão | Ocupação, fila, espera, energia não atendida, potência por EVSE nos perfis novos | A API nova valida e agrega ocupação e fila; outras análises dependem de fórmulas próprias antes de serem exibidas. |

Os dados históricos ficam nas tabelas `demo_import_batches`,
`demo_charging_sessions`, `demo_payments`, `demo_energy_readings` e, para a
Residência v2, `demo_session_scenarios`, com lote, estação, origem, SHA-256 e
cenário. As consultas selecionam o lote `ACTIVE` e exigem a conta proprietária.
Na referência inicial do PR #3, o serviço retornava leituras agregadas por
**dia** e não devolvia custo, papel owner/visitor ou utilização por EVSE. A
API desta branch acrescenta esses resultados sem modificar as fontes.

## Indicadores viáveis e fórmulas

- **Energia por período:** `Σ energy_kwh` dos intervalos cujo início pertence
  ao período local. Nunca somar `power_kw` para obter energia; `kW × 0,25 h`
  apenas quando o kWh não está disponível e a relação foi validada. Picos de
  potência são `MAX(power_kw)`, não soma nem média de kWh.
- **Receita simulada:** `Σ demo_payments.amount` das sessões faturáveis do
  lote ativo para Shopping/Posto; na Residência v2, `Σ
  demo_session_scenarios.amount` para `usage_kind=VISITOR`. Datas de sessão e
  filtros são explícitos. No cenário financeiro
  v1, tarifa R$ 2,20/kWh e custo energético R$ 0,80/kWh; arredondamento
  comercial é feito **por sessão**. Resultados v1: Shopping R$ 101.381,31 de
  receita e R$ 36.865,81 de custo EV; Posto R$ 86.890,68 e R$ 31.596,75;
  Residência R$ 1.664,13 e R$ 605,13. A versão v1 cobra indevidamente as
  42 sessões residenciais para o novo cenário pedido pelo proprietário.
- **Margem de contribuição estimada:** receita visitante simulada menos custo
  energético variável das recargas cobradas. Para ver o resultado da estação
  antes dos custos fixos, subtrair também o custo energético das recargas do
  proprietário. Esses valores não são lucro líquido: faltam impostos,
  adquirência, demanda contratada, prédio, manutenção, depreciação,
  investimentos e outros custos; não há receita real na base de demonstração.
- **Utilização histórica:** média ponderada das frações de ocupação nos
  intervalos de 15 min, ou horas ocupadas = `Σ occupied_fraction × 0,25 h`.
  A fonte tem ocupação média agregada em Shopping (38,03%), Posto (29,31%) e
  Residência (4,10%). Posto/Residência contêm frações por EVSE; a Shopping só
  fornece ocupação agregada por intervalo, mas receita e número de sessões por
  `charger_id` estão disponíveis. Sessões por carregador: Shopping
  AC_01/02/03/04 = 881/761/670/605; Posto EVSE_01/02 = 1.403/682;
  Residência EVSE_01 = 42. Horas de sessão derivadas de chegada/saída não
  equivalem necessariamente a horas de fornecimento de energia.
- **Oportunidade de atendimento:** 2.560 tentativas sem recarga na Shopping e
  204 no Posto; intervalos com fila não vazia: 3.405 e 1.021,
  respectivamente. A fonte permite analisar horário, espera e energia
  solicitada não atendida (89.347,09720313 kWh Shopping;
  12.998,6108087031 kWh Posto). Esses valores **não** são vendas perdidas
  garantidas, pois incluem limites de aceitação, permanência, filas e outras
  condições da simulação. A Residência não tem fila nem energia não atendida.
- **Comparativo entre instalações:** apresentar taxas por mês coberto, por
  EVSE ou por hora de operação do dataset, além dos totais, pois as fontes
  cobrem anos distintos e a Shopping cobre apenas seis meses. Manter contexto
  e período visíveis para toda métrica comparada.
- **Solar e rede estimada:** para Posto/Residência, um *proxy sem despacho de
  bateria nem perdas adicionais* pode calcular por intervalo
  `load = building_kwh + ev_kwh`, `net_import_proxy = max(load − pv_kwh, 0)`,
  `surplus_proxy = max(pv_kwh − load, 0)` e
  `pv_overlap_proxy = min(load, pv_kwh)`. Totais: Posto 75.663,42 kWh de
  importação proxy e 25.840,60 kWh de excedente proxy; Residência
  2.732,92 kWh e 7.483,06 kWh. Esses valores **não são medição de rede,
  autoconsumo efetivo ou exportação**. A Shopping não permite esse cálculo.
- **Armazenamento:** identificar períodos de excedente proxy e picos de
  demanda como candidatos a estudo. ROI e economia realizável requerem
  tarifa horária, medição de rede, restrições elétricas, despacho, perdas,
  CAPEX e custos de operação ausentes. O Posto possui duas baterias apenas no
  perfil/equipamento simulado, sem série histórica de SoC ou despacho. A
  Residência não possui bateria instalada.

## Cenário residencial financeiro versionado recomendado

O CSV da Residência **não** classifica motorista, proprietário, visitante ou
credencial RFID. A classificação é uma hipótese financeira versionada, nunca
um fato medido. No cenário `residential-owner-visitor-v2`, o ordinal numérico
do `source_session_id` divisível por quatro representa visitante; os demais
representam uso próprio por um proprietário demonstrativo com referência RFID
**hipotética**, sem UID real. A regra produz 32 recargas próprias e 10 de
visitantes, respectivamente 558,8242757770 e 197,5994140406 kWh. Apenas
visitantes geram receita simulada: R$ 434,72, contra R$ 158,08 de custo
energético estimado dessas vendas e margem de contribuição estimada de
R$ 276,64. O uso próprio custa R$ 447,05 estimados, sem receita. Após todo
o custo EV, o resultado seria R$ −170,41 antes de outros custos; **não é
lucro líquido**. Esses valores são hipóteses auditáveis, não inferências sobre
pessoas reais.

Uma tabela demonstrativa adicional liga o cenário financeiro às 42 sessões
existentes, sem importar as 35.040 leituras residenciais outra vez. O lote
energético, a soma de 756,4236898176 kWh, a versão v1 e os CSVs originais
permanecem intactos. As atribuições v2 são idempotentes por sessão e versão;
uso próprio não recebe pagamento v2 e visitantes recebem somente valores
SIMULATED. Os motoristas fictícios têm identificadores estáveis associados às
sessões, sem contas autenticáveis, CPF, senhas, UID RFID físico ou edição de
contas reais.

## Cuidados temporais e de filtro

- Todo agrupamento deve usar o fuso da instalação. Os três datasets trazem
  `America/Sao_Paulo` com offset `−03:00`; a estação também tem campo
  `timezone`. O serviço atual fixa `−03:00`, válido para essas fontes, mas
  não generalizável sem consultar o timezone da estação.
- O período do lote termina de forma exclusiva em 01/07/2026 (Shopping) ou
  01/01/2026 (Posto/Residência). Não deslocar os eventos para 2026 atual nem
  apresentar o último intervalo como telemetria em tempo real.
- Receita/sessões são atribuídas ao início da sessão; energia de intervalos
  pertence ao início do quarto de hora. No Posto, três carregamentos atravessam
  meses. A diferença entre kWh dos intervalos e kWh das sessões iniciadas no
  mês é `−3,116667/+3,116667` kWh em março/abril e `−8,8/+8,8` em
  maio/junho; o ano reconcilia. Identificar as duas bases temporais nos
  gráficos em vez de corrigir artificialmente datas ou valores.
- O filtro atual de canal/método seleciona sessões com pagamento, mas as
  leituras são filtradas somente por data. Portanto, energia física do período
  não deve ser apresentada como energia *do canal*; essa última é soma da
  energia das sessões selecionadas. `UNSERVED` não possui pagamento e sai de
  um filtro por canal/método.
- Operação real, histórico simulado, saída atual do GIE e projeção hipotética
  precisam permanecer rotulados e consultados em origens distintas. Um alerta
  de fila/utilização derivado do histórico é análise ou recomendação, não
  incidente de equipamento.

## Pontos de código auditados

- `site/emps-site-main/backend/src/demo-history-datasets.ts`: valida fontes,
  datas, intervalos, hashes e reconciliação; copia campos extras para JSON.
- `site/emps-site-main/backend/src/demo-history-import.service.ts`: importa
  apenas para tabelas `demo_*`, vincula carregador por estação e lote e
  confere contagem/valor/energia na reimportação.
- `site/emps-site-main/backend/src/demo-history-finance.ts`: cenário v1
  determinístico, arredondamento por sessão e um pagamento fictício para toda
  recarga atendida.
- `site/emps-site-main/backend/src/demo-history.service.ts`: seleção de lote
  ativo e autorização owner; resumos de sessão, custo, receita, canais,
  métodos, carregadores, período e leitura diária.
- `site/emps-site-main/backend/src/demo-history-analytics.service.ts`:
  agrega os kWh dos intervalos originais em dia, semana, mês e ano;
  consulta ocupação/fila histórica e identifica o proxy de rede como hipótese.

## Estrutura analítica implementada sem alterar o visual

O contexto SIMULATED dos componentes existentes recebe o último mês coberto
pela fonte ao ser aberto. O calendário existente navega pelos períodos; o
seletor de fonte identifica o lote original. O fluxo mostra potência histórica
com data e resolução, enquanto visão geral e gráficos de energia usam as somas
exatas em kWh. O card financeiro existente mostra faturamento simulado, custo
das vendas e margem de contribuição; na Residência distingue custo próprio e
resultado após todo custo EV. A aba existente de dispositivos mostra sessões
fictícias e carregadores em modo de leitura. O painel de Inteligência existente
mantém os filtros detalhados de canal e método. A operação real continua com
consultas e componentes operacionais separados.

As consultas são descritas em `docs/GIE_DEMO_ANALYTICS_API_2026-10-16.md`.
Os indicadores de maior demanda, fila e carregador mais demandado usam os
campos de horário/carregador existentes. Não se transforma energia solicitada
em venda perdida garantida. Sem medição de rede, tarifa horária, CAPEX,
despacho e SoC, um retorno financeiro confiável para armazenamento não pode
ser calculado. Um simulador de investimento exigiria hipótese explícita e
espaço visual novo; esta branch não acrescenta card, página ou aba.
