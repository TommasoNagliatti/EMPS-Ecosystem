# Integração do EMPS Charge

Este documento descreve o contrato já usado entre o aplicativo, a API EMPS, o PostgreSQL e os adaptadores externos de pagamento e recarga.

## Arquitetura

```text
Aplicativo Android/iOS
        │ HTTP(S) + JWT + Idempotency-Key
        ▼
API móvel NestJS — /mobile/v1
   ├── PostgreSQL/Prisma
   │    ├── usuários e refresh tokens
   │    ├── eletropostos, carregadores e status ao vivo
   │    ├── vínculos de QR e tarifas
   │    ├── intenções/pagamentos e webhooks
   │    └── sessões e comandos de recarga
   │
   ├──► Stripe ou adaptador sandbox
   └──► gateway CSMS/OCPP ou adaptador sandbox ──► carregador

Aplicativo ──► MapLibre/WebView ──► tiles OpenStreetMap
```

O app nunca conversa diretamente com a bomba. O QR identifica o carregador, mas não contém uma autorização. A API valida a conta, o vínculo de QR, o pagamento e a disponibilidade antes de criar a sessão e despachar um comando.

## Modos de execução

```dotenv
EXPO_PUBLIC_EMPS_API_URL=http://IP-DO-COMPUTADOR:3001
EXPO_PUBLIC_EMPS_DEMO_MODE=false
```

`false` ativa a integração e não permite fallback silencioso para dados simulados. `true` ativa deliberadamente o fluxo local de apresentação.

Em aparelho físico, nunca configure `localhost`. Use o IPv4 LAN do computador ou uma URL HTTPS pública/túnel da própria API. Um túnel iniciado por `expo start --tunnel` transporta o Metro, não o backend.

## Autenticação

```text
POST /mobile/v1/auth/register
POST /mobile/v1/auth/login
POST /mobile/v1/auth/refresh
POST /mobile/v1/auth/logout
GET  /mobile/v1/auth/me
```

Login e cadastro retornam:

```ts
type AuthResult = {
  user: { id: string; name: string; email: string };
  accessToken: string;
  refreshToken: string;
};
```

O access token é enviado como `Authorization: Bearer <token>`. Após um `401`, o cliente tenta uma única renovação, grava o novo par de tokens e repete a solicitação. No Android/iOS, os tokens ficam no Keychain/Keystore por Expo SecureStore. Se a renovação falhar, a sessão local é encerrada.

O servidor guarda apenas o hash do refresh token, rotaciona a família e permite revogação. Um motorista só consulta suas próprias intenções e sessões.

## Eletropostos, mapa e QR

```text
GET /mobile/v1/stations/nearby?lat=&lng=&radiusKm=
GET /mobile/v1/stations/:stationId
GET /mobile/v1/chargers/:chargerId
GET /mobile/v1/qr/:publicToken
```

`stations/nearby` calcula a proximidade usando as coordenadas do PostgreSQL. A API devolve os marcadores, carregadores e disponibilidade. OpenFreeMap fornece o mapa-base com dados do OpenStreetMap.

No app nativo e na versão web, MapLibre usa:

```text
https://tiles.openfreemap.org/styles/liberty
```

Não há chave no APK/IPA. As atribuições ao OpenFreeMap e ao OpenStreetMap são obrigatórias. Para produção com garantia de disponibilidade, use um provedor com SLA ou tiles próprios, sem remover as atribuições.

O QR recomendado usa identificador público opaco:

```text
https://app.emps.com.br/c/<publicToken>
```

O servidor resolve esse token para `QrBinding`, eletroposto e carregador e verifica validade/revogação. O token não carrega segredo, preço ou comando.

Resposta mínima:

```ts
type ResolvedQr = {
  qrBindingId: string;
  station: Station;
  charger: Charger;
  tariffLockedUntil: string;
};
```

Dados do seed:

```text
publicToken: paulista-a01-demo
código curto: EMPS-PAULISTA-A01
chargerId:    chg_001
stationId:    st_001
```

## Pagamento

```text
POST /mobile/v1/payment-intents
GET  /mobile/v1/payment-intents/:id
POST /webhooks/stripe
```

A criação recebe o carregador, método, limite e uma chave de idempotência. Resposta mínima:

```ts
type PaymentIntent = {
  id: string;
  status: string;
  method: "pix" | "card" | "wallet";
  providerClientSecret?: string;
};
```

Com `PAYMENT_PROVIDER=sandbox`, a intenção é registrada e autorizada pelo simulador sem movimentar dinheiro. Com `stripe`, a API exige credenciais do provedor. Cartão/carteira usa autorização e captura; PIX usa confirmação assíncrona e eventual devolução do excedente. O estado confiável vem do webhook assinado e deduplicado no servidor.

PAN e CVV não passam pela API EMPS nem ficam armazenados no app. Para Stripe real, ainda é obrigatório integrar o SDK/fluxo cliente do método escolhido, registrar o endpoint HTTPS de webhook e validar o ambiente sandbox antes da produção.

## Recarga

```text
POST /mobile/v1/charging-sessions/start
GET  /mobile/v1/charging-sessions/active
GET  /mobile/v1/charging-sessions
GET  /mobile/v1/charging-sessions/:id
POST /mobile/v1/charging-sessions/:id/stop
```

O início recebe:

```json
{
  "qrBindingId": "qr_001",
  "paymentIntentId": "payment_intent_...",
  "spendingLimit": 50,
  "idempotencyKey": "start_..."
}
```

`POST /payment-intents`, `POST /charging-sessions/start` e `POST /charging-sessions/:id/stop` recebem também `Idempotency-Key` no cabeçalho. A unicidade é por cliente/operação, impedindo cobrança, início ou parada duplicada após timeout ou repetição de toque.

O aplicativo conecta com Socket.IO em `/realtime`, usando somente transporte WebSocket e `auth.token` com o access token atual. O evento `emps:change` é tratado como sinal de invalidação: o payload não substitui os modelos locais; o cliente refaz as consultas REST autoritativas de sessão, histórico, estação e/ou carregador. Os tópicos reconhecidos são `session.created`, `session.updated`, `payment.updated`, `charger.updated`, `station.updated`, `alert.updated`, `customer.updated` e `dashboard.updated`; tópicos desconhecidos fazem uma atualização conservadora.

Enquanto a tela de recarga está aberta, o polling REST usa cinco segundos quando o WebSocket está fora e 30 segundos como conferência de segurança quando ele está conectado. Fora dessa tela, o contexto confere sessões a cada 15 segundos durante uma queda e a cada 60 segundos com o canal ao vivo; estações e carregadores em cache usam uma conferência separada de cinco minutos. A API continua sendo a fonte de verdade de estado, energia, potência, duração e custo.

Ao iniciar, a API:

1. valida propriedade da intenção e do QR;
2. verifica expiração, status, carregador e tarifa;
3. reserva atomicamente o carregador e cria sessão/comando;
4. despacha o comando ao adaptador OCPP fora da transação curta;
5. persiste aceitação, falha ou timeout.

Ao encerrar, a API despacha a parada, calcula/persiste as métricas, conclui o pagamento e devolve o carregador ao estado disponível. Em produção, energia faturável deve vir do medidor homologado do equipamento, não de uma estimativa por potência nominal e tempo.

## OCPP e equipamento físico

Sem `OCPP_GATEWAY_URL`, o adaptador sandbox aceita comandos e permite testar o software completo, mas não aciona uma bomba.

Com gateway configurado, a API envia comandos correlacionados e autenticados para o CSMS. O gateway deve traduzir `START`, `STOP`, `STATUS`, `RESET` e `UNLOCK` para a versão OCPP do equipamento. OCPP 1.6J e OCPP 2.0.1 não são retrocompatíveis.

“Comando enviado” não equivale a “energia liberada”. A confirmação física deve vir do carregador, junto de status do conector, identificador de transação e telemetria. Produção exige TLS, credenciais/certificados por equipamento, timeout, repetição idempotente e tratamento de desconexão.

## Persistência

O Prisma/PostgreSQL já modela as entidades centrais:

- `User`, `Client` e `RefreshToken`;
- `Station`, `Charger` e `ChargerLiveStatus`;
- `QrBinding`;
- `PaymentIntent`, `Payment` e `WebhookEvent`;
- `ChargingSession` e `ChargingCommand`;
- `Alert`.

Valores monetários e energia usam tipos decimais. Há chaves únicas para e-mail, tokens, códigos públicos, IDs externos e idempotência, além de índices para proximidade, status, sessões e relacionamentos.

## Contrato de erros

Respostas podem vir diretamente no corpo ou envolvidas por `{ "data": ... }`. Erros usam status HTTP correto e podem incluir:

```json
{
  "message": "Descrição segura para o usuário",
  "code": "CODIGO_OPCIONAL"
}
```

O app não deve inventar um estado de sucesso quando ocorrer erro de rede, `401`, rejeição de pagamento ou timeout OCPP.

## Checklist antes de produção

- publicar API, painel, deep links e webhooks em HTTPS;
- trocar todas as senhas e chaves de desenvolvimento;
- configurar Stripe real, SDK cliente e webhook assinado;
- configurar/validar CSMS e OCPP com o modelo físico do carregador;
- usar provedor de tiles OpenStreetMap adequado ao volume;
- publicar política de privacidade, termos e exclusão de conta;
- validar QR adulterado, cliques repetidos e reenvio de webhook;
- testar perda de rede, refresh expirado, app encerrado e carregador offline;
- verificar energia/metrologia, captura, PIX, reembolso e conciliação;
- gerar builds assinados e testar Android e iOS reais.
