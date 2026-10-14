# CR-2026-10-13-003 - Encerramento do Caixa pre-pago ja recebido

Estado: publicada na API oficial em 13/10/2026, apos autorizacao explicita,
conferencia de versao e backup. Segundo teste autorizado de R$ 1,00 aprovado
no navegador: sessao FINISHED, um recebimento aprovado, nenhuma nova pendencia.
Nao houve autorizacao nem alteracao corretiva em registros anteriores.

## Problema observado

O teste autorizado do Caixa criou uma sessao e um recebimento aprovado de
R$ 1,00 no banco oficial. O carregador passou a ocupado. Ao parar a recarga,
ele voltou a disponivel, mas a API original criou outra pendencia para a
mesma sessao e deixou seu estado em WAITING_PAYMENT. Nenhum recebimento
adicional foi aprovado. Os identificadores e capturas ficam no relatorio local
privado, nao no repositorio publico.

O fluxo legado de sendCommand sempre deixava sessoes sem RFID em
WAITING_PAYMENT e criava admin-settle, sem verificar o recebimento pre-pago
cash-settle que o mesmo backend ja registrava no inicio.

## Alteracao exata do codigo

Arquivo: `site/emps-site-main/backend/src/admin-operations.service.ts`.
Somente o ramo de STOP aceito em sandbox, sem tariffVersion, foi alterado.
Diff: 25 linhas acrescentadas, 2 substituidas.

- Identifica exclusivamente PREPAID, ADMIN_SITE, preferencia CASH,
  cliente avulso, sem payment intent externo e sem RFID.
- Dentro da transacao existente, consulta o recebimento por
  `cash-settle-{sessionId}`.
- Exige que o recebimento corresponda a mesma sessao, esteja APPROVED,
  seja CASH/CASH_REGISTER, tenha paidAt e cubra o total calculado.
- Quando confirmado e suficiente, grava FINISHED e nao executa a criacao
  de outra pendencia. Nao cria, altera, estorna ou reaprova o recebimento original.
- Sem essas evidencias, preserva a condicao WAITING_PAYMENT e o caminho
  original de pagamento pendente.
- O caminho de gateway fisico continua STOPPING aguardando confirmacao.
- Nao altera o calculo de energia, a tarifa, o limite pre-pago, o troco,
  o saldo remanescente ou politicas de devolucao.
- Nao altera o ramo de tarifa V1, RFID, pos-pago, pagamento mobile ou Stripe.

Este comportamento afeta sessoes que preencham essas condicoes, nao e um
override de interface nem um ajuste manual de status no banco.

## Testes

Novo arquivo: `site/emps-site-main/backend/tests/cash-prepaid-stop.test.ts`.
17 testes novos com banco/gateway falsos e sem conexao ao MySQL oficial:
recebimento suficiente, ausencia, insuficiencia, estados nao aprovados,
sessao diferente, provedor/metodo diferente, papel do pos-pago e mobile,
gateway fisico aguardando confirmacao, falha/rejeicao e preservacao de RFID.
O teste principal tambem confere que repetir STOP nao envia outro comando.

Suite backend completa: 104 testes, 96 aprovados, 8 testes MySQL explicitamente
ignorados, zero falhas. Build Nest aprovado. Os 187 testes frontend da ponte
e das entregas anteriores permanecem como verificacao separada.

## Publicacao autorizada

- Fonte da VPS conferida antes: blob `fc976b5ecc88263761cd9fe08837711481541ec2`,
  identico ao arquivo original local; checkout remoto limpo.
- Patch produzido somente deste arquivo, hash SHA-256 conferido antes de aplicar.
- `git apply --check` aprovado; fonte apos aplicar:
  `856863d7be187dfa3656a5a85e25e5f71fb9d698`.
- Backup novo do banco e da configuracao gerado na VPS. Gzip validado,
  arquivos nao vazios, permissao 600, diretorio protegido. Nao houve teste
  de restauracao contra o banco oficial.
- Fonte original e imagem anterior preservadas para reversao de codigo.
- Somente a imagem e o container da API foram recriados. A inspecao apos
  publicacao confirmou que frontend oficial, MySQL, Caddy e GIE mantiveram
  os mesmos IDs de container e horarios de inicio; todos em execucao.
- Recompilacao pelo Dockerfile.backend existente, Node 24 e package-lock
  existentes. Nenhum Dockerfile ou arquivo de dependencias foi alterado.
- Sem migrations, seeds, novos grants, alteracao de senha, DELETE ou
  manipulacao manual de pagamentos/sessoes anteriores.
- Sem commit/push: esta publicacao nao atualiza automaticamente o GitHub.

## Verificacao final e limites

O usuario autorizou um segundo teste de R$ 1,00 para confirmar a correcao
apos a publicacao, mantendo o primeiro teste e sua pendencia intocados.
Build da imagem concluido. Codigo compilado do hotfix conferido em container
efemero sem rede, somente leitura e sem iniciar a aplicacao. Somente a API
foi recriada; health HTTPS respondeu 200 com banco MySQL. Gateway fisico
continua ausente. Checkout remoto tem somente o arquivo de servico modificado.

No navegador autenticado, foi enviada uma unica liberacao e um unico STOP.
O carregador passou de disponivel para ocupado e voltou a disponivel.
A nova sessao apareceu como Finalizada. A pesquisa por seu ID mostrou
exatamente um recebimento Caixa aprovado de R$ 1,00 e zero pendencias.
Capturas, identificadores, hashes, imagem de rollback e caminho do backup
estao no relatorio privado local, ignorado pelo Git.

O perfil local continua temporario, com a validade de 8 horas autorizada.
Nao foi concedido acesso geral de escrita, alterado CORS ou modificado
o usuario MySQL somente leitura. Nenhum valor foi movimentado externamente.

A correcao nao resolve retroativamente registros ja encerrados como
WAITING_PAYMENT. Qualquer conciliacao desses registros exige aprovacao
separada e analise do recebimento, nao a aprovacao automatica de uma segunda
cobranca. O uso neste PC continua um teste sem equipamento fisico nem PSP.

## Reversao

Se a API falhar, restaurar somente a imagem anterior e o arquivo preservado,
recriando apenas o backend. Nao restaurar o banco inteiro para reverter codigo,
pois isso apagaria registros legitimos criados depois do backup. Incorporar
o hotfix ao fluxo de revisao do grupo antes de uma proxima atualizacao do GitHub.
