# EMPS API

API central da plataforma EMPS. Foi construída com NestJS, Prisma e MySQL 8 e atende tanto o painel administrativo quanto o aplicativo Android/iOS.

## Responsabilidades

- autenticação JWT para administradores, operadores e motoristas;
- refresh token rotativo para o painel e o aplicativo;
- cadastro e consulta de eletropostos, carregadores e status ao vivo;
- provisionamento controlado de bombas físicas, com código temporário e homologação;
- resolução autoritativa do QR de cada carregador;
- intenção, confirmação e conciliação de pagamento;
- início, acompanhamento e encerramento idempotente de sessões;
- envio de comandos a um gateway CSMS/OCPP;
- dashboard, clientes, alertas e ações do painel administrativo.

## Banco de dados

A fonte de verdade é `../database/EMPS_Database_Completo.sql`, já aplicada no container `emps-mysql`. O Prisma representa suas 20 tabelas sem criar tabelas legadas. Configure `DATABASE_URL` conforme `.env.example`.

As migrations em `prisma/migrations` são histórico PostgreSQL, preservado para consulta. Não execute essas migrations no MySQL. O comando `npm run prisma:migrate` recusa a execução para evitar uso acidental. Uma estratégia de baseline para futuras migrations MySQL fica para uma etapa específica; não é necessária para executar a API sobre o banco oficial existente.

Depois de iniciar o MySQL com o compose da raiz, nesta pasta:

```powershell
# Crie .env apenas se ainda não existir.
Copy-Item .env.example .env
npm ci
npx prisma format
npx prisma validate
npx prisma generate
npm run build
npm test
npm run start:dev
```

A API responde em `http://localhost:3001`. Verifique sem autenticação:

```powershell
Invoke-RestMethod http://localhost:3001/auth/health
```

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão MySQL usada pelo Prisma |
| `JWT_SECRET` | Segredo de assinatura; use pelo menos 32 caracteres aleatórios e nunca publique o valor |
| `JWT_EXPIRES_IN` | Vida do access token, por exemplo `15m` |
| `REFRESH_TOKEN_DAYS` | Vida máxima do refresh token móvel |
| `WEB_REFRESH_TOKEN_DAYS` | Janela deslizante da sessão persistente do painel, padrão de 365 dias |
| `CHARGER_ACTIVATION_DAYS` | Validade do código temporário entregue ao instalador (1 a 30 dias) |
| `PORT` | Porta HTTP da API, padrão `3001` |
| `CORS_ORIGINS` | Origens web permitidas, separadas por vírgula |
| `PAYMENT_PROVIDER` | `sandbox` ou `stripe` |
| `STRIPE_SECRET_KEY` | Chave secreta da Stripe quando o provedor for `stripe` |
| `STRIPE_WEBHOOK_SECRET` | Segredo de assinatura de `POST /webhooks/stripe` |
| `OCPP_GATEWAY_URL` | URL do adaptador/CSMS que recebe comandos da EMPS |
| `OCPP_GATEWAY_TOKEN` | Bearer token desse gateway |

No painel aberto por outro computador da rede, acrescente sua origem a `CORS_ORIGINS`, por exemplo:

```dotenv
CORS_ORIGINS="http://localhost:3000,http://IP_DA_REDE:3000"
```

O app React Native não deve usar `localhost` em celular físico. A variável do app deve apontar para `http://IP-DO-COMPUTADOR:3001` durante o desenvolvimento ou para a URL HTTPS publicada da API.

## Seed de desenvolvimento

O seed acrescenta um conjunto identificado por `mysql-qa-<timestamp>`: administrador, operador atribuído, operador sem atribuição, estação, tarifa, comodidade, três carregadores, telemetria e QRs. Não limpa tabelas e não sobrescreve contas existentes.

Defina `SEED_PASSWORD` com pelo menos 12 caracteres e execute `npm run prisma:seed`. O comando informa os e-mails e IDs criados; a senha vem exclusivamente do ambiente. Não há credenciais fixas nem dados fictícios no SQL-base. Cada execução cria um conjunto novo e conserva seus registros para auditoria.

## Compatibilidade com o MySQL oficial

- IDs INT/BIGINT entram como strings decimais pela API; o backend valida limites e retorna strings sem perda de precisão. Valores monetários continuam em Decimal no banco.
- Roles TypeScript/JSON `ADMIN`, `OPERATOR`, `CUSTOMER` usam `@map` para os valores físicos `admin`, `operator`, `customer`. Administradores acessam suas estações; operadores precisam de atribuição em `station_staff`.
- `Client` representa `users` com role customer e `user_vehicles`. Clientes avulsos criados pelo painel recebem conta sem login e e-mail sintético exclusivo. Remover cliente bloqueia a conta e desativa veículos; remover carregador desativa o equipamento e seus QRs, preservando histórico.
- Preço vem da tarifa ativa vigente do carregador ou, na ausência dela, da estação. Sessões guardam snapshots de preço e taxa fixa. Sem tarifa vigente, iniciar recarga é recusado.
- Provisionamento usa carregador pending e comando `run_checklist` com metadados JSON de ativação/revisão. Aprovação habilita o mesmo equipamento e cria tarifa/QR atomicamente. A identidade física continua reservada depois de arquivar a solicitação; não é criada tabela ChargerProvisioning.
- PaymentIntent usa pix/card/wallet com provider sandbox. Captura, recebimento e troco ficam em payments; a intenção continua authorized após captura. Não existe estado captured no enum SQL.
- Webhook Stripe verifica a assinatura e consulta o estado atual no provedor para evitar reaplicar eventos antigos. Não é criada tabela WebhookEvent. Stripe e hardware externos exigem validação futura.
- As três tabelas GIE estão mapeadas, sem integração ou execução do GIE.
- Os CHECKs e collations continuam sendo aplicados pelo MySQL. Prisma não representa integralmente esses metadados; mantenha o SQL oficial como referência.

## Rotas principais

### Painel administrativo

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
GET  /auth/health
GET  /dashboard/summary
GET  /clients
GET  /chargers
GET  /charging-sessions
GET  /payments
GET  /alerts

GET  /charger-provisionings
POST /charger-provisionings
POST /charger-provisionings/:id/approve
POST /charger-provisionings/:id/reject
POST /charger-provisionings/:id/cancel
POST /device/v1/charger-provisionings/claim
```

As rotas operacionais protegidas permitem enviar comandos ao carregador, fazer liberação manual, iniciar e receber sessões pós-pagas, finalizar sessões, aprovar pagamentos e resolver alertas.

O painel guarda somente o access token curto na aba. O refresh token permanece em
cookie `HttpOnly`, não é exposto ao JavaScript e é trocado a cada renovação. Ao
reabrir o navegador, o painel restaura a conta automaticamente; enquanto houver
uso dentro da janela configurada, a validade é renovada de forma deslizante. O
botão **Sair** revoga o token persistente mesmo que o access token já tenha vencido.

### Aplicativo

```text
POST /mobile/v1/auth/register
POST /mobile/v1/auth/login
POST /mobile/v1/auth/refresh
POST /mobile/v1/auth/logout
GET  /mobile/v1/auth/me

GET  /mobile/v1/stations/nearby?lat=&lng=&radiusKm=
GET  /mobile/v1/stations/:id
GET  /mobile/v1/chargers/:id
GET  /mobile/v1/qr/:publicToken

POST /mobile/v1/payment-intents
GET  /mobile/v1/payment-intents/:id
POST /mobile/v1/charging-sessions/start
GET  /mobile/v1/charging-sessions/active
GET  /mobile/v1/charging-sessions
GET  /mobile/v1/charging-sessions/:id
POST /mobile/v1/charging-sessions/:id/stop
```

As operações mutáveis de pagamento e recarga recebem `Idempotency-Key`. Repetir a mesma operação com a mesma chave não deve criar cobrança ou sessão duplicada.

## Atualizações em tempo real

O Socket.IO usa o mesmo servidor e JWT da API no namespace `/realtime`. O cliente deve enviar o access token em `auth.token` ou no header `Authorization: Bearer <token>`. Conexões sem JWT válido são recusadas antes de entrar nas salas.

O servidor envia `emps:change` com um contrato mínimo, sem nomes, e-mails ou dados financeiros:

```json
{
  "eventId": "uuid",
  "topic": "session.updated",
  "entityId": "session-id",
  "occurredAt": "2026-08-28T18:30:00.000Z",
  "customerId": "user-id-quando-aplicável"
}
```

Os tópicos são `session.created`, `session.updated`, `payment.updated`, `charger.updated`, `station.updated`, `alert.updated`, `customer.updated` e `dashboard.updated`. O evento é apenas um sinal para o cliente refazer a consulta REST; ele não replica registros do banco.

Todo usuário autenticado entra em `authenticated`; administradores e operadores recebem invalidações em `operations`, e motoristas em `customer:<sub>`. Os eventos contêm apenas IDs/metadados. As consultas REST continuam filtradas pelas estações autorizadas. O servidor confirma a inscrição com `emps:ready`.

O emissor atual atende uma única instância da API. Antes de executar mais de uma réplica, configure um adaptador Socket.IO compartilhado (por exemplo, Redis) e uma entrega durável/outbox para os eventos. O polling de segurança dos clientes continua reconciliando o estado, mas não substitui essa configuração de escala.

## Pagamentos

O padrão é seguro para desenvolvimento:

```dotenv
PAYMENT_PROVIDER="sandbox"
```

Nesse modo, o fluxo é persistido no banco, mas nenhum dinheiro é movimentado. Para Stripe, configure o provedor, as duas credenciais e o webhook assinado. Cartão/carteira usa autorização e captura; PIX é assíncrono e exige confirmação por webhook. O app e a API nunca devem armazenar PAN ou CVV.

Ter as variáveis no `.env` não basta para produção: também é necessário configurar o método de pagamento no cliente, registrar o webhook público HTTPS na Stripe e validar reembolso, duplicidade, falha e conciliação em sandbox.

## Comandos de recarga

Sem `OCPP_GATEWAY_URL`, o adaptador local aceita comandos em modo sandbox e registra o fluxo, mas não libera equipamento físico.

Com as variáveis OCPP configuradas, a API envia `POST {OCPP_GATEWAY_URL}/commands` com autenticação Bearer. Esse gateway deve traduzir o contrato EMPS para o CSMS/OCPP compatível com o equipamento. OCPP 1.6J e 2.0.1 usam comandos diferentes e não são compatíveis entre si.

Uma resposta HTTP aceita confirma somente que o gateway recebeu o comando. A sessão deve ser considerada fisicamente iniciada ou encerrada após o evento autoritativo do carregador e sua telemetria.

## Segurança e produção

- execute API, painel, app e webhooks somente por HTTPS;
- guarde segredos fora do Git e use valores distintos por ambiente;
- restrinja `CORS_ORIGINS` aos domínios reais;
- mantenha access token curto e refresh tokens revogáveis;
- valide assinatura e deduplique eventos de webhook;
- planeje futuras alterações MySQL separadamente; não execute o histórico de migrations PostgreSQL;
- faça backup do MySQL antes de qualquer atualização de produção.

## Verificação

```powershell
npm run check
```

Esse comando gera o cliente Prisma, compila a API e executa os testes automatizados. Para inspecionar os dados locais:

```powershell
npx prisma studio
```

### Validação real

`npm run test:mysql` compila e inicia temporariamente a API na porta 3107 (ajustável por `SMOKE_PORT`), cria registros QA identificados e valida HTTP, persistência, concorrência e recuperação de falha do provedor. Encerra o processo iniciado ao terminar. Gera `reports/mysql-smoke.json`; não apaga os dados QA. O relatório inclui banco/versão, IDs e todas as requisições.
