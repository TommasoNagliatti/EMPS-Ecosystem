# Candidato 0002: histórico energético e financeiro demonstrativo

Estado: **proposto, não aprovado nem aplicado no banco oficial**. SQL em
`0002-demo-history.sql`, idêntico em bytes à migration Prisma
`20261015_demo_history/migration.sql`.

- SHA-256 do SQL: `8dfc5fa008d4d864ee43bf7859309aaf4bc9688cb3630006b95793ff37bc5945`.
- Branch de desenvolvimento: `feat/gie-demo-history-mysql`, empilhada sobre o PR #2
  e de seu vínculo GIE V3 proposto no patch 0001. Registrar o SHA completo do
  commit **aprovado e integrado à `origin/main`** antes de qualquer execução oficial.
- Objetivo: guardar sessões, pagamentos e intervalos energéticos históricos
  demonstrativos por estação, sem escrever nas tabelas operacionais de recarga,
  telemetria ou financeiro.

## Estrutura e compatibilidade

O patch somente cria `demo_import_batches`, `demo_charging_sessions`,
`demo_payments` e `demo_energy_readings`. Não altera tabelas existentes nem
regrava registros. Cada linha tem origem restrita ao enum `SIMULATED`. O lote
guarda a estação, identidade do perfil GIE, chave e SHA-256 do dataset,
revisão, versão do cenário, semente, intervalo original e metadados de tarifa.

Sessões preservam o ID de origem, carregador de origem opcional, carregador EMPS
opcional até mapeamento verificado, horários, energia solicitada/entregue,
tarifa, taxa fixa, custo e valor calculado. Energia usa `DECIMAL(18,10)` para
preservar os CSVs; dinheiro usa `DECIMAL(12,2)` e tarifa/custo unitário
`DECIMAL(10,4)`. Pagamentos têm canal e método independentes e estado
`SIMULATED_SETTLED`; não têm provedor, intenção externa ou recibo fiscal.
Leituras armazenam intervalos de 15 minutos com potências e energias tipadas,
estados das baterias e linha bruta para proveniência.

Chaves estrangeiras compostas ligam toda linha à **mesma estação e ao mesmo
lote**. O pagamento também aponta para uma sessão do mesmo par lote/estação.
Índices únicos de `(batch_id, source_session_id)`,
`(batch_id, source_payment_id)` e `(batch_id, source_reading_id)` impedem
duplicatas dentro da importação. Um mesmo dataset/cenário/semente na mesma
estação identifica um único lote; importações repetidas devem reutilizá-lo.
Consultas e limpeza devem exigir `batch_id` explícito. Um lote antigo ou
superado não participa de um resumo de outro lote. A exclusão de um lote
selecionado exige apagar somente seus pagamentos, sessões e leituras nessa
ordem, dentro de transação autorizada; FKs `RESTRICT` impedem cascata implícita.

O vínculo opcional `charger_id` referencia o carregador EMPS, mas a FK simples
não prova que ele pertence à estação da sessão. O importador deve verificar
`charger.station_id = station_id` antes de gravar e manter `charger_id = NULL`
enquanto o mapeamento comercial não for comprovado. O ID original do carregador
permanece no histórico.

## Pré-verificações no ambiente oficial

1. Seguir `docs/DATABASE_CHANGE_POLICY.md`: identificar base/UUID e MySQL 8.0.x,
   confirmar o estado do patch 0001 e verificar que as quatro tabelas e o
   recibo 0002 não existem. Conferir tipos de `stations.id` e `chargers.id`,
   charset, collation e nomes de constraints reais.
2. Revisar o SQL integralmente, inclusive índices e caminhos de FK, tamanho
   estimado dos datasets e espaço para a nova carga. Testar o pacote em MySQL
   8 descartável com o mesmo esquema base e conferir diff Prisma em modo leitura.
3. Registrar commit imutável, SHA-256 acima, aprovador, referência de mudança,
   revisão de compatibilidade com backend em produção e backup novo/restaurável.
   O aplicador privado exige commit em `origin/main`, checkout limpo e recibo.
4. A estrutura e o preenchimento são duas operações separadas. Uma aprovação
   do SQL não autoriza importar dados nem publicar código; nenhuma delas está
   autorizada por este documento.

## Verificações posteriores

1. Conferir `SHOW CREATE TABLE` das quatro tabelas, suas FKs e índices;
   comparar `schema.prisma` com o banco atualizado em modo leitura.
2. Conferir contagens e amostras de `charging_sessions`, `payments`,
   `payment_intents`, `charger_readings` e `station_energy_readings` antes/depois:
   o patch não deve alterar nenhuma delas.
3. Publicar código compatível somente pelo procedimento aprovado. Testar
   autorização por proprietário, estação e lote, reimportação idempotente,
   reset de lote selecionado, reconciliação de energia/valor e ausência de
   chamadas a meios de pagamento reais.

## Falha e recuperação

DDL MySQL pode aplicar parcialmente. Parar o release, inspecionar o esquema e
o recibo, e preparar **novo** patch de correção aprovado. Não repetir o mesmo
patch após um recibo de falha nem usar `db push`, `migrate reset` ou exclusão
global como atalho. Rollback de código não apaga tabelas ou dados; qualquer
reversão de estrutura/dados exige decisão específica e backup verificado.
