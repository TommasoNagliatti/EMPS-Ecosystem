# Liberação local USB — 23/10/2026

O usuário autorizou a liberação e confirmou LOW=acionado/HIGH=desligado e a pergunta de validação USB/proteção/corte físico/boot. É uma declaração do usuário, não medição feita pela automação. Nenhuma gravação ou acionamento físico foi executado automaticamente.

## Escopo e aprovações

Somente maquete-01, fonte Prédio Comercial 13 e cópia local 3308. EV1 corresponde ao código CH-f2f059af5117b95fb970/GPIO18 e EV2 a CH-26f5af4e137bbe735ed5/GPIO19. IDs são resolvidos por código. Vínculos legados da estação 46, bancos originais, financeiro, GIE e serviços externos são preservados.

O firmware exige `EMPS_USB_RELAY_APPROVED=1` no header privado. Sem a definição, fica SERIAL_ONLY. Prepara HIGH antes de OUTPUT; a montagem deve manter nível inativo durante boot/reset com proteção externa.

O backend exige ambiente local auditado, capacidade `emps.usb-relay.v1` anunciada pelo firmware autenticado e quatro configurações privadas: `EMPS_MAQUETE_USB_HARDWARE_APPROVED=true`, `EMPS_MAQUETE_USB_ELECTRICAL_SAFE=true`, `EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL=LOW`, `EMPS_MAQUETE_USB_APPROVED_UNTIL` ISO futuro, limitado a oito horas. O iniciador genérico permanece sem aprovação por padrão. Firmware antigo continua bloqueado. Não há renovação automática.

## Controle e fail-safe

Cada relé exige sessão CHARGING, intenção original AUTHORIZED, prazo de sessão vigente, decisão GIE válida/autorizada e conexão. `allocatedKw` não é sessão. PRESENTATION nunca aciona. Energia ilustrativa de CHARGER_DEMO não substitui autorização GIE: se a decisão estiver inválida, LEDs podem funcionar, mas os relés não ligam.

O firmware valida estação/canal/boot, código público, sequência, prazo de sessão, snapshot de até quatro segundos e aprovação temporária. Escreve GPIO somente nas transições; snapshots não pulsam relés. STOP de um canal preserva o outro. Desconexão, GIE inválido ou validade vencida desligam; sem mensagens, watchdog atua em até quatro segundos.

ACK e heartbeat representam GPIO comandado, não medição de energia. Reports ativos precisam corresponder a um comando emitido e ainda vigente. Heartbeats em trânsito de um frame anterior são aceitos dentro do prazo original, evitando desconectar EV2 durante STOP de EV1. Comandos legados da estação 46 permanecem reportados desligados; a confirmação USB está em `energyStream.lastAck`/JSON da estação 13.

## Entrega e testes

Sketch privado: `C:\goodwill_ai\EMPS_BACKUPS\ESP32_GIE_USB\ESP32_GIE_USB.ino`. Mantém credenciais e pinagem/cores/quantidade de LEDs da cópia anterior. Arquivos anteriores preservados. `reles_usb.h` contém verificações de travas em compilação.

Testes automatizados: aprovação local/expirada, firmware antigo bloqueado, START/hold/STOP independente, cenas, GIE offline, sessão ausente, ACK e reconexão. A verificação física ainda requer gravação, teste sem carga de HIGH no boot, START/STOP dos dois canais, perda de Wi-Fi/reset e conferência de proteção USB/corte físico. Nunca usar rede 127/220 V nesta liberação.

Resultados: build NestJS aprovado; 28 testes de backend e 4 de WebSocket passaram. O teste de rede foi repetido com autorização fora do isolamento após EACCES em loopback. Sketch ESP32 3.3.12 compilado: 1.140.096 bytes de flash (86%), 50.284 bytes de RAM (15%); somente aviso de arquitetura da biblioteca LCD. Nenhuma gravação automática. Após reinício exclusivo do backend/ponte, Site e API responderam 200. A validação de acionamento real depende de gravar este novo sketch.
