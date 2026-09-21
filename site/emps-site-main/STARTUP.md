# Inicialização local EMPS

Atualizado e validado em 19/09/2026. A migration V1 já foi aplicada nesta máquina. Não execute seed, limpeza nem migration para iniciar.

## Amanhã: um comando

1. Abra o Docker Desktop e aguarde o mecanismo iniciar.
2. Abra um PowerShell e execute:

```powershell
Set-Location '.\site\emps-site-main\backend'
node scripts/start-ecosystem.cjs --with-app
```

O iniciador verifica/inicia o container existente `emps-mysql`, depois inicia **GIE Service → Backend → Site → Expo**. Não altera banco, backups ou arquivos `.env`. Usa as dependências já instaladas. Mantém os subprocessos sem abrir janelas extras. `Ctrl+C` encerra os serviços desse lançamento; MySQL continua funcionando.

Se `node` não estiver no PATH, use o executável que foi validado nesta máquina:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/start-ecosystem.cjs --with-app
```

| Serviço | Endereço padrão |
|---|---|
| MySQL | localhost:3306 / emps_db |
| GIE Service | http://127.0.0.1:8510 (Bearer de serviço obrigatório) |
| Backend | http://localhost:3001/auth/health |
| Site | http://localhost:3000 |
| Expo | exp://IP_DA_REDE:8081 (use o IP impresso pelo iniciador) |
| App web | http://localhost:8081 |

O iPhone precisa estar na mesma rede do computador. No Expo Go, abra o endereço `exp://IP:8081` impresso no terminal. A câmera física e o iPhone não foram testados nesta finalização; o fluxo completo foi exercitado no App web. Para fixar o endereço LAN, acrescente `--lan-ip IP_DA_REDE`. Não use localhost como backend no iPhone.

Se uma porta estiver ocupada, o iniciador **recusa** a execução; não mata nem reutiliza o serviço existente. Encerre o terminal antigo correspondente ou use as portas alternativas que foram testadas:

```powershell
node scripts/start-ecosystem.cjs --backend-port 3107 --site-port 3108 --expo-port 8083 --with-app
```

O GIE continua na porta 8510 definida em `.env.presentation`. Os logs ficam em `backend/reports/startup-*.log` e são ignorados pelo Git. Omita `--with-app` para iniciar somente GIE, Backend e Site.

## Acesso e cenário existente

As credenciais foram geradas localmente e estão em `backend/.env.presentation`, ignorado pelo Git. Não copie esse arquivo para relatórios ou repositórios. Para consultá-las no seu terminal:

```powershell
Get-Content .env.presentation | Select-String '^(ADMIN_EMAIL|ADMIN_PASSWORD|CUSTOMER_EMAIL|CUSTOMER_PASSWORD)='
```

- Site: `admin.dev@emps.local`, role oficial `admin`.
- App: `motorista.demo@emps.local`, role oficial `customer`.
- Estação **13 — EMPS Demonstração Integrada**; carregador **49 — EMPS Demo 01**, Vaga 01, 22 kW; EVSE 1.
- Novas sessões móveis/conta aberta na estação 13: SP_ENEL_PROTO_V1, R$ 1,99 a R$ 2,29/kWh por intervalo, sem taxa fixa. Permanência após fim da carga: 15 minutos de carência, R$ 0,25/minuto iniciado, teto R$ 20.
- Sessões anteriores e o caixa pré-pago por valor definido mantêm o contrato legado. Nenhum backfill.
- Carregador 50 (Vaga 02, nominal 60 kW) também está associado ao EVSE 2; o perfil demonstrativo limita cada slot a 22 kW. A sessão legada 64 do carregador 49 permanece aberta e protegida contra avanço automático após ativação V1.
- A estação 11, o EV-Charge 44 e o customer manual 57 permanecem preservados. A estação 11 também aparece no mapa; não é uma duplicata descartável.

O GIE inicia em **NORMAL, parado, sem estado energético calculado**. No Site, abra “Controle energético GIE”, selecione `MANUAL_DEMO` e clique “Reset manual”. Assim o MPC original recebe a demanda das sessões mapeadas. `Presentation` usa cenas próprias e não fornece energia a sessões comerciais. Não existe confirmação de hardware; pagamentos e medição são sandbox.

No App: estação → vaga → QR/código → PIX sandbox → iniciar → acompanhar → encerrar. O QR da vaga é gerado pelo backend; o QR do Expo serve apenas para abrir o App. O código público da vaga também está na evidência `reports/full-integration.json` no endpoint `/mobile/v1/qr/...`.

Para caixa: Site → Caixa → Conta aberta → Iniciar → Cobrar. O modal recebe energia, tarifa, taxa e total do backend. A cotação dura 120 segundos; reabra o modal para renovar uma cotação expirada. O valor informado deve cobrir o total exibido. “Valor definido” mantém o fluxo pré-pago.

## Verificações e recuperação

```powershell
Invoke-RestMethod http://localhost:3001/auth/health
```

Após editar backend, pare o iniciador, compile e execute-o novamente:

```powershell
node node_modules/@nestjs/cli/bin/nest.js build
node scripts/start-ecosystem.cjs --with-app
```

O smoke legado está em `backend/scripts/full-integration-smoke.ts`; suas premissas tarifárias são anteriores à V1. Para a configuração nova use `backend/scripts/tariff-stripe-smoke.ts --apply`. **Não é necessário executá-lo para iniciar a apresentação.** Quando deliberadamente executado, usa/reutiliza o cenário de `.env.presentation` e acrescenta sessões sandbox; não limpa dados. Requer portas 3107 e 8510 livres:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/tariff-stripe-smoke.ts --apply
```

O bootstrap de outro administrador é um CLI local `scripts/bootstrap-admin.ts`, exige `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (12+ caracteres), usa bcrypt e recusa alterar/promover conta existente. Não há endpoint público de promoção a admin. Não execute seeds ou limpeza QA para uso normal.


## Stripe Sandbox e configuração local

Backend `.env` mantém DATABASE_URL/JWT; `.env.presentation` mantém credenciais locais,
GIE e `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_...`,
`TARIFF_V1_STATION_IDS=13`, `TARIFF_V1_ACTIVATED_AT=2026-09-19T18:43:02.092Z`,
`GIE_NORMAL_DEMO=true` e `GIE_WEATHER_ENABLED=true`.
App `.env`: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...` da mesma conta Sandbox.
Nunca coloque a chave secreta no App, nos relatórios ou no Git.

O iniciador usa a CLI oficial Stripe instalada como dependência de desenvolvimento,
obtém o signing secret em memória e encaminha eventos para
`http://127.0.0.1:3001/payments/stripe/webhook`. Requer acesso à internet.
O segredo não é impresso nem persistido pelo iniciador. Para rodar backend
isoladamente, configure o signing secret do seu listener em `STRIPE_WEBHOOK_SECRET`.
Após encerrar a carga, confirme a retirada: o backend congela o breakdown e cria
o PaymentIntent com o total final. PaymentSheet está implementado no App nativo;
a versão web informa que esse pagamento requer o App nativo. Cartão de teste:
4242 4242 4242 4242, validade futura e CVC de teste. Não use cartões reais.
Abaixo de R$ 0,50, Stripe retorna erro controlado; o sistema não aumenta o total.
Total zero é encerrado sem transação Stripe. Cancelar o sheet permite nova tentativa.

Fallback: antes de iniciar, use `PAYMENT_PROVIDER=sandbox` em `.env.presentation`.
Isso vale para novas sessões e registra pagamento simulado. Uma falha Stripe não
é convertida automaticamente em pagamento aprovado de outro provedor.

NORMAL é demonstrativo: demanda das sessões/MySQL, horário local, cloud_cover
Open-Meteo quando disponível e fallback determinístico. Prédio/solar/SOC não são
medidores físicos. Presentation inicia pausada e não gera energia faturável.
GIE offline mantém o backend acessível e interrompe avanço da potência simulada.

## Instalação após transferência

Requisitos: Docker Desktop/MySQL 8, Node 24/npm, Python 3.12. Sem reset do banco.
Na raiz do ecossistema:

```powershell
npm --prefix site/emps-site-main/backend ci
npm --prefix site/emps-site-main/frontend ci
npm --prefix app/emps-charge ci
py -3.12 -m venv gie/GIE/.venv
gie/GIE/.venv/Scripts/python.exe -m pip install -r gie/GIE/requirements-service.txt
py -3.12 -m venv gie/GIE/.venv-demo
gie/GIE/.venv-demo/Scripts/python.exe -m pip install -r gie/GIE/requirements.txt -r gie/GIE/requirements-demo.txt
cd site/emps-site-main/backend
npx prisma generate
npm run build
node scripts/start-ecosystem.cjs --with-app
```

No celular, use build nativo com suporte à versão instalada de Stripe/Expo e
backend no IP LAN. O PaymentSheet nativo/3DS e câmera física ainda precisam de
validação no aparelho. O pagamento Sandbox e os webhooks foram testados com a API
real do Stripe; o App web validou login, estação, carregadores, histórico e recibo.
