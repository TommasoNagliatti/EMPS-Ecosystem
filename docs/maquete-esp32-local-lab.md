# Maquete ESP32: ponte local de laboratório

> Na branch de recarga sandbox derivada da PR #8, o procedimento vigente está
> em [charging-sandbox-local.md](charging-sandbox-local.md). Os comandos manuais
> EV1/EV2 descritos na validação histórica da PR #8 abaixo foram desabilitados:
> START/STOP agora saem exclusivamente da sessão sandbox iniciada no cartão do
> carregador. O painel da maquete mostra diagnóstico e não inicia recargas.

## Escopo e estado desta etapa

Esta integração deriva da PR #7 e usa **somente** a cópia
`emps_integration_test` em `127.0.0.1:3308`. A estação vinculada
explicitamente é o **Posto 24h, ID 46**, pelo dispositivo `maquete-01`.
Abrir o dashboard do Prédio, da Shopping ou da Residência não altera esse
vínculo. O Backend continua em `127.0.0.1:3011` e mantém
`EMPS_PHYSICAL_COMMANDS_ENABLED=false`. Os comandos EV1/EV2 desta etapa
pertencem somente às tabelas `lab_*`; não passam por OCPP, não criam sessões
operacionais nem pagamentos e não alteram os carregadores cadastrados.

Os resultados desta etapa são de compilação e cliente simulado, sem medição
elétrica, Monitor Serial observado por esta implementação ou confirmação de
contatos de relé. O proprietário informou que gravou o novo sketch com
`EMPS_USAR_WIFI=0`: nessa configuração a placa não consulta o Site. O ACK
que apareceu no Site veio do simulador local (`bootId` iniciado em `sim_`),
encerrado assim que a divergência foi identificada. A interface agora mostra
**Simulador local** ou **Firmware ESP32**, conforme o cliente que enviou o
heartbeat, e a confirmação do firmware se refere apenas ao nível lógico
reportado pelo GPIO. Nenhuma saída 127/220 V deve ser ligada à maquete.

Antes do patch 0004, um backup completo da cópia 3308 foi criado e lido de
volta, fora do Git:

- `C:\goodwill_ai\EMPS_BACKUPS\emps_integration_pre_maquete_20261018T042645Z_8cdc6357.sql.gz`
- SHA-256: `F76049F21B71DAA23556C636E9334BA5E6D34E837C3DD33302F0DDA17E6ADFB4`

O patch 0004 criou `lab_devices`, `lab_device_commands`, `lab_device_events`
e `lab_rfid_tags`. O vínculo `maquete-01 → 46` é explícito. A repetição de
`python scripts/setup-maquete-lab.py` não duplicou as tabelas nem o vínculo.
As **65 sessões, 61 pagamentos e 45 intenções de pagamento** operacionais
da cópia permaneceram com as mesmas contagens.

## Procedimento da PR #8, substituído pelo fluxo sandbox

O Site está em `http://127.0.0.1:3010/login`. Entre com
`admin.dev@emps.local` e sua senha antiga, abra o Posto 24h e depois
**Carregadores**. Na branch atual, inicie ou pare a sessão **SANDBOX** nos
cartões EVSE_01/EVSE_02. O painel **Maquete USB · teste local** informa
conexão, origem e ACK, sem botões de comando. O estado ficará **Sem conexão**
até iniciar um cliente. A parada da sessão revoga a autorização no Backend e
enfileira STOP quando a ponte estiver disponível, sem prometer confirmação
física. A recarga software funciona também sem ESP32.

Para reproduzir a prévia após reiniciar o computador, use PowerShell 7 no
diretório `C:\goodwill_ai\EMPS_GITHUB`:

```powershell
pwsh -NoProfile -File scripts/stop-legacy-integration.ps1 -WhatIf
pwsh -NoProfile -File scripts/stop-legacy-integration.ps1
Push-Location site/emps-site-main/backend
npm run prisma:generate
npm run build
Pop-Location
python scripts/setup-charging-sandbox.py
pwsh -NoProfile -File scripts/start-legacy-integration.ps1
node scripts/run-maquete-simulator.mjs
```

Encerre o simulador contínuo com **Ctrl+C** antes de executar os testes
automatizados abaixo; eles usam a mesma identidade `maquete-01`.

O comando `setup-charging-sandbox.py` só aplica o patch 0005 à cópia 3308 após backup
verificado; nas execuções seguintes ele apenas confere a estrutura. O `stop` valida PID,
horário de início, porta e comando antes de encerrar os processos locais
registrados. O MySQL e seus volumes continuam preservados. O `start` inicia
GIEs, Backend, ponte e Site; por padrão, a ponte em `127.0.0.1:3012` aceita
**apenas o simulador local**. O último comando mantém um cliente ESP32
simulado ativo no terminal; use Ctrl+C para encerrá-lo antes de iniciar um
ESP32 real. As linhas `RELE_GPIO15=LOW/HIGH` e `RELE_GPIO33=LOW/HIGH` desse
simulador são apenas representação de software.

Execute primeiro `node scripts/test-charging-sandbox-stage1.mjs`, depois
`node scripts/test-charging-sandbox-contracts.mjs` e por último
`node scripts/test-maquete-simulator.mjs`. O último inicia sessões sandbox,
confirma que outra estação não controla a maquete e testa EV1/EV2, IDs
idempotentes, ACKs, START revogado, STOP e RFID negado. O teste anterior
`node scripts/test-maquete-rfid.mjs` inscreve
uma UID **fictícia**, confirma a mensagem de apresentação, revoga a tag e
confirma nova recusa; os relés permanecem desligados. Não rode o teste de
comandos em paralelo ao simulador contínuo, pois ambos usam a mesma identidade
de dispositivo.

O token da maquete é gerado aleatoriamente uma vez e fica em
`C:\goodwill_ai\EMPS_BACKUPS\emps-maquete-lab.runtime.json`, fora do Git.
Não coloque esse arquivo, a senha antiga nem `segredos_locais.h` em commits.

## Diagnóstico da comunicação com a placa

O firmware tem dois bloqueios independentes por padrão:
`EMPS_USAR_WIFI=0` impede qualquer comunicação com o Site, e
`EMPS_HABILITAR_RELES=0` recusa comandos START e mantém GPIO15/GPIO33 em
HIGH. Para testar somente a comunicação, copie o header privado conforme o
guia do firmware, configure o IP LAN do computador e compile com **Wi-Fi=1,
relés=0**. O Monitor Serial passa a mostrar o IP recebido pelo ESP32 e o
destino da ponte; não imprime senha nem token. A ponte inicialmente aceita
somente `127.0.0.1`. Após ler o IP do ESP32, reinicie os serviços com
`-MaqueteBindIp <IP_DO_PC> -MaqueteDeviceIp <IP_DO_ESP32>` e permita apenas
esse IP no firewall local. O Site deverá mostrar **Firmware ESP32** e o
horário do heartbeat. Se aparecer **Simulador local**, encerre o simulador:
os dois clientes não devem usar `maquete-01` ao mesmo tempo.

Com os relés bloqueados, um START é recusado de forma verificável. Para
acionar contatos físicos em uma etapa posterior, a montagem USB, o
intertravamento externo de GPIO15 no boot, a fonte e a proteção de corrente
precisam ser conferidos; só então compile separadamente com
`EMPS_HABILITAR_RELES=1`. A confirmação de ACK/GPIO não substitui medição dos
contatos e da tensão USB.

## Resultados históricos da PR #8 — 18/10/2026

- Backend: build NestJS aprovado; suíte completa **178 passaram, 8 ignorados,
  0 falharam** com loopback permitido. A execução restrita impediu uma conexão
  WebSocket; o mesmo teste passou isolado e na suíte com loopback autorizado.
- Frontend: **222 testes passaram**, TypeScript sem erros e build completo
  Next.js gerou 18 páginas estáticas. Duas tentativas de build sobre um cache
  `.next` parcial falharam no processo PostCSS do Turbopack; depois da remoção
  apenas desse cache local, o build completo passou. Nenhum CSS foi alterado.
- Firmware: compilado para ESP32 core 3.3.12 com Wi-Fi, LCD e RFID ligados e
  relés bloqueados por padrão; **1.077.672 bytes (82%)** de flash e
  **50.776 bytes (15%)** de RAM global. A biblioteca LiquidCrystal I2C emite
  aviso de arquitetura AVR; a execução no LCD real ainda não foi observada.
- Simulação: comandos EV1/EV2, ACK idempotente, parada, expiração, perda de
  autorização, RFID de apresentação e isolamento da estação 46 passaram no
  cliente local. O usuário clicou no Site e o simulador registrou as mudanças
  de EV1/EV2, sem GPIO. A origem agora é visível no Site para evitar confundir
  essa confirmação com a placa.
- Dados: o patch 0004 e o vínculo foram aplicados exclusivamente à cópia 3308
  depois do backup. Os registros operacionais antigos mantiveram as contagens
  de **65 sessões, 61 pagamentos e 45 intenções**; nenhum evento USB entrou
  nessas tabelas.

**Pendente de validação com a placa:** Wi-Fi habilitado no sketch, ponte LAN
vinculada ao IP específico do ESP32, heartbeat visto no Site e saída Serial
observada. O proprietário informou que ainda não há maquete montada: não
executar comandos físicos nem declarar LCD, RFID, LED ou contatos de relé
validados em hardware nesta etapa.

## Contrato e segurança

O Site usa JWT e a permissão **MANAGE** da estação 46 para iniciar uma sessão
sandbox. A API Mobile/Web Charge aceita **OPERATE** para a conta autorizada.
Comandos manuais diretos estão desabilitados na branch atual. O Backend só
entrega comandos da maquete ao token `X-Device-Token`
do dispositivo vinculado. A ponte em 3012 encaminha apenas `next`, `ack`,
`heartbeat` e `rfid`; valida o token, o IP de origem configurado, método e
tamanho do corpo. O Backend permanece ligado somente ao loopback. Cada
comando tem UUID, prazo, ACK, status e trilha de eventos. START exige
heartbeat recente; STOP pode revogar a autorização mesmo sem conexão.
O firmware deve desligar os dois relés ao perder comunicação/autorização ou
receber ACK sem status `ACKED`. Tags RFID são apenas rótulos demonstrativos:
o UID RC522 é clonável e **não** autoriza recarga nem pagamento por si só.

O Backend consulta o estado GIE do Posto para **apresentação simulada** no
LCD e nos LEDs. Um snapshot ausente, expirado ou inválido é mostrado como
indisponível; os setpoints GIE não autorizam os relés. O cenário mantém sua
data original. A barra de quatro LEDs usa a média dos SoCs válidos de
BAT_01/BAT_02, com faixas 0%, (0,25]%, (25,50]%, (50,65]% e (65,100]%.

## Preparação futura da placa e da LAN

O sketch e o guia de pinos estão em
`firmware/EMPS_ESP32_Maquete_v2/`. No Arduino IDE, escolha **ESP32 Dev
Module**, instale as bibliotecas `LiquidCrystal_I2C` e `MFRC522`, abra o
Monitor Serial em **115200 baud** e compile primeiro sem Wi-Fi nem cargas.
O firmware mantém GPIO21/22 para I²C; RC522 SS=5, SCK=12, MOSI=23,
MISO=34, RST=4; EV1/EV2 em GPIO15/33, relés ativos em LOW; bateria em
GPIO16–19; poste GPIO13 e LEDs do prédio GPIO14. O programa coloca as
saídas dos relés em HIGH no começo de `setup()`, mas **não controla os pinos
durante reset ou boot**. GPIO12 e GPIO15 são pinos de boot. Antes de qualquer
ensaio físico, verifique pull-ups/intertravamento externo, nível 3,3 V do
LCD I²C, corrente dos LEDs, fonte e proteção do circuito USB de baixa tensão.

Para testar a comunicação sem montagem, mantendo `EMPS_HABILITAR_RELES=0`, copie
`segredos_locais.h.example` para `segredos_locais.h` (ignorado pelo Git),
configure Wi-Fi, IP **LAN do computador** na porta 3012 e o token privado,
então habilite `EMPS_USAR_WIFI=1`. Nunca use `localhost` ou `127.0.0.1`
como endereço do PC **no ESP32**. Inicie a ponte com os IPs específicos do
PC e do ESP32:

```powershell
pwsh -NoProfile -File scripts/stop-legacy-integration.ps1 -WhatIf
pwsh -NoProfile -File scripts/stop-legacy-integration.ps1
pwsh -NoProfile -File scripts/start-legacy-integration.ps1 -MaqueteBindIp <IP_DO_PC> -MaqueteDeviceIp <IP_DO_ESP32>
```

Essa opção não cria regra de firewall automaticamente. Antes do teste real,
autorize **somente** o IP do ESP32 a alcançar a porta TCP 3012 no perfil de
rede privada do Windows. A versão HTTP local transmite token e UID sem
criptografia: use apenas uma LAN isolada e confiável para ensaio de baixa
tensão. Para uma implantação futura, planeje polling de saída do dispositivo
por **HTTPS autenticado**, com CA e hostname validados no ESP32, rotação de
token, inventário por estação, auditoria e firewall específico. Não remova a
restrição da cópia 3308 nem abra a API NestJS inteira à Internet como forma
de publicar o laboratório.
