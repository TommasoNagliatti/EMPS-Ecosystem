# API EMPS

NestJS e Prisma com MySQL 8. A API atende site e app, com autorizacao por
associacao a instalacao, autenticacao JWT, realtime, carregadores, sessoes,
pagamentos Sandbox, reservas, ativos, QR e adaptadores de GIE.

## Execucao local

Siga [o guia de execucao](../../../STARTUP.md). Depois de instalar `npm ci`,
gerar Prisma e configurar seu `.env`, compile com `npm run build` e inicie
com `npm run start:dev`. Saude: http://localhost:3001/auth/health.

O SQL estrutural esta em `../database/EMPS_Database_Completo.sql`, usado pelo
Compose em um volume novo. O modelo atual da API esta em `prisma/schema.prisma`.
O historico de migrations inclui PostgreSQL e etapas posteriores; nao execute
`migrate deploy`, `reset` ou `db push` indiscriminadamente sobre MySQL existente.
O comando `prisma:migrate` possui uma politica explicita de bloqueio.

## Seguranca e configuracao

- `.env.example` e `.env.remote.example` documentam os campos, sem credenciais
  oficiais. Use segredos aleatorios separados para JWT e GIE.
- `PAYMENT_PROVIDER=sandbox` e o padrao local. Stripe exige chaves de teste
  proprias e validacao de webhook; nao ha chave instalada neste repositorio.
- O app usa `/mobile/v1`; o site usa autenticacao web e contratos de operacao.
- Comandos fisicos exigem integracao/homologacao separadas; simulacao nao
  comprova comunicacao com hardware.
- O [modo remoto](../../../docs/REMOTE_DEVELOPMENT_HOSTINGER.md) valida grants,
  identidade e schema, bloqueando escrita, jobs e efeitos externos.
- [API V2](../../../docs/API_V2.md) e [arquitetura](../../../ARCHITECTURE.md)
  detalham os contratos do dominio.

## Testes

Na raiz, use `npm run check:api`: o wrapper limpa variaveis de integracao,
usa um destino MySQL ficticio nao conectavel, gera Prisma, compila e executa
os testes sem habilitar suites MySQL com escrita. Testes de banco precisam de
ambiente descartavel e aprovacao especifica. Nunca aponte essas suites ao banco
oficial, mesmo que usem rollback de fixtures.
