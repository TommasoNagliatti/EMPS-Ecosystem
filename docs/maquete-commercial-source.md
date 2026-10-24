# Fonte comercial da maquete — local, somente apresentação

`EMPS_MAQUETE_GIE_STATION_ID=13` seleciona o GIE `Commercial_HighAutonomy_V2` do Prédio Comercial. O padrão continua 46 (Posto). Backend, ponte e firmware devem concordar na identidade. A ponte rejeita a estação anterior após a troca.

O vínculo operacional e os eventos históricos de `maquete-01` permanecem na estação 46; não se transferem registros nem autorizações. A API de apresentação da estação 13 informa `displayOnly=true` e `operationalStationId=46`. As sessões/autorização do Posto não entram nos snapshots comerciais. Relés, autorização elétrica e aprovação de hardware permanecem falsos.

- EV1 exibe EVSE1; EV2 exibe EVSE2, por identidade.
- O balanço inclui EVSE1, EVSE2, EVSE3 e EVSE4, inclusive os canais não representados fisicamente.
- `battery.socMeanPct` conserva o campo compatível com o LCD, mas seu significado comercial é o SoC único `numeric_state.battery_soc_pct`, identificado por `socBasis=SINGLE_SCENARIO_SOC`. Não é média nem BAT_01/BAT_02: ambos os SoCs individuais ficam indisponíveis.
- Solar utilizada soma os quatro fluxos originais de solar. A diferença entre geração e utilização é derivada, sem preencher medições ausentes. Valores ausentes ou balanço inconsistente invalidam o snapshot.
- Algoritmos, modelos e cenas do GIE permanecem intactos.

Configuração privada persistida: `energyStationId:13` em `emps-maquete-lab.runtime.json`. O launcher transmite a fonte ao backend e à ponte. No sketch da maquete configurada: `EMPS_ENERGY_STATION_ID "13"`. Wi-Fi e token permanecem no cabeçalho privado.

Validação local: 18 testes do backend e 5 da ponte passaram. Compilação ESP32: 1.134.568 bytes de flash (86%), 50.212 bytes de RAM (15%). Teste integrado com simulador recebeu revisão 33, EV1=11 kW, EV2=11 kW, total EV=22 kW, SoC=60%, resíduo=0 e ACK aceito na API da estação 13. Ainda exige regravação e confirmação pelo ESP32 real; nenhum teste físico de relés foi realizado.

## Atualização: sessões do Prédio

A integração agora observa as sessões existentes da estação 13 pelos códigos públicos dos carregadores (EV1: ID auditado 51; EV2: ID auditado 49). Continua sem aproveitar autorizações do Posto. O novo firmware e o procedimento de validação elétrica estão em `firmware/EMPS_ESP32_GIE_Real/README.md`. A identificação de sessão não altera o GIE nem autoriza relés.
