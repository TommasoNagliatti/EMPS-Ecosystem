# Politica de mudancas no banco oficial

Nota de publicacao: os helpers administrativos de aplicacao/deploy citados
abaixo pertencem ao ambiente privado auditado e nao acompanham este clone
publico. Estas secoes descrevem o procedimento de revisao; nao sao comandos
executaveis com autorizacao automatica. Use o administrador responsavel.

Base verificada na auditoria anterior: emps_db, MySQL 8.0.46, VPS Hostinger existente. A integracao GIE V3 ainda requer nova verificacao da base real. Nao criar outro
database, copiar um dump local sobre o oficial ou sincronizar tabelas inteiras.
Nenhuma alteracao de esquema foi aplicada nesta missao.

## Separar tres operacoes

- Codigo: commit, revisao, merge e rebuild dos servicos de aplicacao.
- Estrutura: SQL explicito revisado, backup, aplicacao e validacao.
- Dados: operacao especifica autorizada, criterios/limites, auditoria e idempotencia.

Git push/pull nao transporta registros. Rollback do codigo nao desfaz estrutura
ou dados. O usuario SQL de desenvolvimento tem SELECT e nao aplica patches.

## Comparacao do esquema

O preflight compara a base real com backend/prisma/schema.prisma usando Prisma
migrate diff em modo leitura. Resultado observado: NO_PRISMA_DIFF. Isso nao
comprova todos os CHECKs, triggers, events, grants, stored procedures ou efeitos
de uma alteracao futura. Conferir o MySQL real para a estrutura afetada.

O bloqueio de npm run prisma:migrate continua intacto. Nao executar db push,
migrate reset, seeds ou bootstrap:admin no oficial como atalho. Nao remover o
bloqueio sem revisar por que o repositorio o possui.

## Pacote de alteracao

Usar site/emps-site-main/database/patches/NNNN-nome.sql e NNNN-nome.md. O pacote
documenta motivacao, SHA256, commit, pre/post-checks, relacoes, registros antigos,
custo/bloqueios, compatibilidade com os containers atuais e plano de correcao.
Nao escrever um patch ficticio so para preencher o diretorio.

Priorizar expansao compativel: novas tabelas, campos inicialmente opcionais e
indices avaliados. Campo obrigatorio e restricao nova precisam de verificacao
dos dados antigos e, quando necessario, preenchimento controlado aprovado.
ADD COLUMN/INDEX pode bloquear a tabela ou tornar a versao antiga incompativel.

Revisar SQL integralmente, inclusive comentarios executaveis MySQL. Um checksum
comprova identidade dos bytes, nao seguranca do conteudo. Nao incluir credenciais
em SQL, notas de revisao ou argumentos de comandos.

## Aplicacao explicita e recibo

Foi preparado scripts/apply-approved-sql.py; ainda nao instalado nem executado
para escrever na VPS. Nao e um parser de seguranca SQL. A aprovacao humana deve
confirmar que o arquivo inteiro e aditivo/compativel e suas verificacoes passaram.

O administrador faz fetch do commit revisado, sem mudar o checkout, testa as
precondicoes do pacote e gera backup novo pelo script existente. O aplicador le
o SQL direto do objeto Git do commit aprovado, portanto nao precisa atualizar
a aplicacao antes da mudanca estrutural.

Exemplo de planejamento, sem aplicar SQL, depois de substituir marcadores:

```bash
python3 /CAMINHO/REVISADO/apply-approved-sql.py --patch NNNN-nome.sql --approved-sha256 HASH_SHA256 --approved-commit SHA_COMPLETO_APROVADO
```

Depois da aprovacao concreta de SQL, impacto e recuperacao:

```bash
python3 /CAMINHO/REVISADO/apply-approved-sql.py --patch NNNN-nome.sql --approved-sha256 HASH_SHA256 --approved-commit SHA_COMPLETO_APROVADO --approved-by RESPONSAVEL --approval-reference CR_REFERENCIA --backup-directory /opt/emps/backups/emps-backup-TIMESTAMP --compatibility-reviewed --apply
```

Os marcadores nao sao comandos prontos desta entrega. Nao ha patch SQL ou
autorizacao de aplicacao pendente de execucao para a configuracao remota.

O script exige:

- Root no console da VPS auditada e repositorio /opt/emps/EMPS-Ecosystem.
- Nome numerado sem caminhos, SQL nao vazio, UTF-8 e hash exatamente aprovado.
- Commit completo integrado a origin/main, checkout limpo e pacote presente no Git.
- Backup root-owned, sem escrita para outros usuarios, gzip valido e ate 1 hora.
- Nome emps_db, UUID fixado e MySQL 8.0.x antes de executar qualquer SQL do patch.
- Identificacao do aprovador, referencia e declaracao de revisao de compatibilidade.
- Lock compartilhado com deploy e ausencia de recibo anterior para o mesmo patch.

O recibo privado fica em /opt/emps/backups/schema-patches/NNNN-nome.json, com
commit, checksum, aprovador, referencia, backup, UTC e resultado. A saida MySQL
fica num log privado 0600, nao na conversa. Um recibo existente, inclusive FAILED
ou EXECUTING, bloqueia nova execucao. Nao apagar o recibo para tentar novamente.
O mesmo numero ou os mesmos bytes SQL com outro nome/numero tambem sao recusados.

Aprovador/referencia sao registros declarados pelo administrador, nao uma
assinatura criptografica dos membros. A aprovacao real do grupo deve existir
antes da operacao e ficar associada a essa referencia. O script nao a concede.

MySQL DDL faz commit implicito. Falha/interrupcao pode deixar parte do patch
aplicada; o processo nao oferece uma transacao atomica para todo o arquivo.
Revisar o estado e criar uma correcao nova, explicitamente aprovada. O recibo
APPLIED_REQUIRES_FUNCTIONAL_VALIDATION significa apenas comando concluido, nao
validacao funcional concluida. Registrar os post-checks do pacote separadamente.

## Sequencia de release

1. Revisar modelo real, SQL e codigo; registrar aprovacao e commit imutavel.
2. Backup e verificacoes anteriores; aplicar somente SQL aprovado.
3. Validar dados antigos, campos/indices e compatibilidade com backend atual.
4. Comparar o schema Prisma da versao nova com o banco atualizado.
5. Publicar codigo compativel pelo procedimento de deploy aprovado.
6. Conferir operacao e registrar resultado; preencher dados em etapa separada.

O update existente/variante preparada ainda bloqueia diffs em Prisma/database.
Um release estrutural exige adaptar esse gate mediante revisao especifica,
usando recibos e a comparacao do schema alvo; esta entrega nao remove esse
bloqueio. Nunca usar --allow-db-risk como substituto da sequencia acima.

## Estado atual e proibicoes

Patches aplicados nessa entrega anterior: zero. O PR de integracao GIE V3 propoe
`site/emps-site-main/database/patches/0001-gie-v3-multistation.sql`; ele nao foi
aprovado nem aplicado. SQL operacional de testes: zero. Alteracoes de permissoes:
novo usuario SELECT conforme autorizacao, sem mudar os usuarios existentes.
Na auditoria anterior, nao foram alteradas tabelas, dados historicos, senhas de
usuarios do produto ou schema.prisma. O backup permaneceu na VPS naquela data;
a sua existencia e restaurabilidade atuais ainda precisam ser conferidas.

Nao usar DROP, TRUNCATE, down -v, volume rm, reset, db push --accept-data-loss,
dump local por cima do oficial, reprocessamento de pagamentos ou exclusao de
sessoes como parte do desenvolvimento cotidiano.
