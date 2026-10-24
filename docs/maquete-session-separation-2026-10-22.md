# Separação GIE / sessões — 22/10/2026

## Alterações locais
- Branch feat/gie-esp32-realtime, trabalho anterior preservado; nenhum merge/deploy.
- IDs consultados na cópia 127.0.0.1:3308/emps_integration_test: EV1 CH-f2f059af5117b95fb970 = 51; EV2 CH-26f5af4e137bbe735ed5 = 49; ambos estação 13. Vínculo legado dispositivo/46 preservado; não fornece sessões aos canais comerciais.
- chargingRequested/operationalState representam exclusivamente a sessão existente e a autorização operacional. gieAuthorized/allocatedKw continuam sendo saídas energéticas independentes. Nenhum estado energético encerra a sessão nem comprova recarga física.
- Todos os effectiveRelay/hardwareApproved/electricalSafe continuam false em SERIAL_ONLY. GIE offline não encerra sessão; desconexão e validade vencida impedem comando físico e removem indicação local. Não há mecanismo de liberação elétrica nesta revisão.
- NORMAL: presentation contém percentuais ilustrativos 80/20, sem unidade kW e sem participar do balanço. LCD rotula ILUST; demais páginas conservam números GIE. PRESENTATION/SIMULATION/MANUAL_DEMO preservados.
- Firmware atual EMPS_ESP32_GIE_Real: GPIOs de relé ficam INPUT configurados uma vez, sem pulsos por snapshot. Indicadores de sessão usam prazo do transporte e autorização operacional, nunca allocatedKw. Boot/falha permanecem bloqueados. Antigo energy_ws.h não repete escrita de relés por snapshot; preserva bloqueio em compilação.
- Ponte serializa heartbeat/ACK simultâneos numa fila limitada; não desconecta por concorrência normal. Mantém autenticação, anti-replay, limites e heartbeat.
- Dashboard preserva estado durante atualização manual, evitando esvaziar os cartões entre requisições. Falhas e troca de estação continuam invalidando dados. Nenhuma alteração CSS/layout.

## Evidências
- 29 testes Backend passaram, incluindo EV1 isolado, EV2 isolado, ambos, manutenção em quatro modos, STOP, reconexão, expiração, isolamento e balanço. Testes simulados, sem relés físicos.
- 4 testes WebSocket passaram em loopback, incluindo heartbeat+ACK juntos, autenticação e perda de heartbeat.
- Build NestJS e verificação TypeScript Frontend passaram.
- Contagens de leitura no banco local: 65 sessões operacionais, 61 pagamentos, 45 intenções.
- Teste HTTP integrado interrompido preventivamente: há sessão do usuário ativa. Nenhum START/STOP foi aplicado por esse teste. Não houve reinício dos serviços para não interromper a sessão/dispositivo.

## Pendências físicas e ativação
Não foi gravada placa nem feita validação de cores, polaridade, alimentação ou boot/fail-safe real. Desconectar fisicamente o módulo de relés: INPUT flutuante não garante módulo desconhecido desligado. Antes de liberar: medir polaridade sem carga, resistores de estado seguro no boot/reset, fonte USB protegida, corte físico, watchdog e aprovação explícita. Só então implementar e testar controle contínuo de relé por transições START/STOP, independente dos snapshots. Não alterar flags de segurança para forçar funcionamento.

Após encerrar a sessão atual, reiniciar de forma controlada Backend/ponte e Frontend, e gravar o firmware atualizado. A alteração local não equivale a validação em ESP32 real. Sem alterações no App, SubApp, pagamentos, QR, algoritmos GIE, banco oficial ou Hostinger.

## Firmware compilado
ESP32 3.3.12: 1.136.484 bytes flash (86%), 50.244 bytes RAM (15%). Compilacao passou; aviso LCD permanece. Downloads atualizado com backup, sem mudar credenciais ou gravar placa. 15 testes Frontend passaram.
