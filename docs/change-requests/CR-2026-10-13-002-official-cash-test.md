# CR-2026-10-13-002 - Caixa de teste conectado a API oficial

## Solicitacao e autorizacao

O usuario pediu reverter o bloqueio visual do Caixa e permitir a liberacao.
Depois esclareceu o escopo: fluxo de teste da instalacao 13, sem cobranca
externa e sem equipamento fisico. Autorizou uma liberacao de R$ 1,00 e seu
encerramento para verificacao. A ativacao temporaria por 8 horas foi aprovada.
O inicio automatizado foi bloqueado pela ferramenta; o usuario iniciou
o perfil pelo PowerShell e autenticou a aba do Codex.

Atualizacao de verificacao: o usuario iniciou o perfil e entrou na aba do
Codex. Health da ponte respondeu 200 usando MySQL oficial. A liberacao de
R$ 1,00 funcionou, gerou novo registro e mudou o carregador para ocupado.
O STOP retornou o carregador a disponivel. Foi identificada uma pendencia
indevida do encerramento na API original; correcao separada registrada em
CR-2026-10-13-003. Nao aprovar outra cobranca para contornar esse defeito.
Depois da publicacao autorizada do hotfix da CR-003, o segundo teste de
R$ 1,00 terminou como FINISHED, com exatamente um recebimento aprovado e
zero novas pendencias. O primeiro teste e sua pendencia permaneceram intactos.

## Diagnostico

O acesso MySQL deste PC e SELECT-only. O Nest local tambem bloqueia mutacoes.
Desativar o aviso na tela nao cria autorizacao de escrita. A API oficial ja
possui os endpoints de Caixa e acesso ao banco, respeitando os vinculos do
usuario com a instalacao. A inspecao sanitizada do container oficial confirmou
ausencia de OCPP_GATEWAY_URL, GIE configurado para a instalacao 13 e Stripe de
teste. As rotas de Caixa nao iniciam uma cobranca Stripe.

O acesso direto do navegador local a API oficial era rejeitado por CORS.
Nao foi alterado o CORS oficial: foi criada uma ponte local autenticada e
limitada. Ela usa HTTPS ate a API oficial e nao recebe credenciais MySQL.

## Alteracoes exatas

| Arquivo | Alteracao |
|---|---|
| `site/emps-site-main/frontend/components/chargers/ChargerVisualBoard.tsx` | Reverte somente a ultima entrega readonly: retira aviso e bloqueios visuais/handlers, restaurando formularios, botoes e chamadas originais. |
| `site/emps-site-main/frontend/styles/charger-board.css` | Retira exclusivamente os estilos do aviso readonly adicionados na entrega anterior. |
| `site/emps-site-main/frontend/services/emps-api.ts` | Retira os seis bloqueios de Caixa/comandos da entrega anterior. Preserva a flag readonly dos outros paineis e as melhorias anteriores de cache. Acrescenta opt-in para URL de mesma origem `/api/official-test` e flag para o transporte de realtime. |
| `site/emps-site-main/frontend/tests/readonly-cashier.test.cjs` | Remove os testes exclusivos do bloqueio visual rejeitado pelo usuario. |
| `site/emps-site-main/frontend/server/official-test-bridge.ts` | Nova ponte HTTP com destino HTTPS fixo, leitura em allowlist, autenticacao original, limite de corpo, protecao de origem e prazo de verificacao sandbox. Escrita somente para Caixa da instalacao 13 e carregadores 49/50/51. Identidade e proprietario do carregador conferidos na API. Encerramento/acerto apenas de sessoes criadas por esta ponte e pelo mesmo usuario, sem cliente ou payment intent externo. Nao repete POST em falhas. |
| `site/emps-site-main/frontend/app/api/official-test/[...path]/route.ts` | Expoe a ponte no Next, desativada por padrao e sem cache. Confere a disponibilidade do diario privado antes de operar; recupera e registra somente os IDs de novas sessoes, carregadores e operadores, sem tokens, senhas ou valores. |
| `site/emps-site-main/frontend/components/realtime/RealtimeProvider.tsx` | No perfil de teste, nao tenta WebSocket em um servidor Next sem esse transporte. Mantem renovacao de autenticacao e o polling ja existente; nao simula conexao ao vivo. |
| `scripts/start-official-cash-test.ps1` | Novo perfil explicito: exige confirmacao recente de sandbox, compila o site e o serve somente em loopback na porta 3010. Flags readonly dos outros paineis mantidas; demonstracao ficticia/replay desativados. Restaura o ambiente do processo ao sair. |
| `site/emps-site-main/frontend/tests/official-test-bridge.test.cjs` | Testes da ponte com fetch falso, sem chamadas de escrita ao banco: autenticacao, origem, destino, escopo, expiracao, concorrencia, cookies, historico protegido, falhas sem repeticao e papeis por instalacao. |
| `docs/change-requests/CR-2026-10-13-001-readonly-cashier.md` | Registra explicitamente a reversao. O PDF anterior permanece um registro historico. |
| `docs/README.md` | Atualiza o indice para distinguir a entrega revertida do novo fluxo. |
| Este documento | Registra escopo, alteracoes e limites para revisao do grupo. |

## Limites e efeitos

- Banco oficial, nao copia local. Escritas seguem a API oficial e suas permissoes.
- Liberacao pre-paga registra sessao, recebimento CASH_REGISTER e comando de teste.
- Valores permitidos por esta ponte: R$ 0,50 a R$ 100,00, nao dinheiro movimentado.
- Esta ponte nao cria usuarios/grants MySQL, migrations, seeds ou alteracoes
  de senha. Um backup foi gerado separadamente para o hotfix da CR-003.
- Esta CR nao modifica o Nest oficial. A correcao e o reinicio apenas da API
  oficial foram autorizados e documentados separadamente na CR-003.
  GIE oficial e aplicativo movel nao foram editados ou reiniciados.
- Sem reativar o replay isolado do GIE. A API/GIE oficiais continuam como estavam.
- Sem rotas Stripe, pagamento simulado/approve, manutencao, reset ou comandos arbitrarios.
- O acerto pos-pago rejeita sessoes pre-pagas e sessoes ja recebidas, para nao duplicar recebimentos.
- Sem alteracoes em sessoes historicas. Os IDs novos sao mantidos em memoria
  e em `frontend/tmp/official-cash-test/sessions.jsonl`, ignorado pelo Git.
- Reiniciar a ponte recupera os IDs do diario local, permitindo encerrar
  os testes criados aqui. Remover o diario bloqueia essas mutacoes; nao apaga registros oficiais.
- A verificacao sandbox expira em ate 24 horas; a ativacao proposta dura 8 horas.
  Reativar exige conferir novamente que nao existe gateway fisico configurado.
- A API original decide os estados e o encerramento. Nao se fabrica energia,
  sucesso ou finalizacao no navegador. Parar e liquidar sao operacoes distintas.
- A troca da API exige novo login oficial, nao alteracao de senha/perfil.
- Este perfil e local e temporario, nao uma publicacao de producao.

## Verificacao atual

TypeScript sem erros e build otimizado aprovados. Suite frontend completa:
187 testes aprovados, zero falhas, incluindo 20 novos testes da ponte.
Autenticacao e dois testes de R$ 1,00 executados no navegador com aprovacao.
O primeiro revelou o defeito de encerramento; o segundo validou o hotfix
da CR-003. Seus registros sao persistentes no banco oficial e estao
identificados no relatorio privado. Nao representam pagamento externo ou
medicao fisica. O perfil local anterior foi encerrado; o perfil limitado
atual foi mantido em execucao. Somente a API oficial foi reiniciada na CR-003.

## Reversao

Encerrar somente o processo local deste perfil e iniciar novamente o perfil
remoto somente leitura existente. Nao modificar dados oficiais para reverter
a conexao. Registros de teste eventualmente criados ficam auditaveis no banco,
nao devem ser excluidos automaticamente.
