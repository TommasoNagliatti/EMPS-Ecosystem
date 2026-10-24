# Correção da polaridade — 24/10/2026

## Evidência física e decisão

O usuário observou que iniciar uma sessão desligava a saída USB e STOP a ligava. Em seguida confirmou ligação **COM + NO/NA**, não NC/NF. O sketch manual original preservado usa `RELE_ON HIGH` e `RELE_OFF LOW`; a declaração anterior LOW=ON estava em conflito com esse teste funcional e com a resposta física observada. A montagem atual foi corrigida para **HIGH=ON / LOW=OFF**, GPIO18/EV1 e GPIO19/EV2. Não se inverteu o estado lógico das sessões.

Antes de reiniciar a ponte, foi solicitada a confirmação de carga USB fisicamente sem alimentação: o firmware antigo possui OFF elétrico invertido e sua desconexão poderia energizar a saída. A gravação e os primeiros testes exigem carga desconectada; confirmar boot/reset/STOP e falha segura antes de reconectar. Hardware permanece restrito à bancada USB protegida, sem rede 127/220 V.

## Implementação

- Níveis `RELE_ON`/`RELE_OFF` no início do sketch; `RELE_NIVEL_ATIVO` é derivado deles. LOW inativo é configurado antes de Serial, delays, LEDs e Wi-Fi. Esse código não garante o nível durante o bootloader/reset: a montagem deve ter a polarização externa adequada.
- O hello autenticado passa `relayActiveLevel` pela ponte. O backend compara esse nível com a aprovação privada; falta ou divergência de polaridade mantém SERIAL_ONLY sem autorização de relé. Não basta anunciar a capacidade USB antiga.
- O receptor só aceita permissão USB quando o nível declarado na aprovação combina com seus próprios níveis de saída.
- HIGH/LOW no hardware continuam independentes de `effectiveRelay`/ACK: `true` significa solicitação lógica de acionamento, não tensão medida ou energia faturável.
- START/STOP por canal, watchdog, validade da sessão, autorização GIE, aprovação privada e prazo de oito horas permanecem. A troca de polaridade não renova esse prazo.
- Preservados pinagem, identidade do dispositivo, credenciais privadas, padrões dos LEDs, GIE/modelos, pagamentos, sessões e frontend.

## Testes

Testes de backend cobrem ambos os níveis ativos, falta/divergência de polaridade no handshake, isolamento de ambiente/conta/dispositivo, START dos dois canais, manutenção, STOP independente, cenas, vencimento e reconexão. A ponte foi testada para encaminhar HIGH sem remover autenticação. O sketch anterior e a aprovação anterior estão em backups privados.

A compilação verifica os níveis opostos e as travas existentes. A confirmação de GPIO/ACK não substitui o teste elétrico: a liberação só estará fisicamente validada depois de o usuário gravar esta versão, conferir LOW com sessão parada/boot/desconexão e HIGH apenas durante a sessão autorizada.

Sketch privado atualizado: `C:\goodwill_ai\EMPS_BACKUPS\ESP32_GIE_USB\ESP32_GIE_USB.ino`. Nenhuma gravação automática, merge ou deploy foi executado.

Resultados de preparação: build NestJS aprovado; 21 testes de backend e 4 de WebSocket passaram. Sketch ESP32 compilado com 1.140.316 bytes de flash (86%) e 50.284 bytes de RAM (15%); apenas aviso da biblioteca LCD. Backend/ponte ainda não reiniciados nesta preparação: aguardam confirmação da carga USB desconectada. O script privado de reinício exige o parâmetro explícito `-UsbLoadDisconnected`, que só deve ser usado após essa confirmação real. O prazo anterior da aprovação foi preservado.

## Aplicação local após confirmação do usuário

O usuário esclareceu que os contatos comutam somente USB de 5 V depois da fonte e confirmou: "Já tirei o fone do cabo". Somente então foi executado o reinício com `-UsbLoadDisconnected`, sem alterar essa trava. Site, GIEs e MySQL foram preservados.

Validação pela API autenticada após o reinício: `activeLevel=HIGH`, `deviceActiveLevel=HIGH`, `polarityMatched=true`, `valid=true`, `errors=[]` e ACK real `accepted=true`. CHARGER_DEMO preservou a decisão GIE existente na revisão 27, sem novo ciclo ou reset. Como não havia sessão ativa, ambos os comandos e ACKs permaneceram false. Foi solicitado teste de clique START/STOP de EV1 com o fone ainda desconectado; acionamento físico e boot/falha ainda dependem dessa conferência do usuário. Não é preciso outra gravação para a aplicação do backend, pois a placa já anunciou HIGH corretamente.

Retorno do teste físico de EV1, com fone desconectado: o usuário confirmou "Clica ao iniciar e ao parar". Assim, a atuação da bobina em START/STOP foi observada pelo usuário. Esse retorno ainda não mede tensão/corrente da saída USB nem comprova testes físicos de reset/perda de Wi-Fi ou de EV2; esses resultados não foram presumidos.
