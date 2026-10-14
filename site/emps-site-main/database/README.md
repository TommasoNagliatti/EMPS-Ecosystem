# Banco MySQL 8

`EMPS_Database_Completo.sql` contem a estrutura consolidada para inicializar
um **volume local novo**. Nao contem registros do banco oficial.

O contrato usado pela API e `../backend/prisma/schema.prisma`, com provider
`mysql`. O historico de migrations inclui etapas antigas de PostgreSQL; nao
aplique todas indiscriminadamente em MySQL e nao use `db push` ou `reset` para
resolver divergencias sobre um banco existente.

Patches novos seguem [a politica de banco](../../../docs/DATABASE_CHANGE_POLICY.md)
e exigem revisao, backup e aprovacao do grupo. Publicar os arquivos no GitHub
nao aplica o SQL na VPS. Acesso remoto padrao: somente leitura e configuracao
individual fora do repositorio.
