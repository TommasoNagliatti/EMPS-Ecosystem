> Atualizacao 24/10/2026: modulo atual confirmado em COM+NO; sketch manual e teste fisico indicam HIGH=ON/LOW=OFF. Leia ../../docs/maquete-relay-polarity-2026-10-24.md. Esta nota substitui a informacao anterior de polaridade LOW.

> Atualizacao 23/10/2026: suporte a ensaio USB protegido e temporario. A polaridade LOW=ON/HIGH=OFF foi confirmada pelo usuario. O padrao continua bloqueado. Consulte ../../docs/maquete-usb-relay-2026-10-23.md. As notas abaixo sobre bloqueio permanente e polaridade pendente descrevem a revisao anterior.

# Maquete comercial — sessões existentes, somente indicação

Sketch completo da montagem atualmente usada em Downloads. Não substituir pela pinagem do antigo `EMPS_ESP32_Maquete_v2`: as montagens são diferentes. Copiar `segredos_locais.h` privado para esta pasta somente localmente; jamais publicar o arquivo, binários ou logs com credenciais.

## Mapeamento auditado na cópia 3308

| Canal | Código público | ID observado | Estação | Fonte energética |
|---|---|---:|---:|---|
| EV1 | CH-f2f059af5117b95fb970 | 51 | 13 | EVSE1 do GIE comercial |
| EV2 | CH-26f5af4e137bbe735ed5 | 49 | 13 | EVSE2 do GIE comercial |

Os IDs são resolvidos pelo código a cada snapshot; 76/77 não são usados para estes canais. As etiquetas EV1/EV3 das sessões antigas não são reescritas. A associação EVSE1/EVSE2 é a apresentação da maquete aprovada pelo usuário, não alteração do cadastro físico/OCPP. O GIE mantém quatro EVSEs no balanço.

O vínculo legado `maquete-01`/46 continua existindo para preservar seus eventos e chaves estrangeiras. `energyStationId=13` determina os snapshots atuais. As sessões do Posto não autorizam os canais do Prédio. Não há migração de histórico.

## Sessões e segurança

O backend lê `lab_charge_sessions` e sua autorização original `lab_charge_intents`, que os endpoints atuais do App já utilizam. Não cria sessão paralela, pagamento ou comando OCPP. A cada snapshot (~1 s), exige uma única sessão CHARGING da estação/carregador corretos, iniciada, sem encerramento, com prazo `autoStopAt` futuro e autorização válida no momento da admissão, não revogada. O vencimento de admissão da intenção não encurta uma sessão já admitida; o prazo vigente é `autoStopAt`.

`chargingRequested` exige sessão + autorização + decisão GIE válida/autorizada. É uma solicitação lógica para indicação, não medição física. `effectiveRelay`, `hardwareApproved` e `electricalSafe` permanecem **false**. Fim, erro, expiração, desconexão ou GIE inválido retiram a indicação (no máximo a validade do snapshot, 4 s, quando não há rede). O firmware também verifica o prazo numérico da sessão.

## LEDs e LCD

- EVs sem solicitação válida: verde contínuo; com sessão autorizada: vermelho piscando, **simulação visual**, sem relé.
- Bateria: SoC único comercial recebido em `battery.socMeanPct`; limites 25%, 50%, 65%, 100%. Sem carga ou em descarga: barras estáticas. Durante carga: sequência progressiva 1–4 barras, atividade visual, não variação de SoC. LCD conserva percentual e potência.
- Solar azul pisca durante geração; rede amarela pisca durante importação.
- Prédio sempre iluminado. LCD alterna solar/rede, bateria, EV1/EV2, prédio e fornecimento/consumo.

## Bloqueio elétrico obrigatório

Foi encontrado `RELE_OFF=LOW` no arquivo do usuário, contradizendo o comentário de relé ativo LOW. A polaridade **não foi confirmada**. Esta revisão não dirige os pinos 18/19: usa INPUT e não oferece flag para energizar. **Entradas flutuantes não garantem segurança de um módulo desconhecido: desconectar fisicamente a alimentação/entradas dos relés e manter cargas desligadas durante testes de LED/LCD.** Nenhum firmware foi gravado automaticamente.

Antes de liberação: identificar módulo e polaridade medindo em bancada sem carga; validar nível inativo e resistores externos durante boot/reset/desconexão; usar somente baixa tensão protegida e corte independente; testar timeout e parada local; obter aprovação explícita. Só então uma revisão conjunta backend/firmware poderá aceitar autorização elétrica por dispositivo, prazo curto e nova evidência. Não inverter LOW/HIGH por tentativa com carga ligada. Não habilitar saída apenas pelo GIE.

## Validação

Valida��o anterior: 27 testes de backend (sessões, balanço, isolamento, vencimento, parada, ACK) e 5 de WebSocket passaram. Integração local pelos endpoints reais do App: QR/Pix SANDBOX → duas sessões simultâneas nos IDs 51/49 → solicitação lógica em EV1/EV2 → STOP e recibo SANDBOX → solicitação false. Nenhum pagamento externo; contagens operacionais preservadas: 65 sessões, 61 pagamentos, 45 intenções. Os testes criaram e encerraram duas sessões exclusivamente nas tabelas SANDBOX.

Ainda depende da placa: cores/polaridades dos LEDs, animação, LCD, comportamento com perda real de Wi-Fi, boot/reset e proteção elétrica. O teste HTTP não substitui navegação no App nem validação física. Não alterar GIE, App, SubApp ou visual do Site para usar este adaptador.

Compilação ESP32 3.3.12 concluída: flash 1.135.400 bytes (86%), RAM 50.244 bytes (15%). Apenas aviso conhecido de arquitetura da biblioteca LCD. Gravação automática não realizada.

## Revis�o de separa��o em 22/10/2026

A validade energ�tica n�o representa validade operacional. GIE offline apaga os indicadores energ�ticos, mas uma sess�o autorizada pode continuar indicada enquanto o transporte e a autoriza��o estiverem v�lidos. Desconex�o/TTL vencido apagam a indica��o de sess�o; a reconex�o rel� a mesma sess�o, sem criar START. Rel�s continuam bloqueados em todos os modos.

NORMAL oferece somente no objeto `presentation` e na p�gina LCD solar/rede os percentuais ILUSTRATIVOS 80/20. N�o s�o kW, medi��es ou termos do balan�o. PRESENTATION, SIMULATION e MANUAL_DEMO mant�m suas sa�das originais. Nenhuma cena autoriza ou encerra sess�o.

O bloqueio dos GPIOs � configurado uma vez, sem repetir pinMode a cada snapshot. O receptor antigo energy_ws.h tamb�m n�o escreve os GPIOs a cada frame; conserva a proibi��o el�trica em compila��o. N�o existe libera��o de rel� nesta revis�o. Hardware aprovado futuramente exigir� controlador de transi��es separado do receptor de energia, com n�vel cont�nuo entre START/STOP e watchdog independente.
