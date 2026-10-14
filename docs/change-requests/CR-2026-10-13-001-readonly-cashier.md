# CR-2026-10-13-001 - Caixa coerente com acesso somente leitura

Estado: REVERTIDA em 13/10/2026 por solicitacao do usuario. Este documento e o
PDF anterior ficam como registro historico, nao como comportamento atual. Foram
retirados os bloqueios visuais/cliente desta entrega e o teste especifico. O
usuario esclareceu que deseja operar o fluxo de teste da instalacao 13 no banco
oficial, sem equipamento fisico nem cobranca externa.

## Escopo aprovado

O usuario escolheu corrigir a interface mantendo somente leitura. Nao autorizou
ativar gravacao, recebimentos ou recargas na instalacao 13. O erro observado na
tela era o bloqueio remoto de mutacoes, nao erro do valor recebido.

Esta entrega nao habilita o carregamento: impede que a interface ofereca uma
operacao que a API e o usuario MySQL atuais nao permitem.

## Arquivos alterados nesta entrega

Todos os caminhos abaixo sao relativos a `site/emps-site-main/frontend`.

| Arquivo | Alteracao |
|---|---|
| `components/chargers/ChargerVisualBoard.tsx` | Importa a politica readonly e mensagem compartilhada. Usa useId para associar botoes desativados ao aviso em portugues. Desabilita Caixa, Cobrar, Parar, Desplugar e demais comandos de escrita; mantem Detalhes e consulta Sincronizar. Impede abrir/submeter formularios de caixa readonly, inclusive estado antigo e chamadas diretas. Sincronizar faz uma consulta nova do dashboard com o ID da instalacao do carregador, atualizando somente esse carregador e sem POST ou segunda consulta redundante. Falhas preservam os dados anteriores. |
| `services/emps-api.ts` | Acrescenta mensagem e precondicao de escrita para releaseChargerManually, startPostpaidCashSession, settlePostpaidCashSession, settleSmallCash, sendChargerCommand e requestChargerStatus. Em readonly, rejeita em portugues antes de fetch e antes do ramo de demonstracao. Os endpoints POST e autenticacao fora de readonly foram preservados. |
| `styles/charger-board.css` | Estiliza apenas o aviso readonly, com cores do tema, quebra de texto e icone sem encolhimento. Mantem o estilo existente dos botoes e cards. |
| `tests/readonly-cashier.test.cjs` | Nove testes: aviso/acessibilidade, botoes em quatro estados, formulario antigo, bloqueio por handler, consulta por instalacao/atualizacao individual, falha de leitura, fluxo normal, API sem fetch, conflito readonly/demo e endpoints/autenticacao normais. |

Os quatro arquivos foram sincronizados para o clone ativo
`EMPS-Ecosystem-2026-10-07`, com hashes correspondentes. Este registro e o indice
`docs/README.md` foram adicionados/atualizados. Capturas e PDF ficam apenas nos
diretorios locais ignorados pelo Git.

## Sem alteracoes nessas areas

- Backend Nest, API de servidor, schema/migrations, registros MySQL, tarifas,
  sessoes, pagamentos, credenciais e permissoes.
- GIE, replay, modelos, aplicativos moveis, gateways, servicos da VPS e hardware.
- Rotas e comportamento normal das operacoes fora do modo readonly.
- Fonte, valores, horarios e comunicacao dos carregadores. Consultar nao confirma
  conexao fisica nova nem atualiza lastSeenAt artificialmente.

O flag publico melhora a interface; nao substitui autenticacao, autorizacao,
RemoteDevelopmentGuard ou os privilegios SELECT-only do banco.

## Testes e verificacao

- Suite frontend: 176 aprovados, zero falhas; nove testes novos usam fixtures e
  fetch mockado. Nenhuma recarga ou pagamento foi executado no banco oficial.
- `git diff --check`: sem erros; apenas avisos de finais de linha do Windows.
- Build Nest e Next otimizado concluidos no iniciador local existente. Comparacao
  de schema somente leitura: NO_PRISMA_DIFF. Site /login HTTP 200; API /auth/health
  status ok; replay continua desligado, com a porta 8013 sem servidor.
- Suite frontend tambem executada no clone ativo: 176 aprovados, zero falhas.
- Navegador autenticado na instalacao 13: tres botoes Caixa desabilitados, aviso
  associado por aria-describedby, zero formularios de caixa e sem o erro antigo
  em ingles. Sincronizar concluiu a consulta e voltou habilitado, sem comando.
- Desktop sem overflow horizontal. Viewport de celular solicitado 390x844 (largura
  interna observada de 382 px): aviso dentro da tela, texto quebrando normalmente
  e sem overflow horizontal. Viewport temporario restaurado apos o teste.
- Capturas before.jpg, after.jpg e mobile.jpg salvas em output/readonly-cashier;
  PDF em output/pdf/EMPS_CAIXA_SOMENTE_LEITURA_2026-10-13.pdf. Esses arquivos sao
  privados/ignorados. O PDF registra o antes/depois sem expor credenciais.
- O iniciador existente reinicia somente processos locais e tunel. O perfil
  READ_ONLY, jobs/comandos fisicos/efeitos financeiros desativados e replay
  desligado foram mantidos. Nenhum SQL ou deploy na VPS foi solicitado.

## Limites e reversao

O fluxo de caixa real continua bloqueado nesse ambiente. Habilita-lo exige um
projeto de acesso operacional aprovado, nao a remocao de uma condicao visual.
Reversao de codigo consiste em reverter apenas este diff e recompilar a interface;
nao ha dados a restaurar. Nao reverter outras alteracoes existentes do projeto.

Sem commit, push ou publicacao no site oficial.
