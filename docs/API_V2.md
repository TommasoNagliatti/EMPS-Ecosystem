# EMPS Platform V2 — contratos HTTP

01/10/2026. Base de teste `http://127.0.0.1:3101`. Não enviar credenciais nos URLs. IDs pertencem à estação do path e são verificados no servidor. JWT não substitui a checagem atual de conta/papel. Erros usuais: 400 entrada inválida, 401 identidade/token, 403 permissão, 404 objeto inacessível, 409 conflito/idempotência incompatível.

## Estações, revisão e equipe

Prefixo `/v2`, Bearer JWT:

| Método / rota | Uso |
| --- | --- |
| GET /stations | Estações associadas à conta |
| POST /stations | Criar draft |
| GET /stations/:id | Configuração autorizada |
| PATCH /stations/:id | Salvar wizard; MANAGE |
| POST /stations/:id/submit | Enviar revisão |
| GET /reviews | Fila; capability platformReviewer |
| POST /reviews/:id | Decisão, razão, ativação Demo explícita quando solicitada |
| GET/POST /stations/:id/members | Listar/convidar equipe |
| PATCH/DELETE /stations/:id/members/:memberId | Alterar papel/revogar associação |
| POST /invites/accept | Aceitar token de convite vinculado à conta |

DTOs canônicos: `backend/src/platform.dtos.ts`. Horários usam `{alwaysOpen,windows:[{day,start,end}]}`, dias 0=domingo a 6=sábado e HH:mm, interpretados no timezone da estação. Configuração de ativos e valores de SOC não são telemetria física. Fotos continuam pelos endpoints de provisionamento/consulta existentes e aplicam visibilidade.

## Web Charge / pré-pago

Públicos: GET `/web-charge/qr/:token`; POST `/web-charge/guest` com `{qrToken,acceptTerms:true}` retorna token/expiresAt. Estação privada não pode conceder guest.

Demais rotas `/web-charge` usam Bearer da conta ou `X-Guest-Token`:

- GET `authorized-qr/:token`;
- POST `payment-intents`, GET `payment-intents/:id`, POST `payment-intents/:id/cancel`;
- POST `sessions/start`, GET `sessions/active`, GET `sessions/:id`;
- POST `sessions/:id/stop`, GET `sessions/:id/billing`;
- POST `sessions/:id/disconnect`, POST `sessions/:id/payment`.

Intent/START/STOP aceitam `Idempotency-Key`; DTOs seguem `mobile.dtos.ts`. O servidor valida dono, carregador, elegibilidade, disponibilidade, reserva e limite. IDs de pagamento de outra identidade não autorizam recarga. Guest expira; o monitor interno pode concluir sessão pré-paga sem sessão de navegador válida. Não há reembolso bancário via Pix Demo.

Recibo preserva campos existentes e acrescenta disposição financeira e reserva opcional: fee, startAt, endAt, provider, status, paymentReference e totalWithCharging. Taxa de reserva não é recapturada como energia.

## RFID

Prefixo `/v2/stations/:id/rfid`, JWT:

| Rota | Permissão / corpo |
| --- | --- |
| GET /, POST / | MANAGE; criar com uid, label e opcionais userId/unitReference/vehicleReference/organization/expiresAt |
| POST /:credentialId/revoke | MANAGE; conserva histórico |
| POST /authorize | OPERATE; `{uid}` |
| POST /demo/:chargerId/start | OPERATE; `{uid}`, estação e carregador Demo válidos |
| POST /demo/:chargerId/stop | OPERATE; encerra Demo |
| GET /monthly?month=YYYY-MM | MANAGE; rateio no fuso da estação |

UID normalizado hexadecimal, HMAC por estação; não devolvido no cadastro/listagem. Integração física está descrita em [RFID_GOODWE_INTEGRATION_PENDING](RFID_GOODWE_INTEGRATION_PENDING.md).

## Reservas

JWT, prefixo `/mobile/v1/reservations`:

1. POST `/quote` com `{chargerId,startAt,endAt}` ISO8601: preço/política e termsHash do servidor.
2. POST `/` com os mesmos campos, `{termsHash,acceptPolicy:true,idempotencyKey}`.
3. GET `/` lista as reservas do titular.
4. POST `/:id/pay-demo` confirma pagamento Sandbox quando habilitado; FREE já confirma sem cobrança.
5. POST `/:id/cancel` cancela conforme estado; eventual devolução continua pendente de análise manual.

Prazo máximo de início 90 dias, duração máxima 24 horas. Hold limitado a 10 minutos ou início, o que ocorrer antes. NO_SHOW respeita política de chegada limitada pelo fim da janela. Estado final não é fornecido livremente pelo cliente. Conflito entre titulares e consumo único são transacionais. Sem delegação arbitrária de reserva no payload.

## Telemetria

Prefixo JWT `/v2/stations/:id/telemetry`:

| Método / rota | Contrato |
| --- | --- |
| GET sources | MANAGE, sem tokenHash |
| POST sources | MANAGE, `{label,kind}`; token exibido uma vez |
| POST sources/:sourceId/revoke | MANAGE, interrompe novos envios sem apagar histórico |
| POST sources/:sourceId/verify | Revisor autorizado, `{evidence}` 20–2000 caracteres; somente MEASURED |
| POST sources/:sourceId/calculate | MANAGE, `{parentIds}` 1–100 IDs físicos confiáveis da mesma estação; média auditada CALCULATED |
| GET history | READ, `from`, `to` exclusivo e provenance opcional; até 1000 recentes |
| GET readiness | READ, indicadores e contrato preparado |
| GET dataset | MANAGE, `from`, `to`, `origin=MEASURED|IMPORTED`, `model=building|chargers` |
| POST import | MANAGE, multipart `file`, `timezone`, `mode=preview|commit` |

Ingestão de integração: POST `/device/v2/stations/:id/telemetry/:sourceId`, header `X-Telemetry-Token`, corpo `{provenance,rows:[...]}`. Fonte deve estar habilitada e corresponder à estação/origem. Entre 1 e 1000 leituras por chamada. IMPORTED e CALCULATED exigem seus fluxos específicos. Nenhum token é enviado ao GIE atual automaticamente.

Exemplo de leitura (SIMULATED só para fonte cadastrada assim):

```json
{"provenance":"SIMULATED","rows":[{"timestamp":"2026-09-30T08:00:00-03:00","building_power_kw":12,"outside_temperature_c":21,"relative_humidity_percent":65}]}
```

Campos de leitura: grid_power_kw, solar_power_kw, battery_power_kw, charger_power_kw, charger_requested_power_kw, building_power_kw, outside_temperature_c, relative_humidity_percent, connected_vehicle_count, queued_vehicle_count, battery_soc_percent. Unidades são kW, °C, %, contagens inteiras. Rede/bateria admitem sinal; demais potências não negativas. Timestamp requer offset/Z. Somente FORECAST admite horizonte futuro até 30 dias; tolerância de relógio para outras origens é 5 minutos.

Para snapshot completo de 15 minutos acrescente occupied_chargers, arriving_cars, occupancy_percent e delivered_energy_kwh, com todos os campos obrigatórios de prédio/clima/recarga. Energia deve corresponder à potência média entregue × 0,25 h, e entregue não pode exceder solicitada. Snapshot existente não é sobrescrito. Reenvio idêntico é idempotente; divergência é conflito.

CSV/XLSX: até 8 MB, 10000 linhas, uma planilha, máximo 20 colunas no XLSX. Cabeçalho mínimo `timestamp,building_power_kw,outside_temperature_c,relative_humidity_percent`. ISO como texto; fórmulas/objetos não aceitos. Sequência estrita contínua de 15 minutos, sem duplicatas/lacunas, valores finitos e unidades canônicas. Timezone deve coincidir com a estação; offset explícito determina o instante e não é inferido da localidade do arquivo. Prévia não grava; commit conserva origem IMPORTED e lote/hash, repetição do mesmo arquivo retorna replay. Sobreposição de histórico importado é rejeitada.

Dataset: janela máxima 731 dias e 100000 registros; dados ambíguos/incompletos excluídos e lacunas contadas. Cada linha conserva station_id, timestamp e available_at após 15 min, além de origem/fonte/lote quando aplicável. Não inicia treino nem substitui modelo. A origem MEASURED exige fonte verificada, não apenas texto no enum.

Readiness: `model`, `realDataDays`, `qualityPercent`, `usableConsumptionIntervals`, `coveragePercent`, `latestTrustedTelemetryAt`, contagens por origem, intervalos contínuos, blockers e gieContract. Sem leituras físicas: dias/intervalos zero, qualidade/timestamp nulos. Janela de análise 730 dias; contagem truncada é explicitada. Última leitura confiável consulta o histórico físico GOOD sem limite dessa janela. Modelo Base é preparação/configuração; runtimeActivated e personalizationAvailable permanecem false.
