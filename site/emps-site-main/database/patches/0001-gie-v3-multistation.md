# Candidato 0001: vínculo GIE V3 por estação

Estado: **proposto, não aprovado nem aplicado**. SQL em `0001-gie-v3-multistation.sql`, idêntico em bytes à migration Prisma `20261014_gie_multistation_binding/migration.sql`.

- SHA-256 do SQL: `a922a3d00961453f9b62d6cf7d44c8e44f426e57683a443e4db0fb15e6be750c`.
- Branch e revisão: `integration/gie-v3-multistation`, [PR #2](https://github.com/TommasoNagliatti/EMPS-Ecosystem/pull/2), dependente do PR #1. O SHA completo **a aprovar para execução** deve ser registrado no documento de aprovação depois da revisão e merge; este pacote não autoriza aplicação.
- Objetivo: associar uma estação EMPS a uma identidade textual GIE de forma unívoca e manter cursor/geração de alertas persistentes.

## Estruturas e compatibilidade

- Cria `gie_station_bindings` com chave primária `station_id`, identidade GIE única, origem, geração e cursor. A chave estrangeira referencia `stations.id` com `ON DELETE RESTRICT`.
- Acrescenta a `alerts` cinco campos GIE opcionais ou com valor padrão: `gie_alert_id`, `gie_last_revision`, `gie_generation`, `gie_payload` e `acknowledged_at`, mais índice único para o ID de alerta GIE. MySQL permite múltiplos `NULL` nesse índice.
- Não altera registros existentes, sessões, pagamentos, usuários nem carregadores. O backend anterior ignora as novas estruturas. O backend V3 exige que elas existam antes da publicação.
- A operação de dados que cria as duas instalações privadas de demonstração é **separada** deste SQL e exige aprovação e identificação do proprietário real. Ela não requer gateway OCPP nem ausência de sessão comercial. A Shopping Frei Caneca permanece no GIE de apresentação e no fluxo comercial legados, sem vínculo operacional V3; a exigência de medição física para uma operação comercial V3 real permanece.

## Pré-verificações na VPS

1. Confirmar versão MySQL 8.0.x, nome/UUID da base e `SHOW CREATE TABLE` de `stations` e `alerts`; comparar tipos, nomes de índices, chaves, charset e schema Prisma revisado. Confirmar que tabela/colunas/índice propostos ainda não existem e que não há patch anterior ou recibo com mesmo número/conteúdo.
2. Examinar tamanho de `alerts`, atividade de escrita e comportamento de bloqueio do `ALTER TABLE` na versão/engine reais. Planejar janela que não interrompa recargas e verificar que o backend anterior permanece compatível durante a expansão.
3. Confirmar backup novo e restaurável da base e configurações, com as verificações do aplicador privado; registrar SHA completo aprovado, checksum acima, aprovador, referência e revisão de compatibilidade.
4. Seguir `docs/DATABASE_CHANGE_POLICY.md`: o aplicador privado exige commit aprovado em `origin/main`, checkout limpo e recibo. O update atual bloqueia diffs Prisma/database e precisa de adaptação aprovada para este release. Não usar `prisma migrate`, `db push`, reset ou `--allow-db-risk` como atalho.

## Verificações posteriores

1. Confirmar `SHOW CREATE TABLE gie_station_bindings` e `SHOW CREATE TABLE alerts`, cinco colunas e índice único; comparar o schema Prisma novo com o banco atualizado em modo leitura.
2. Conferir contagens de `stations`, `alerts`, sessões e pagamentos antes/depois e amostra de registros antigos; nenhuma linha anterior deve ser regravada por este patch.
3. Só depois da expansão estrutural aprovada, publicar backend compatível e testar leitura sem vínculos, isolamento entre estações, alertas e recarga comercial com medições reais. A criação das duas estações privadas é uma etapa de dados distinta.

## Falha e retorno

DDL MySQL pode aplicar parcialmente. Parar a atualização de serviços, inspecionar estrutura e recibo, manter o backend anterior e elaborar um **novo** patch de correção aprovado. Não remover colunas/tabela automaticamente nem apagar o recibo para repetir a aplicação. O rollback normal do código mantém a expansão aditiva. Restaurar backup apenas após decisão específica sobre o estado da base e sessões ocorridas desde o backup.
