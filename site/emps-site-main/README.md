# Plataforma web EMPS

| Pasta | Tecnologia | Responsabilidade |
|---|---|---|
| `frontend/` | Next.js 16 / React | Instalacoes, painel, carregadores e operacao |
| `backend/` | NestJS / Prisma | Identidade, permissoes, contratos e regras de negocio |
| `database/` | MySQL 8 | Schema estrutural e politica de patches |

O aplicativo esta em `../../app/emps-charge` e o GIE em `../../gie/GIE`.
O banco atual e MySQL, nao PostgreSQL. Migrations antigas ficam preservadas
como historico; nao devem ser aplicadas indiscriminadamente.

Comece pelo [guia de execucao na raiz](../../STARTUP.md). Ele centraliza a
instalacao, criacao do banco local, primeiro usuario e configuracao dos servicos.
Nao ha conta de producao ou senha padrao entregue neste repositorio.

[Frontend](frontend/README.md) | [API](backend/README.md) | [Banco](database/README.md).
