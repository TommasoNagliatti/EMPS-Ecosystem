# Homologacao e release compativel

## Base e alcance

Repositorio alvo: TommasoNagliatti/EMPS-Ecosystem. Base revisada:
`3fc3bc58fb27b48c21fc69a2ce44049365ddf7b1`.
Branch proposta: `codex/compatibilidade-site-gie-2026-10-13`.

Esta entrega conserva o historico desse repositorio, importa as melhorias
publicadas separadamente por Matheus e corrige os conflitos da auditoria.
Nao substitui o GIE do autor, nao modifica schema/SQL/seed e nao configura
acesso a contas, equipamentos, gateway ou MySQL oficial.

## Regra original por padrao

Sem `PREPAID_LIFECYCLE_STATION_IDS`, novas sessoes seguem a regra original.
O START nao manda `energyLimitKwh` nem exige `/capabilities`. O faturamento
V1 conserva carencia de 15 minutos, R$ 0,25 por minuto e o teto original.
O hotfix de encerramento de Caixa pre-pago confirmado permanece preservado.

Configuracao ausente/vazia significa desativado. A lista so aceita IDs
positivos MySQL validos, separados por virgula; `*`, valores invalidos e
ativacao global implicita sao rejeitados ao iniciar o backend.

## Nova regra, somente apos aprovacao

Configurar IDs da homologacao em `PREPAID_LIFECYCLE_STATION_IDS` nao basta:
os jobs de orcamento precisam estar ativos, a instalacao precisa estar no
escopo operacional permitido e o valor precisa cobrir a margem segura de STOP.

O backend anuncia `chargePolicyVersion: PREPAID_LIMIT_V2` para essa instalacao.
O site e o app devolvem essa versao no START. Clientes antigos, ou um checkout
aberto antes da mudanca de regra, recebem conflito e precisam atualizar os
termos/autorizacao. A autorizacao financeira existente nao e cancelada so por
esse erro; conferir/cancelar a autorizacao antes de repetir o checkout.

Depois da parada confirmada, o consumo e fechado sem cobrar acima do limite,
o saldo fica discriminado, e o conector continua ocupado ate retirada.
Os 10 minutos partem do STOP confirmado pelo servidor/gateway, nao do clique,
pagamento ou recarregamento da pagina. A permanencia e medida separadamente,
mas **nao recebe preco novo inventado**: a tarifa monetaria ainda esta pendente.

Nao alterar retroativamente snapshots, recibos ou regras de sessoes antigas.
Registros com `chargeLifecycle` continuam reconhecidos apos desativar a lista.

## Gateway fisico e GIE

O contrato original do gateway continua suficiente para o fluxo original:
`POST /commands`, com START/STOP/STATUS/RESET/UNLOCK e identidades existentes.
Nao enviar limites extras a um gateway que nao foi homologado para isso.

Para V2 fisico, homologar `GET /capabilities` autenticado com
`hardEnergyLimit: true`, aplicacao efetiva de `energyLimitKwh` no equipamento,
e callbacks autenticados de inicio, medicao, parada e desconexao. Uma resposta
HTTP de comando aceito nao equivale a energia iniciada/parada ou conector retirado.
Os testes locais usam adaptadores falsos; nao comprovam esse controle no hardware.

Uma sessao com inicio fisico registrado exige retirada pelo gateway mesmo
se sua configuracao local for removida depois. Site/app nao mostram uma
confirmacao manual capaz de burlar essa condicao.

O servico HTTP, modelos, controlador e motor Python do GIE original nao foram
substituidos. Ajuste limitado no leitor Nest permite amostrar Caixa V2 sem
tariffVersion V1, preservando a protecao de sessoes historicas anteriores.
O helper de replay isolado anterior continua como fonte/teste opcional; esta
entrega nao o inicia, nao o promove a telemetria real e nao grava seu replay.

## Sequencia para o responsavel pelo deploy

1. Conferir base/commit/manifesto e o hotfix atualmente instalado na VPS.
2. Revisar e aprovar o diff no GitHub. Nao fazer merge automatico.
3. Conferir webhooks e regras de deploy na Hostinger/GitHub; o workflow deste
   repositorio executa testes, nao deploy. Hooks externos nao foram validados.
4. Criar e validar backup de producao, com procedimento de restauracao testado.
5. Homologar em banco e gateways de teste separados: Caixa, App, Web Charge,
   reservas, RFID, telemetria, permissoes e pagamentos, inclusive reconexao.
6. Executar os oito testes MySQL opt-in somente em banco descartavel preparado.
   Eles ficaram desativados nesta entrega para preservar o banco oficial.
7. Resolver/revisar alertas restantes de dependencias antes de producao.
8. Preparar configuracoes privadas, CORS, URLs do site/app/API e segredos do
   ambiente, sem copiar arquivos de outro computador nem publicar credenciais.
9. Publicar backend e clientes revisados com V2 novo desativado, manter jobs
   necessarios aos registros V2 existentes, validar rotas antigas e leitura.
10. Ativar V2 apenas no escopo aprovado, depois de homologar clientes e gateway.
    Monitorar pagamento, retirada, ocupacao, limites e saldo separadamente.

Git push nao transporta os registros MySQL. O deploy nao deve executar reset,
db push, migracao automatica, seed, importacao de dump ou bootstrap de contas.
Esta branch nao acrescenta esses comandos aos scripts de inicializacao.

## Retorno de versao

Desativar `PREPAID_LIFECYCLE_STATION_IDS` impede novas admissoes V2, mas nao
transforma sessoes V2 existentes em legadas nem libera seus conectores.
Manter os leitores e handlers compativeis ate encerrar/conciliar essas sessoes.
O commit original `3fc3bc5` sozinho nao interpreta o JSON V2 sem ledger V1.
Portanto, voltar diretamente para ele depois de iniciar V2 nao e rollback seguro.

Nao remover callbacks/jobs com sessoes fisicas em curso. Um rollback operacional
exige verificar a ocupacao real, eventos pendentes, estados financeiros e backups.
Nao apagar sessoes ou reprocessar recebimentos como tentativa de corrigir estado.

## Limites da comprovacao

Builds, testes de contrato e hashes demonstram compatibilidade dos caminhos
verificados, nao ausencia absoluta de conflitos ou homologacao de producao.
Nao foi feito deploy, acesso SSH, SQL operacional, cobranca externa, comando
fisico, teste nativo no iPhone ou teste de pagamentos reais nesta etapa.
