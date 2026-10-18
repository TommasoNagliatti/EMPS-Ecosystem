# Maquete EMPS ESP32 — laboratório local

Este firmware parte da maquete v2 fornecida para ESP32 DevKit V1. Os comandos do Site passam por Backend e ponte LAN restrita, sem acesso do ESP32 ao MySQL. O dispositivo inicia em modo Serial (`EMPS_USAR_WIFI=0`, LCD e RFID opcionais). Por padrão, `EMPS_HABILITAR_RELES=0` bloqueia qualquer comando de ligar, inclusive pelo Serial. O código foi compilado; a equipe ainda não observou comunicação nem saídas reais da placa.

## Segurança antes de conectar a maquete

- Não conecte rede 127/220 V aos relés. O experimento previsto é USB de baixa tensão, com fonte, proteção de corrente e corte físico apropriados.
- GPIO15 é pino de boot e aciona relé ativo em LOW. O software só define HIGH depois que o ESP32 inicia; portanto a montagem precisa de intertravamento externo que mantenha os dois relés abertos durante boot, reset, queda de alimentação e desconexão da placa. Confira também GPIO12 (clock RC522) como pino de boot.
- O LCD I²C usa GPIO21/22 do ESP32 a 3,3 V. Se o módulo PCF8574 for alimentado a 5 V, use adaptação de nível e não exponha SDA/SCL a pull-ups de 5 V. O RC522 deve ser alimentado a 3,3 V.
- Os três LEDs de prédio compartilham GPIO14. Cada LED precisa do seu resistor e, se a corrente total exceder a capacidade do GPIO, de um driver. Verifique a fonte e a corrente de todos os LEDs e relés.
- digitalRead() confirma o nível lógico do GPIO para o ACK; não comprova o estado dos contatos do relé nem a tensão USB. Essas verificações exigem medição física futura.

## Pinagem preservada

| Função | GPIO |
|---|---:|
| Relé EV1 / EV2, ativo LOW | 15 / 33 |
| LED EV1 vermelho / verde | 25 / 26 |
| LED EV2 vermelho / verde | 27 / 32 |
| LEDs bateria 1–4 | 16 / 17 / 18 / 19 |
| Poste / três LEDs do prédio | 13 / 14 |
| LCD SDA / SCL | 21 / 22 |
| RC522 SS / SCK / MOSI / MISO / RST | 5 / 12 / 23 / 34 / 4 |

## Preparação e compilação

1. No Arduino IDE, instale a placa esp32 e selecione ESP32 Dev Module. Este código foi compilado com core ESP32 3.3.12. Para LCD e RFID, instale LiquidCrystal_I2C 1.1.2 e MFRC522 1.4.12.
2. Abra EMPS_ESP32_Maquete_v2.ino, Monitor Serial a 115200 baud, término Nova linha. Sem hardware montado, deixe Wi-Fi, LCD e RFID em 0; as telas são prévias no Monitor Serial. Esta configuração **não recebe comandos do Site**.
3. Após inspeção elétrica, configure EMPS_USAR_LCD=1, EMPS_USAR_RFID=1 conforme os módulos instalados. A biblioteca do LCD pesquisa os endereços 0x27 e 0x3F. GPIO34 é entrada do MISO.
4. Para integração LAN, copie segredos_locais.h.example para segredos_locais.h na mesma pasta do .ino e preencha Wi-Fi, IP LAN do computador e token de dispositivo criado para o Backend local. EMPS_SERVER_BASE aponta para http://<IP_LAN_DO_PC>:3012, a ponte LAN restrita, nunca localhost nem a porta 3011 diretamente. Mantenha EMPS_DEVICE_ID=maquete-01. O arquivo de segredos é ignorado pelo Git.
5. Para diagnosticar comunicação sem acionar saídas, habilite `EMPS_USAR_WIFI=1` e mantenha `EMPS_HABILITAR_RELES=0`. Configure a ponte LAN para o IP específico impresso no Monitor Serial como `[WIFI] ESP32 conectado: IP=...`; sem a ponte LAN, a configuração padrão aceita somente o simulador no próprio computador. Quando Backend, ponte e token responderem, o Site poderá mostrar `Firmware ESP32`, mas um comando START será recusado enquanto os relés estiverem bloqueados. Isto confirma a comunicação, não a carga física.
6. Apenas depois de verificar fiação, intertravamento externo e circuito USB de baixa tensão, uma compilação separada pode usar `EMPS_HABILITAR_RELES=1`. O ESP32 consulta comandos a cada 1,2 s e envia heartbeat a cada 5 s. Sem resposta válida de qualquer uma dessas rotas por 8 s, sem Wi-Fi, sem autorização ou após falha no ACK, desliga os dois relés.

Exemplo de compilação sem gravar na placa:

    arduino-cli compile --fqbn esp32:esp32:esp32 firmware/EMPS_ESP32_Maquete_v2

O upload exige uma etapa separada, futura, após revisão da montagem.

## Contrato com o Backend local

Todas as requisições usam X-Device-Token. A ponte só deve aceitar o IP do ESP32 e encaminhar estas quatro rotas para o Backend em loopback:

| Rota | Corpo ou resposta |
|---|---|
| GET /devices/maquete-01/commands/next | 204 ou texto ID_UNICO\|EV1=1\|ttlMs (EV1/EV2=0/1) |
| POST /devices/maquete-01/commands/ack | JSON com commandId, accepted, ev1, ev2 após leitura lógica de GPIO |
| POST /devices/maquete-01/heartbeat | JSON com bootId, lastCommandId, EVs, barras e luzes; resposta texto com autorização por EV e dados GIE simulados |
| POST /devices/maquete-01/rfid | JSON com uid; resposta APPROVED\|NOME ou DENIED |

O Backend vincula maquete-01 explicitamente à estação local 46. Abrir outro dashboard não altera o vínculo. Futuras estações exigem configuração/autorização explícita no Backend. O firmware aceita remotamente apenas EV1/EV2, com ID, validade, ACK e cache de oito IDs para não repetir acionamentos. O heartbeat inclui autorização separada ev1Authorized/ev2Authorized; a ausência ou revogação desliga o respectivo relé mesmo se um STOP não chegar. Decisões e setpoints GIE nunca autorizam relés. O modo de laboratório não cria sessão ou pagamento operacional.

O snapshot GIE vem somente do Backend. A tela alterna a cada ~3,2 s entre estado EV, rede/solar, SoC médio, BAT_01/BAT_02, luzes, estação e data/hora original do cenário GIE SIMULADO. Dados ausentes ou offline aparecem como indisponíveis; não são substituídos por 0%. Barras: 0%=0, (0,25]%=1, (25,50]%=2, (50,65]%=3, (65,100]%=4, usando média dos SoCs válidos. RFID exibe resposta temporária, mas nunca liga relé; UID do RC522 é clonável e serve apenas para demonstração, não para autenticação financeira.

## Comandos Serial preservados

1, 0, EV1=1/0, EV2=1/0, BAT=25, BAT1=60.8, BAT2=71.8, BAT=OFF, REDE=12.2, SOLAR=27.1, POSTE=1/0, PREDIO=1/0, ESTACAO=POSTO 24H, RFID_TESTE, RFID_OK=USUARIO 01, RFID_NEGADO, STATUS, AJUDA. Com Wi-Fi habilitado, o Serial conserva STATUS, AJUDA e os comandos para parar EV1/EV2; ligar exige comando autorizado pelo Backend **e** compilação com `EMPS_HABILITAR_RELES=1`. O Monitor Serial imprime EV1=1/0, EV2=1/0 e os níveis GPIO.

## Publicação futura

Esta versão não foi publicada. Para uma implantação futura, manter o Backend sem exposição irrestrita, autenticar individualmente cada dispositivo, restringir origem, provisionar e rotacionar tokens, manter auditoria e usar HTTPS com cadeia CA válida em EMPS_CA_CERT_PEM. O firmware não usa setInsecure(); é necessário verificar o relógio do ESP32 e a cadeia de certificados antes de usar HTTPS. Revalidar o circuito de intertravamento e fail-safe em bancada antes de energizar qualquer saída.
