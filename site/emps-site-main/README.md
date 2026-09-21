# EMPS — Energy Monetization Platform

Monorepo da plataforma EMPS para operação de carregadores de veículos elétricos. A mesma API e o mesmo banco atendem o painel administrativo e o aplicativo do motorista.

## Componentes

| Pasta | Tecnologia | Responsabilidade |
| --- | --- | --- |
| `backend/` | NestJS, Prisma e PostgreSQL | Login, regras de negócio, QR, pagamentos, sessões e comandos de recarga |
| `frontend/` | Next.js 16 e React | Painel administrativo conectado à API |
| `mobile/` | Expo SDK 54 e React Native | Aplicativo Android/iOS conectado à API móvel e compatível com Expo Go 54.x |
| `database/` | SQL de referência | Esquema MySQL recebido, preservado apenas como referência do domínio |

O banco executável é PostgreSQL. Sua fonte de verdade é `backend/prisma/schema.prisma`, e as alterações são aplicadas pelas migrations Prisma. Não é necessário levantar um MySQL separado.

## Fluxo integrado

```text
Painel Next.js ───────┐
                     ├── HTTPS/JWT + Socket.IO/JWT ──► API NestJS ──► PostgreSQL/Prisma
App Expo Android/iOS ┘                                      │
                                                           ├──► Stripe ou simulador de pagamento
                                                           └──► gateway CSMS/OCPP ou simulador local

App Expo ──► MapLibre ──► tiles do OpenStreetMap
```

O app consulta eletropostos, resolve o QR no servidor, cria uma intenção de pagamento e solicita o início ou encerramento da sessão. Ele não envia comandos diretamente ao carregador. A API mantém a autorização, a idempotência e o estado da sessão.

## Cadastro seguro de novas bombas

O menu **Cadastro de carregadores** do website usa um fluxo de quatro etapas, sem limite fixo de bombas por eletroposto:

1. o administrador do eletroposto solicita o cadastro e recebe um código temporário de ativação;
2. o instalador informa esse código, o número de série e a identidade OCPP da bomba física;
3. um operador EMPS confere a solicitação e homologa ou rejeita o equipamento;
4. somente na homologação a API cria, em uma única transação, o carregador operacional, o estado ao vivo e o QR Code oficial.

Solicitações pendentes, rejeitadas, canceladas ou expiradas não aparecem no aplicativo do motorista. O código temporário possui 64 bits aleatórios, expira por padrão em sete dias e é salvo no banco somente como hash. Número de série e identidade OCPP não podem ficar ativos em dois cadastros simultâneos.

Depois de uma alteração, a API envia pelo Socket.IO apenas o tipo e o ID do que mudou. O painel e o aplicativo refazem as consultas REST e recebem o estado oficial do PostgreSQL. Em uma queda do WebSocket, ambos reconectam; o painel ativa sincronização periódica e a tela de recarga mantém polling REST de cinco segundos.

## Início rápido no Windows PowerShell

Requisitos: Node.js com npm, Docker Desktop e Expo Go atualizado no celular.

Na raiz do projeto:

```powershell
npm run install:all
docker compose up -d
```

Prepare o backend:

```powershell
Set-Location backend
Copy-Item .env.example .env
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

Deixe esse terminal aberto. A API responde em `http://localhost:3001`; confirme em `http://localhost:3001/auth/health`.

Em outro PowerShell, inicie o painel:

```powershell
Set-Location frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abra `http://localhost:3000/login`.

Depois do primeiro login, o painel restaura a conta automaticamente ao reabrir o
navegador e renova a autorização curta em segundo plano. A credencial persistente
fica protegida em cookie `HttpOnly`; somente **Sair**, revogação administrativa ou
inatividade além da janela configurada encerram a sessão.

Em um terceiro PowerShell, inicie o aplicativo:

```powershell
Set-Location mobile
Copy-Item .env.example .env
npm install
npx expo start --lan --clear
```

Antes de ler o QR do Expo, edite `mobile/.env` e troque o IP de exemplo pelo IPv4 do computador:

```dotenv
EXPO_PUBLIC_EMPS_API_URL=http://IP_DA_REDE:3001
EXPO_PUBLIC_EMPS_DEMO_MODE=false
```

Descubra o IPv4 com `ipconfig`. O computador e o celular precisam estar na mesma rede Wi-Fi, e o Firewall do Windows deve permitir o Node.js e a porta `3001` na rede privada.

> Em celular físico, nunca use `localhost` como endereço da API: ele aponta para o próprio celular. Use o IP LAN do computador ou uma URL HTTPS de túnel que também exponha a API. `npx expo start --tunnel` expõe o Metro/Expo, mas não expõe automaticamente o backend na porta `3001`.

## Credenciais de desenvolvimento

Depois de executar `npm run prisma:seed`:

| Uso | E-mail | Senha |
| --- | --- | --- |
| Painel do dono do eletroposto | `admin@emps.com` | `admin123` |
| Administração e aprovações GoodWe | `goodwe@emps.com` | `goodwe123` |
| Operação EMPS | `operador@emps.com` | `operador123` |
| Aplicativo do motorista | `motorista@emps.com` | `emps123` |

O seed não cria mais carregadores, sessões, pagamentos ou faturamento fictícios.
Para obter um QR válido, solicite o equipamento em **Cadastro de carregadores**,
valide a conexão física com o código temporário e entre como operador EMPS para
homologá-lo. O QR oficial aparece somente após essa aprovação.

O QR mostrado pelo terminal do Expo serve apenas para abrir o app no Expo Go; ele não é o QR do carregador.

## OpenStreetMap

No Android e iOS, o mapa usa MapLibre dentro de uma WebView e os tiles raster públicos do OpenStreetMap em `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Não é necessária chave de API. Os pontos e a disponibilidade dos eletropostos vêm da API EMPS, não do OpenStreetMap.

O serviço público de tiles exige atribuição e possui política de uso, sem SLA. Ele é adequado para desenvolvimento e demonstração. Antes de uso comercial em escala, configure um provedor de tiles baseado em OpenStreetMap ou hospede seus próprios tiles, mantendo a atribuição aos contribuidores.

## Modo conectado e modo demonstração

O modo normal é o conectado:

```dotenv
EXPO_PUBLIC_EMPS_DEMO_MODE=false
NEXT_PUBLIC_EMPS_DEMO_MODE=false
```

Não existe fallback silencioso para mocks. Se a API estiver indisponível, o aplicativo e o painel mostram o erro. Para uma apresentação totalmente local e sem backend, ative `true` explicitamente no `.env` correspondente e reinicie o processo limpando o cache quando necessário.

## Pagamento e carregador real

Com `PAYMENT_PROVIDER=sandbox` e sem `OCPP_GATEWAY_URL`, a API executa o fluxo completo no banco usando simuladores seguros: nenhum dinheiro é movimentado e nenhuma bomba física é liberada.

Para produção:

- Stripe exige `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, configuração do webhook e fluxo cliente do método de pagamento;
- a bomba exige um CSMS/gateway OCPP acessível, além de `OCPP_GATEWAY_URL` e `OCPP_GATEWAY_TOKEN`;
- a aplicação inteira deve ser publicada em HTTPS e usar segredos próprios de produção.

Configurar somente as telas não transforma os simuladores em pagamento ou carregamento reais. Valide primeiro em sandbox e com um simulador OCPP, depois em equipamento controlado.

## Verificações

```powershell
npm --prefix backend run check
npm --prefix frontend run build
npm --prefix mobile run check
npm --prefix mobile run export
```

Consulte `backend/README.md`, `frontend/README.md`, `mobile/README.md` e `mobile/INTEGRATION.md` para detalhes de cada componente.
