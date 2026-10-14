# Patches SQL aprovados

Nenhum patch SQL foi criado ou aplicado na configuracao remota de 10/10/2026.
Este diretorio registra mudancas futuras, nao dumps de dados ou credenciais.

Cada pacote deve conter `NNNN-nome.sql` e `NNNN-nome.md`, com:

- Objetivo, SHA256 dos bytes do SQL e commit exato revisado.
- Estruturas afetadas, verificacoes antes/depois e compatibilidade com o backend publicado.
- Custo de indices, bloqueios de DDL, registros antigos e integridade referencial.
- Backup necessario, aprovadores e plano de correcao caso a aplicacao seja parcial.
- Eventual preenchimento de dados em operacao separada e expressamente aprovada.

Priorizar CREATE TABLE e ADD COLUMN/INDEX compativeis. Novas restricoes e campos
obrigatorios exigem etapas de expansao, preenchimento controlado e validacao.
Um arquivo nao e seguro apenas porque usa ADD: o SQL inteiro precisa de revisao.

O procedimento esta na politica de banco da documentacao da raiz. O helper
administrativo de aplicacao pertence ao ambiente privado auditado, nao a este
clone publico. Verifica checksum, commit, backup, identidade do MySQL e recibo
exclusivo; nao e um analisador automatico de seguranca do SQL.
O acesso SSH de leitura do desenvolvedor nao pode aplicar esses patches.
