# 0012 — expansão estrutural para a release oficial

Estado: **proposta revisável, não aplicada no MySQL oficial**.

SQL: `0012-official-demo-runtime-schema.sql`.
SHA256 dos bytes UTF-8/LF: `5b0b847858013d989dc2bf3c4c0d75b1b97c9797144471dae0fa3a02440a29bb`.
O commit imutável deve ser o commit que contém este pacote, registrado na revisão e no recibo antes da aplicação.

## Origem e impacto

Diff somente leitura do MySQL 8.0.46 `emps_db` auditado na VPS em 24/10/2026,
comparado ao Prisma da versão `4ea2d5d`. Conferência adicional das 21 restrições
CHECK da prévia; o diff Prisma sozinho não as representa.

- Cria 14 tabelas novas: `gie_station_bindings`, quatro tabelas de dispositivo/RFID,
  quatro tabelas de recarga `lab_charge*` e cinco tabelas `demo_*`.
  Contagem exata: 1 vínculo GIE + 4 dispositivo/RFID + 4 recarga + 5 histórico = 14.
- Acrescenta a `alerts`: `acknowledged_at`, `gie_alert_id`, `gie_generation`,
  `gie_last_revision` (default zero) e `gie_payload`; índice único no identificador GIE.
- Novas FKs preservam estações e carregadores com RESTRICT e isolam lote/estação.
- CHECKs mantêm pagamentos SANDBOX/teste, estimativas de energia, regras de caixa,
  sujeitos autenticados/visitantes e uso próprio residencial sem receita.
- Não contém preenchimento de dados, usuários, senhas, grants, pagamentos externos,
  comandos físicos, DROP, TRUNCATE ou alterações de tabelas financeiras operacionais.

O backend atual não consulta essas tabelas/campos; a expansão conserva seus campos
e registros. A release nova ainda exige configuração explícita e uma operação de
dados separadamente revisada. Os scripts antigos marcados local-only permanecem
proibidos no banco oficial. Não ativar a exceção de cópia local em produção.

## Precondições da aplicação oficial

1. Revisar integralmente SQL e código, integrar o commit aprovado em `origin/main`.
2. Registrar aprovação específica do pacote e de sua compatibilidade.
3. Backup novo, privado e verificado com menos de uma hora; manter a restauração testada.
4. Confirmar MySQL 8.0.x, database `emps_db`, UUID `2baa7d1d-c101-11f1-9255-0e27fb6e351d`.
5. Confirmar que os 14 nomes de tabela, cinco colunas e índice novo ainda não existem.
6. Repetir diff, contagens, hashes dos registros antigos e auditoria de sessões abertas.
   O backup testado tinha 15 usuários, 8 estações, 13 carregadores, 77 sessões,
   77 pagamentos e 53 payment intents. Esses números são evidência, não condição
   para impedir usuários legítimos de trabalhar até a janela de aplicação.
7. Resolver a pendência de checkout oficial com hotfix preservado mediante o
   procedimento administrativo revisado; não apagar/stash/reset para burlar o gate.
8. Seguir `docs/DATABASE_CHANGE_POLICY.md`, com recibo, checksum e lock de release.

## Testes já executados

Backup completo permaneceu na VPS em diretório privado. Gzip foi lido e a
restauração terminou em MySQL separado, rede Docker interna, sem portas publicadas.
O banco original e a prévia não foram modificados por estes testes.

Primeira restauração: diff estrutural aplicado, hashes iguais das linhas das
29 tabelas originais não alteradas estruturalmente. `alerts` ganha colunas e
por isso não usa comparação de dump com número de campos diferente.

Segunda restauração: pacote completo com hash acima aplicado de uma vez.
Hashes integrais de usuários, estações, carregadores, sessões, pagamentos e
payment intents permaneceram iguais; contagens 15/8/13/77/77/53.
Todas as 21 CHECKs conferidas; tentativa de pagamento demonstrativo negativo
rejeitada pelo MySQL (3819), sem registro inserido.

Evidências privadas: `full-patch-validation.json`, `schema-validation.json`,
backup e manifesto na pasta `official-20261024/private` da VPS.

## Custo, pós-verificação e recuperação

As tabelas novas começam vazias; FKs e índices são construídos antes da importação.
A alteração de `alerts`/índice pode aguardar metadata lock e bloquear escrita
durante DDL; medir tamanho e transações antes da janela. Não prometer downtime zero.

Após aplicar: comparar Prisma, CHECKs, FKs, linhas antigas e status dos serviços;
registrar recibo e validação funcional autenticada. Imports e mudanças de vínculos
necessitam pacote próprio e aprovação antes de escrever registros oficiais.

MySQL DDL tem commit implícito. Em falha parcial, preservar o recibo/log e inspecionar;
criar correção revisada. Não repetir o arquivo automaticamente. Voltar o código
mantém as tabelas aditivas; não remover histórico nem restaurar dump sobre uma base
que recebeu novos registros. Restauração é procedimento de incidente separado.
