# CR-2026-10-13-005 - Codigo e relatorio para revisao no GitHub

Pedido: enviar o relatorio complementar e todas as alteracoes de codigo
pendentes ao repositorio matheus00M7/ecossistema-emps-fiap-test.

## Escopo

- Base: ccef3c9327cb6915b8af4bbf103c53a4b73a4de6.
- Branch de revisao: codex/atualizacoes-e-relatorio-2026-10-13.
- Codigo posterior a consolidacao de 12/10: navegacao/cache, dashboard e
  financeiro, retirada dos exemplos/replay, ponte de Caixa limitada, hotfix
  pre-pago e politica local de limite/devolucao/retirada.
- Registros individuais de alteracao e proposta de integracao preservados.
- Relatorio complementar publico em
  pdf/EMPS_RELATORIO_COMPLEMENTAR_PUBLICO_2026-10-13.pdf.

O PDF descreve o estado historico anterior ao envio. A nova publicacao do
codigo para revisao nao altera o estado de deploy registrado nele.

## Privacidade e estrutura

Foi usada uma copia limpa de publicacao, com as fontes pendentes copiadas
explicitamente. A instancia local em execucao e o working tree original
foram preservados. Nao foram enviados .env, chaves, tokens, diarios de
sessoes, logs, dumps, backups, fotos operacionais, builds ou dependencias.

O relatorio completo com capturas do banco oficial continua privado.
Esta edicao publica omite essas capturas e os identificadores dos dois
testes/recibos e caminhos de backup; conserva imagens sinteticas do QA.
O scanner de publicacao nao substitui auditoria de seguranca.

## Mudancas documentais desta publicacao

- README.md: atualiza o corte para 13/10 e os estados de ativacao.
- docs/README.md: acrescenta esta publicacao e o PDF publico.
- Este registro e o PDF publico sao novos.
- O manifesto de 12/10 permanece historico, sem regeneracao.

## Limites operacionais

Este envio nao e um deploy: nao reinicia a VPS, nao executa SQL/migrations,
nao amplia grants, nao reativa GIE e nao envia comandos ou pagamentos.
A nova politica PREPAID_LIMIT_V2 continua dependendo de revisao, runtime/jobs
autorizados e homologacao do gateway/equipamento para operacao fisica.
Tarifa monetaria de permanencia ainda nao foi definida.

O hotfix de STOP ja publicado na API oficial deve ser preservado e
conciliado com o fluxo Git antes de qualquer release posterior.
A ponte oficial continua opt-in, temporaria e limitada; clonar o projeto
nao concede acesso ao banco ou permissao para operar a instalacao.

## Verificacao

Resultados conferidos nesta copia limpa, antes do commit:

| Verificacao | Resultado |
|---|---|
| Backend generate / build / testes | 117 aprovados, zero falhas; 8 testes MySQL opt-in desativados |
| Frontend build / TypeScript | Aprovados, incluindo a rota opt-in da ponte |
| Frontend testes | 191 aprovados, zero falhas |
| App lint / TypeScript / testes | Aprovados; 31 testes |
| GIE HTTP | 11 aprovados, zero falhas |
| Estrutura / gates | 5 testes aprovados |

Total destas suites: 355 aprovados. Nenhum fixture foi escrito no MySQL
oficial; testes de gateway/pagamento usam adaptadores falsos.

O build do site nesta copia utilizou Webpack: o primeiro build Turbopack
recusou a junction temporaria de node_modules fora da raiz. Essa limitacao
do ambiente de verificacao nao resultou em alteracao de Next/configuracao
do produto. O CI instala dependencias locais e usa o build padrao; seu
resultado remoto precisa ser conferido apos a publicacao.

O aviso existente de depreciacao Prisma/Starlette permanece registrado;
dependencias e lockfiles nao foram atualizados nesta publicacao.

## Reversao

Rejeitar/fechar a revisao nao exige restaurar banco ou alterar servicos.
Eventual reversao compartilhada deve ser por novo commit revisado, nunca
por force push, reset geral ou apagamento dos registros de teste.
