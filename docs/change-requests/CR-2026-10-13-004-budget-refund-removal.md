# CR-2026-10-13-004 - Limite, devolucao e retirada do conector

Estado: implementacao local compilada e testada, nao publicada na VPS.
Nao houve escrita no banco oficial, movimentacao de dinheiro, reinicio
oficial, commit ou push nesta entrega. A ponte oficial em execucao permanece
com a permissao anterior; seus novos endpoints de devolucao/retirada continuam
bloqueados. Publicacao e ampliacao desse acesso precisam de aprovacao separada.

## Regra solicitada

- O valor autorizado e um teto, nao uma obrigacao de consumir tudo.
- O monitor do servidor solicita STOP antecipado. Novos pre-pagos reservam
  40 segundos de potencia maxima/tarifa maxima, mais margem de centavos.
- A admissao exige monitor ativo e instalacao permitida pela configuracao
  operacional; nao inicia uma recarga que o monitor nao poderia acompanhar.
- Exemplo validado em testes: R$ 10,00 recebidos, R$ 8,89 consumidos,
  R$ 1,11 de devolucao pendente. Nao ha um segundo recebimento de energia.
- O periodo gratuito e de 600 segundos, contados da parada confirmada.
  Nao comeca no clique, pagamento ou simples aceite do comando STOP.
- Energia encerrada e conector retirado sao estados independentes.
  A vaga fica FINISHING/ocupada ate a retirada confirmada.
- A permanencia excedente acumula tempo separado. Seu valor monetario e
  null/NOT_CONFIGURED: nenhuma tarifa, teto, arredondamento de minutos ou
  nova cobranca de permanencia foi inventada.
- No Caixa, dinheiro precisa ser devolvido pelo operador. O sistema calcula
  o saldo e audita a confirmacao; nao fabrica um estorno em dinheiro.
- A reserva digital utiliza o fechamento existente do provedor, limitado
  ao consumo autorizado. Pix externo continua PENDING_PROVIDER; nao foi
  criado um adaptador de transferencia/estorno para um PSP nao definido.

## Persistencia e compatibilidade

Novas sessoes limitadas recebem chargeLifecycle.version=PREPAID_LIMIT_V2
no billingSnapshot JSON existente. Datas, consumo e devolucao confirmada
persistem com a sessao. A contagem nao depende de um setTimeout do navegador
nem reinicia com recarga da pagina. Nenhum schema ou migration foi alterado.

As sessoes sem essa versao preservam o comportamento historico: V1 continua
com sua regra original de 15 minutos e taxa original. Nao se recalculam
recebimentos, sessoes abertas antigas ou os testes oficiais anteriores.
A CR-003 de encerramento pre-pago recebido permanece preservada.

O medidor real nao e truncado para esconder extrapolacao. Se ocorrer custo
acima do limite, rawEnergyAmount/absorbedOverrunAmount registram o excedente;
o valor cobrado permanece limitado. Nao vira divida adicional do motorista.
Essa protecao financeira nao substitui o corte fisico local do equipamento.

## Inventario exato - backend

Caminhos relativos a site/emps-site-main/backend.

| Arquivo | Alteracao |
|---|---|
| src/charge-lifecycle.ts (novo) | Politica versionada, prazo de 600 segundos, consumo versus limite, devolucao pendente/confirmada, timestamps, contador separado e protecao contra nova admissao com conector ocupado. |
| src/charge-lifecycle.service.ts (novo) | Transacoes de retirada e devolucao, auditoria por operador, validacao do recebimento e eventos autenticados do gateway. Idempotencia por estado/medidor/horario. |
| src/charge-lifecycle.controller.ts (novo) | POST de retirada e devolucao com JWT, papel e escopo por instalacao. Callback de dispositivo exige token OCPP existente. DTOs validam evento, horario, medidor e valor. |
| src/app.module.ts | Registra os novos controllers e service. |
| src/prepaid-domain.ts | Margem conservadora de 40 segundos e verificacao do valor minimo/potencia para novas sessoes. |
| src/prepaid-budget.service.ts | Inclui novo Caixa pre-pago, antes excluido por nao ter paymentIntentId. Mantem o fluxo mobile e trava de execucao. STOP do Caixa exige o ID observado, para nao atingir uma sessao substituta. |
| src/admin-operations.service.ts | Marca novas sessoes; valida orcamento/capacidade do gateway; transmite limite kWh; serializa STOP; fecha consumo/devolucao; preserva FINISHING; impede unlock enquanto a nova sessao carrega; protege admissao de vaga ocupada. |
| src/mobile.service.ts | Aplica a politica a novas sessoes com reserva; envia limite kWh; fecha energia e acerto existente antes da retirada; expoe lifecycle. Nao altera a UI nativa do aplicativo. |
| src/charging-gateway.service.ts | Preflight /capabilities para hardEnergyLimit e novo campo energyLimitKwh em START. Nao envia START pre-pago a gateway que nao declare essa protecao. |
| src/tariff-engine.ts | Leitura do JSON novo, modo separado de permanencia sem tarifa, carencia de 10 minutos somente para a nova politica e teto financeiro. Mantem paridade V1 legada. |
| src/session-billing.service.ts | Cotacao inclui lifecycle; retirada pode ocorrer depois do pagamento de energia. Congelamento da energia nao equivale a desconexao. |
| src/persistence.ts | presentAdminSession inclui lifecycle calculado a partir dos dados persistidos. |
| src/operations.controller.ts | Pagamentos incluem apenas dados de devolucao efetivamente confirmada. Nao modifica rotas de aprovacao ou simulacao. |
| src/dashboard.controller.ts | Seleciona JSON necessario a devolucao e fornece campos financeiros. Nao transmite o snapshot inteiro nem a idempotency key no painel consolidado; mantem quatro consultas. |
| src/dashboard-summary.ts | Devolve caixa recebido menos devolucoes confirmadas no dia/mes em que ocorreram; recibo bruto nao e reescrito. |
| tests/charge-lifecycle.test.ts (novo) | 21 testes de regra, valores, concorrencia, identidade, callbacks, retirada, saldo, fluxo financeiro, monitor/escopo e gateway sem protecao. |

## Inventario exato - frontend

Caminhos relativos a site/emps-site-main/frontend.

| Arquivo | Alteracao |
|---|---|
| domain/charge-lifecycle.ts (novo) | Contrato dos dados e contador baseado no horario retornado pelo servidor, sem reiniciar a tolerancia. |
| components/chargers/ChargeLifecyclePanel.tsx (novo) | Lista de retirada/devolucao; contador, consumo, saldo, tarifa pendente e confirmacoes explicitas. Erros nao repetem a operacao automaticamente. |
| components/chargers/ChargerVisualBoard.tsx | Usa a consulta de sessoes existente, exibe o painel por carregador e deixa de oferecer outro STOP para energia ja encerrada. |
| services/emps-api.ts | Dois POSTs tipados e leitura atual de sessoes. Confirmacoes bloqueadas em readonly e na ponte oficial anterior. |
| styles/charger-board.css | Layout compacto, responsivo, sem secoes em cards aninhados; botoes com icones e estado disabled. |
| domain/emps.ts | Campos financeiros opcionais de devolucao. |
| services/emps-mappers.ts | Le apenas valores/datas de devolucao enviados pelo backend; dado ausente nao e dinheiro estornado. |
| domain/station-insights.ts | Desconta devolucao confirmada no dia correto, inclusive pagamento de um dia anterior. Dados invalidos ficam indisponiveis. |
| tests/charge-lifecycle.test.cjs (novo) | 3 testes de contador, retirada e protecao das novas mutacoes. |
| tests/station-insights.test.cjs | 1 teste novo de devolucao parcial e dia contabil. |

docs/README.md inclui esta CR. PDF e capturas ficam no output privado.
Harness de QA em frontend/tmp/charge-policy-qa e somente teste descartavel,
com API em memoria, sem contas reais e sem banco. Nao e um modo do produto.
O servidor temporario de QA foi encerrado; o site anterior permaneceu aberto.

## Contrato preparado para o gateway

- GET /capabilities deve declarar hardEnergyLimit=true. Em qualquer ausencia,
  falha ou resposta negativa, nao admitir o novo pre-pago fisico.
- START em /commands recebe energyLimitKwh, calculado no servidor e
  arredondado para baixo com a tarifa maxima aplicavel.
- POST /device/v1/charging-sessions/:id/events recebe chargerId,
  ocppIdentity, occurredAt com fuso e evento start_confirmed, stop_confirmed
  ou connector_removed. Inicio/parada exigem medidor cumulativo.
- Header x-ocpp-gateway-token deve corresponder ao token configurado.
  Eventos devem ser enviados em conexao segura. O callback prende o evento
  a sessao, conector, comando aceito, horario e medidor, rejeitando replay divergente.
- Aceite de START/STOP nao inventa potencia medida, encerramento ou retirada.
  Falha de STOP mantem a recarga pendente de parada, nao anuncia sucesso.
- O gateway/equipamento ainda precisa implementar e homologar esse contrato.
  Nenhum equipamento real estava conectado para testar esses limites fisicos.

## Verificacao e limites de evidencias

- Backend: build Nest aprovado; 125 testes, 117 aprovados, zero falhas e
  8 testes MySQL deliberadamente ignorados. Nao executar fixtures no banco oficial.
- Frontend: build Next otimizado aprovado; 191 testes aprovados, zero falhas.
- QA browser: componente real, API em memoria, desktop 1280x720 e mobile
  390x844. Confirmacao de saldo e retirada verificadas; console sem erros.
- Isso nao e um teste end-to-end novo na API/banco oficiais. Essa etapa depende
  de aprovacao de publicacao, backup, revisao do grupo e acesso de teste limitado.
- Nao foram alterados GIE, banco/schema, usuarios, senhas, grants, CORS,
  infraestrutura Hostinger, configuracao de pagamentos ou arquivos nativos do app.
- Sem tarifa monetaria de permanencia. Sem enviar estorno, captura ou qualquer
  transacao a provedor externo durante testes. Sem apagar dados historicos.

## Publicacao futura

Revisar a CR e o PDF; confirmar gateway/capacidades e configuracao de jobs;
gerar backup e conferir versao antes de publicar backend e frontend.
Nao iniciar um backend local de escrita com as credenciais somente leitura.
Nao aumentar a allowlist da ponte anterior automaticamente. Homologar primeiro
em ambiente de testes separado, com permissoes e devolucoes explicitamente
aprovadas. A nova regra vale para sessoes novas apos a ativacao.
