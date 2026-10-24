# GIE → Backend → WebSocket → ESP32 → ACK

## Escopo e limites

Branch derivada do HEAD da PR #9 (`1efa668`), preservando o workspace com alterações anteriores. Somente Posto 46 / `DEMO_POSTO_24H_001`, dispositivo `maquete-01`, EV1→EVSE_01/carregador 76 e EV2→EVSE_02/carregador 77. Não houve alteração nos modelos, algoritmos, datasets, App ou SubApp. Não requer migration ou seed.

**Esta versão é SERIAL_ONLY.** O Backend envia `effectiveRelay=false`, `hardwareApproved=false` e `electricalSafe=false`. O firmware recusa compilação Wi-Fi com relés habilitados. GIE e sessões podem autorizar seus respectivos domínios, mas não autorizam eletricidade. A liberação futura exige montagem USB protegida, corte externo, proteção durante boot (GPIO15 é pino de boot), inspeção e aprovação específica. Nenhuma confirmação de GPIO representa medição de corrente, tensão, energia ou contato do relé.

## Transporte

WebSocket RFC6455 puro, **não Socket.IO**. A ponte existente recebe upgrade em `/devices/maquete-01/energy/ws`, porta 3012. Exige IP de dispositivo explicitamente configurado, `X-Device-Token` e `X-Station-Id: 46`; token nunca vai na URL. Por padrão a ponte continua somente em loopback. Para ESP32 verdadeiro é necessário configurar o IP específico da placa e o bind LAN no launcher, após confirmação. Não expor esta ponte HTTP/WS à Internet; o ensaio atual mantém ambos os lados em loopback.

O cliente envia `hello`, recebe um `channelId` novo e o relógio do servidor. IDs de estação no JSON são strings, conforme a serialização da API EMPS. Um novo cliente substitui o anterior, sem reutilizar comandos antigos.

```json
{"type":"hello","stationId":"46","bootId":"esp_BOOT_ALEATORIO"}
```

O Backend publica um snapshot renovado a cada segundo pela ponte. O bridge consulta o Backend (não Python nem MySQL diretamente); o Backend utiliza o cache GIE validado e solicita atualização no máximo uma vez por segundo. Avanços GIE e mudanças de sessão aparecem na próxima consulta. Não há sobreposição de consultas nem fila ilimitada. Esta implementação usa atualização periódica de 1 s, não uma garantia de entrega de toda revisão intermediária.

```json
{"type":"heartbeat","stationId":"46","bootId":"esp_BOOT_ALEATORIO","channelId":"UUID_DO_WELCOME","ev1":false,"ev2":false}
```

```json
{"type":"ack","stationId":"46","bootId":"esp_BOOT_ALEATORIO","channelId":"UUID_DO_WELCOME","commandId":"UUID_DO_SNAPSHOT","sequence":1,"accepted":true,"ev1":false,"ev2":false}
```

Heartbeat a cada 2 s, conexão vencida após 5,5–6 s; snapshots vencem após 4 s. ACK precisa corresponder ao último comando, sequência, boot, canal e estação e chegar dentro da validade. Duplicata exata é idempotente e não renova a autorização. ACK antigo, relato de relé ligado, identidade errada ou mensagem malformada fecha o canal. Reconexão recebe novo canal, nunca reaplica uma sessão anterior automaticamente. O firmware usa o relógio fornecido no welcome mais o tempo monotônico para validar a validade, sem confundir o horário histórico do cenário com o relógio real.

## Snapshot `emps.energy.v1`

O schema está em `contracts/maquete-energy-v1.schema.json`. Campos:

- `stationId`, `gieStationId`, `generation`, `revision`: identidade e revisão originais. `commandId`, `sequence`, `channelId`, `bootId`: identidade de entrega, independente da revisão GIE.
- `source=SIMULATED`, `scenarioAt`: data original do cenário; `observedAt`: última leitura validada do GIE; `emittedAt`, `expiresAt`, equivalentes em milissegundos: validade do transporte. O cenário de 2025 permanece em 2025.
- `evses.EV1/EV2`: `allocatedKw`, `gieAuthorized`, `sessionAuthorized`, `sessionId`, `sessionExpiresAt`, `operationalAuthorized`, `authorizationId`, `effectiveRelay=false` e razão do bloqueio.
- `battery`: média aritmética dos dois SoCs (somente quando ambos existem); `BAT_01` e `BAT_02` identificados por ID, seus SoCs percentuais e potências AC de carga/descarga; totais de potência originais.
- `solar.generatedKw`: geração disponível original; `usedKw` e `curtailedKw`: decisão original do GIE. `active` é o flag original; `ledGpio=null` porque não há pino reservado.
- `grid.importKw/exportKw`; `building.consumptionKw/lightOn=true`.
- `balance.supplyKw/consumptionKw/residualKw`: **potências em kW**, não energia acumulada em kWh. Nenhum histórico financeiro é alimentado por esses dados.
- `valid`, `errors`, `provenance`, `physicalMeasurement=false`.

Ausência e valores inválidos resultam em `null`/invalidade, nunca em zero inventado. Um frame inválido é enviado como indisponível para limpar o display e manter as saídas desligadas. Não reutilizar seus valores como estado atual válido.

### Balanço

`solar utilizada + importação + descarga AC = prédio + EV1 + EV2 + carga AC + exportação + perdas AC explicitamente modeladas`.

A solar disponível é verificada separadamente: `gerada = utilizada + curtailed`. Não tratar curtailment como consumo ou perda. Eficiência interna da bateria já pertence ao modelo de energia armazenada e não deve ser descontada novamente do barramento AC. `modeledLossesKw=null`/`lossesModeled=false` indica que o contrato original não fornece termo de perdas AC: o termo é omitido da equação, não representado como medição zero.

Tolerância: `0,0001 kW + 0,000001 × max(1, solar gerada, importação, descarga)`, para arredondamento/solver. Não corrige nem redistribui setpoints. Valida soma EV, curtailment, conflito importação/exportação e carga/descarga. Observação GIE acima de 6 s, origem/identidade inválidas, revisão regressiva e geração já aposentada são rejeitadas. Revisão repetida pode renovar apenas a entrega quando o serviço GIE permanece observável; não cria um novo ciclo energético.

## Firmware e pinagem

Preservados: relés 15/33 ativos LOW; EV1 LEDs 25/26, EV2 27/32; bateria 16/17/18/19; prédio 14 sempre HIGH após setup e nas falhas; poste 13; LCD SDA21/SCL22; RFID SS5/SCK12/MOSI23/MISO34/RST4.

Nenhum GPIO foi atribuído ao LED solar. É necessária decisão de hardware (GPIO livre verificado ou expansão I²C) antes de ligá-lo. LCD alterna solar/rede, prédio, EVs e SoC, com SIMULATED. LEDs de bateria seguem as faixas existentes: sem SoC/0%→0, até 25%→1, até 50%→2, até 65%→3, até 100%→4. Média incompleta fica indisponível.

Bibliotecas verificadas: ArduinoJson 7.4.3 e WebSockets 2.7.2; ESP32 Arduino 3.3.12; LCD/RFID existentes preservados. Referências: [ArduinoJson](https://arduinojson.org/v7/api/json/deserializejson/) e [WebSocketsClient](https://github.com/Links2004/arduinoWebSockets/blob/master/src/WebSocketsClient.h).

Wi-Fi continua opcional (`EMPS_USAR_WIFI=1` para recepção de rede), relés **0**. `segredos_locais.h` privado conserva `EMPS_SERVER_BASE` da ponte, token e Wi-Fi, sem credenciais publicadas. Sem Wi-Fi, o monitor Serial não recebe dados da API. Não usar comando `upload` nesta etapa.

## Execução e verificação

- `node scripts/run-maquete-energy-simulator.mjs`: cliente de software no loopback; Ctrl+C encerra. Identifica-se como SIMULATOR, confirma mensagens, nunca GPIO real.
- `node scripts/test-maquete-energy-local.mjs`: dois avanços do GIE local, recebimento na mesma conexão, ACK e leitura do estado autenticado do Dashboard, contagem operacional antes/depois. Salva evidência privada em `reports/` ignorado no Git.
- Backend: `npx tsx --test tests/lab-energy.test.ts tests/lab-maquete.test.ts`.
- Ponte: `node --test scripts/tests/maquete-energy-ws.test.mjs scripts/tests/maquete-lan-bridge.test.mjs`.
- Dashboard existente usa sua consulta autenticada periódica; o painel de diagnóstico mostra último ACK lógico e SERIAL_ONLY. Não redesenha o layout nem altera CSS. ACK vence visualmente após 4 s.

Testes com dispositivo verdadeiro, Wi-Fi físico, GPIO, LCD e proteção elétrica devem ser explicitamente registrados separadamente. Compilar firmware não equivale a testá-lo na placa. Até essa validação, todos os relés permanecem bloqueados.

### Resultados locais em 22/10/2026

- 16 testes Backend (contrato, dia/noite, carga/descarga, importação/exportação, perdas/curtailment, balanço, autorização vencida, duas sessões simultâneas em doubles, estação errada, offline, boot, ACK expirado/repetido e relés), 3 testes de transporte com servidores loopback e 5 testes de apresentação: 24 aprovados.
- Backend NestJS e build completo otimizado Next.js aprovados; nenhuma alteração de CSS.
- Integração com GIE nativo em execução, API e clone MySQL: revisões 9→10 recebidas na mesma conexão; 4 frames; último resíduo `0 kW` dentro da tolerância; ACK consultado no endpoint autenticado usado pelo Dashboard. JSON real validado pelo schema Draft 2020-12.
- Contagens operacionais antes/depois: 65 sessões, 61 pagamentos e 45 intenções, sem alteração. Não foram criadas recargas nem pagamentos pelo teste integrado.
- Firmware ESP32 compilado com Wi-Fi/LCD/RFID e relés bloqueados. Biblioteca LiquidCrystal_I2C existente emite aviso de arquitetura AVR: compilação passou, compatibilidade física ainda não validada.
- ESP32 verdadeiro: **nenhum teste nem upload realizado**. Perda de Wi-Fi representada por perda de conexão/heartbeat no simulador; circuito elétrico não testado. A automação visual local permaneceu bloqueada pela política da ferramenta; validação do ACK foi pela API e testes do componente.
- A auditoria npm informa vulnerabilidades já presentes na árvore; não foi aplicado `audit fix` nem atualização ampla fora do escopo.
