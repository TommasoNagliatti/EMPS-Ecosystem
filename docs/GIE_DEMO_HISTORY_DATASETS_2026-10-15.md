# Auditoria dos datasets GIE para histórico demonstrativo

**Data da auditoria:** 15/10/2026. **Fonte:** checkout local do repositório GIE em `C:\goodwill_ai\GIE_DATASETS`, branch `feat/gie-multistation-v3`, HEAD `15d0154bd45c0a8e0080a10f3445052a4222d4cb`. Os manifestos dos perfis citam o commit original de geração `50e0d6cba42754c24350da9fd513fce4547f2f39`. A integração EMPS examinada estava no commit `efbc0fa43ac303daf9ab04e14fe7f8b0cd8bec7b`.

Os três históricos são **sintéticos**. Os dados energéticos não comprovam pagamentos, faturamento recebido nem medições físicas atuais. Os períodos da Shopping e das outras instalações são distintos e devem permanecer assim nos filtros, gráficos e comparativos.

## Cobertura e reconciliação

| Instalação e fonte de sessões | Período dos intervalos | Tentativas | Sessões com entrega positiva | Energia AC entregue | Carregadores nas sessões atendidas |
| --- | --- | ---: | ---: | ---: | --- |
| Shopping Frei Caneca: `data/sessoes_carregadores_6_meses.csv` | 01/01/2026 00:00 a 30/06/2026 23:45, UTC−03:00 | 5.477 | 2.917 | 46.082,44141759 kWh | AC_01: 881; AC_02: 761; AC_03: 670; AC_04: 605 |
| Posto 24h: `data/synthetic_profiles/posto_24h_v1/sessions.csv` | 01/01/2025 00:00 a 31/12/2025 23:45, America/Sao_Paulo | 2.289 | 2.085 | 39.495,7439304049 kWh | EVSE_01: 1.403; EVSE_02: 682 |
| Residência: `data/synthetic_profiles/residencial_v1/sessions.csv` | 01/01/2025 00:00 a 31/12/2025 23:45, America/Sao_Paulo | 42 | 42 | 756,4236898176 kWh | EVSE_01: 42 |

As três fontes de sessão têm IDs únicos em seu próprio dataset. A Shopping teve 1.735 `abandono_espera` e 825 `abandono_fila_cheia`, todos sem carregador e com zero kWh; 2.917 registros `atendida` têm energia positiva. O Posto teve 1.245 `target_reached`, 840 `departure_before_target`, 203 `wait_timeout` e 1 `queue_full`; os 204 últimos não conectaram e têm zero kWh. A Residência teve 42 `target_reached`. Energia solicitada/entregue: Shopping 135.429,53862072/46.082,44141759 kWh; Posto 52.494,3547391084/39.495,7439304049 kWh; Residência 756,4236898176/756,4236898176 kWh.

| Instalação | Intervalos por série | Edificação sem EV | Solar AC | EV AC nos intervalos | Diferença entre sessões e intervalos |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shopping | 17.376, de 15 minutos | 438.815,989860 kWh | Indisponível nos três CSVs históricos | 46.082,44141781 kWh | 0,00000022 kWh |
| Posto 24h | 35.040, de 15 minutos | 85.791,8520369158 kWh | 75.464,7779918946 kWh | 39.495,7439304070 kWh | 0,0000000021 kWh |
| Residência | 35.040, de 15 minutos | 2.794,5579281403 kWh | 8.301,1255791069 kWh | 756,4236898174 kWh | −0,0000000002 kWh |

Cada série de intervalos é contínua, sem lacunas ou passos diferentes de 15 minutos. As pequenas diferenças de energia entre eventos e intervalos decorrem da precisão decimal serializada nos CSVs. O consumo da edificação, a energia dos EVs e a geração solar são grandezas separadas; não somar consumo da edificação a “kWh vendidos”.

## Campos e semântica para importação

- **Shopping:** `session_id` é a chave estável (`EV_...`); `hora_chegada`, `inicio_conexao`, `hora_saida`, `fim_carregamento`, `duracao_min` e `tempo_carregando_min` distinguem chegada, conexão, saída e fim da carga. `fim_carregamento` está vazio em 1.696 sessões que entregaram energia e 2.560 tentativas não conectadas. Preserve `hora_saida` como fim de conexão, usando `fim_carregamento` somente quando presente para o fim da carga. `energia_solicitada_kwh`, `energia_entregue_kwh`, `charger_id` e `status` dão a base de importação. O CSV não contém `station_id` nem `origin`: vincular explicitamente à estação Shopping validada, com origem `SIMULATED` da geração GIE. Os timestamps são horário local UTC−03:00 sem offset no texto; atribuir o fuso explicitamente na conversão, sem trocar a data histórica.
- **Posto e Residência:** `session_id`, `station_id`, `evse_id`, `chegada`, `inicio`, `termino` e `fim_carga` já estão nos CSVs individuais, com offset `-03:00` e `origin=SIMULATED`. `termino` é o fim da conexão; `fim_carga` pode antecedê-lo. `requested_ac_kwh` e `delivered_ac_kwh` são energia AC, e `reason` explica o resultado. Chave de carregador deve incluir a estação, pois `EVSE_01` existe nos dois perfis. Não converter `wait_timeout` nem `queue_full` em recarga paga.
- **Séries Shopping:** `consumo_predio_6_meses.csv` traz `timestamp`, `consumo_predio_kw`, `consumo_predio_kwh` e clima; `demanda_carregadores_6_meses.csv` traz potência solicitada/entregue, `energia_entregue_kwh`, chegada, ocupação e fila. A resolução interna do simulador de recargas foi 1 minuto; o CSV de demanda agrega em intervalos de 15 minutos. O consumo predial foi gerado no EnergyPlus e o simulador de recargas leu somente seus timestamps.
- **Séries Posto/Casa:** `building.csv` traz consumo predial em kWh por intervalo, potência média e clima; `energy.csv` traz GHI, potência PV DC disponível, geração PV AC em kW/kWh, limites e disponibilidade dos equipamentos; `ev.csv` traz potência/energia EV, ocupação, fila e potência por EVSE. `timestamp` é o início do intervalo `[t,t+15min)` e `available_at=t+15min`. Preservar a separação entre início do intervalo e momento em que o resultado ficou disponível.

Um registro de sessão demonstrativa elegível para valor positivo precisa ter entrega AC positiva e carregador identificado. A tarifa, o canal e o método de pagamento **não constam dos datasets**; qualquer camada financeira deve declarar sua regra e sua origem sintética, manter referência ao `session_id` original e nunca entrar no ledger operacional. A chave idempotente deve incluir estação, perfil/versão e ID de sessão; para intervalos, estação, perfil/versão e `timestamp`.

## Equipamentos e limites da fonte

- **Shopping:** quatro carregadores AC de 22 kW. O perfil `site_profiles/Commercial_HighAutonomy_V2.json` define capacidades demonstrativas de solar (800 kWp DC, 500 kW AC), bateria (2.000 kWh) e rede (350 kW importação, 500 kW exportação). Os três CSVs históricos não trazem geração solar, potência de rede, despacho da bateria ou SOC por intervalo. Esses limites não são medições históricas.
- **Posto:** dois EVSE de 22 kW, PV de 50 kWp, dois inversores de 30 kW e baterias independentes `BAT_01` e `BAT_02`, cada uma de 61,4 kWh nominais. `energy.csv` traz disponibilidade das duas baterias, mas o manifesto marca `battery_dispatch=NOT_SIMULATED` e `soc_timeseries=NOT_GENERATED`; não há potência nem SOC históricos de bateria. A potência da rede também não existe na série, apenas `grid_available` e limites de 90 kW importação/60 kW exportação no manifesto.
- **Residência:** um EVSE de 7 kW, PV de 5,5 kWp, inversor de 6 kW e nenhuma bateria instalada no perfil oficial. A bateria opcional do manifesto é só um modelo parametrizado. `grid_available` não é potência medida; os limites de rede são 17 kW importação e 6 kW exportação.
- Os perfis de 2025 usam clima TMYx regional como proxy, não observações meteorológicas de 2025. Edificações EnergyPlus e eventos EV foram simulados. Nenhuma série aqui deve ser apresentada como medição física recente, receita recebida ou histórico operacional real.

## Arquivos e integridade

O pacote reduzido `gie/GIE` do PR já tinha os três CSVs comerciais e, para os perfis novos, `building.csv`, `energy.csv`, `ev.csv` e `manifest.json`. Faltavam apenas os dois `sessions.csv` individuais. Eles foram copiados byte a byte do checkout GIE completo para os diretórios correspondentes do pacote, sem regenerar sessões nem modificar treino/modelos. O hash SHA-256 foi conferido após a cópia:

| Arquivo | SHA-256 |
| --- | --- |
| `data/sessoes_carregadores_6_meses.csv` | `2bf7460dac23de08f595394a6d781b7c13a0e4681ee646be86f054836e9868d1` |
| `data/synthetic_profiles/posto_24h_v1/sessions.csv` | `efcee1ef1b71c1ba3b9f4b63ebf0e996ea6406f398852224610f4731281878e7` |
| `data/synthetic_profiles/residencial_v1/sessions.csv` | `a80596c61c96bd4aca56072c08503d10b4e2aa147472372d75738ab9422f3fd2` |

Os manifestos originais dos dois perfis registram os hashes dos CSVs, os parâmetros/seeds e a proveniência de geração. Os 11 arquivos de dados/manifesto já existentes no pacote EMPS foram comparados ao checkout GIE completo e têm hashes idênticos.
