# API analítica do histórico demonstrativo

`GET /demo-history/stations/:stationId/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&grain=day|week|month|year`
exige JWT e conta proprietária. Seleciona somente o lote `ACTIVE` com origem
`SIMULATED` da estação. Não consulta telemetria, sessões ou pagamentos
operacionais. `from` e `to` são dias **inclusivos** no fuso original da fonte,
`America/Sao_Paulo`, com offset UTC−03 nos três CSVs importados. Sem filtros,
usa a cobertura original do lote; sem lote, devolve séries vazias e valores
energéticos nulos. O retorno inclui chave e SHA-256 do dataset, versão do
cenário e período original para impedir que um ponto histórico pareça atual.
Na Residência, `source.scenarioVersion` identifica a camada financeira v2 e
`source.sourceScenarioVersion` mantém a versão v1 do lote energético imutável.

## Unidades e agregação

| Campo | Método | Limite |
| --- | --- | --- |
| `totals` e `buckets`: prédio, solar, EV, rede | Soma decimal dos campos `*_energy_kwh` persistidos em cada intervalo de 15 min. | Só aparece como total completo quando todos os intervalos selecionados têm o campo; ausência fica `null`. |
| `points`: prédio, solar, EV solicitado/entregue, rede | Média de potência `*_power_kw` dos intervalos do ponto, em kW. | Não deve ser reintegrada no Frontend para reconstruir kWh. |
| `evRequestedKwhDerived` | `Σ ev_requested_power_kw × 0,25 h`. | Demanda temporal derivada, diferente da energia solicitada nas tentativas de sessão. |
| `peak*Kw` | Máximo observado da potência média de 15 minutos. | Não é pico instantâneo subintervalo. |
| `utilizationPct` | Média ponderada por intervalo de `source_payload.ev.ocupacao_media_pct`. | É utilização **histórica simulada**, não estado físico atual. |
| `chargerUtilization` | Média da fração ocupada de cada EVSE em `source_payload.ev`. | Disponível para Posto e Residência; o comercial não traz essa fração por carregador. |
| `queueIntervals` | Contagem de intervalos com `source_payload.ev.carros_na_fila > 0`. | Análise histórica, não alarme físico. |
| `estimates.gridImportProxyKwh` | `Σ max(prédio_kWh + EV_kWh − solar_kWh, 0)` **por intervalo**. | Proxy hipotético ignora despacho de bateria, perdas, exportação e medição de rede. Nulo na Shopping, que não tem solar. |

`gridImportKwh` vem exclusivamente de `grid_energy_kwh` medido na fonte e
permanece nulo para as três instalações. O mesmo vale para SoC histórico: os
datasets não o fornecem. `battery_states` do Posto indica disponibilidade,
não energia armazenada nem despacho.

`grain` controla resolução sem alterar o período: `day` usa pontos de 15 min
e buckets horários; `week` pontos horários e buckets diários; `month` pontos
e buckets diários; `year` pontos e buckets mensais. As somas de buckets
reconciliam com `totals` porque vêm dos mesmos campos kWh persistidos. Sessões
e receita usam o início da sessão, enquanto energia usa o início do intervalo;
esses eixos podem divergir quando uma recarga atravessa meia-noite ou mês.

O financeiro demonstrativo versionado, incluindo custo e margem, continua em
`/demo-history/stations/:stationId`; o financeiro operacional permanece no
endpoint e tabelas próprios. A API analítica não calcula lucro líquido nem
transforma o proxy de importação em economia ou receita realizável.
