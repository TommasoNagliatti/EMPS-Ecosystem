# Release candidate — 22/10/2026

Versao local consolidada na branch feat/gie-esp32-realtime / PR10. Nao e release de producao homologada. Git nao transporta os bancos de demonstracao, contas, permissoes ou historicos locais.

## Funcionalidades e limites
Dashboard e GIE comercial, Posto e Residencia; modo ilustrativo CHARGER_DEMO separado do GIE e sessoes; Web Charge/QR e cartao Stripe de teste no ledger SANDBOX; diagnostico JSON autenticado; firmware SERIAL_ONLY e ponte opcional (desligada na execucao local atual); ajustes de polling/limite GET. Modelos treinados preservados. Debitos de ociosidade ainda sao apenas politica calculada/testada, sem ledger/icone/cobranca implementados: ver APP_STRIPE_IDLE_DEBT_LOCAL_2026-10-21.md.

Todos os flags de laboratorio dependem do clone local aprovado. Nao trocar URL do banco ou remover essas protecoes para habilitar SANDBOX no oficial. O mapeamento comercial dos LEDs resolve codigos publicos; IDs13/49/51 e46/47 sao especificos da copia local e nao devem ser presumidos na VPS.

## Auditoria de publicacao
Scanner do repositorio nao encontrou sinal de credencial. Sinalizou apenas0011-local-residence-sandbox-tariff.sql por INSERT: revisao manual confirma tarifa sintetica2.00, condicionada a DATABASE()=emps_integration_test e identidade exata de carregador demonstrativo, idempotente. Nao contem usuarios, senhas ou historicos pessoais. Publicar o SQL nao autoriza executa-lo. Arquivos .env/segredos, backups, logs, builds e next-env.d.ts local nao incluidos no commit.

## Preflight Hostinger somente leitura
VPS confirmada no painel Hostinger; Ubuntu/Docker. Cinco conteineres ativos: frontend, backend, GIE legado, Caddy, MySQL8. Memoria total aproximadamente8GiB, disponivel6.6GiB; disco livre89GiB no momento da leitura. Nenhum servico foi reiniciado nem banco alterado.
Checkout remoto a788d1c8970a2830ace8ad55eab815709723ef41 possui hotfix nao commitado em admin-operations.service.ts (preservacao de recibo pre-pago na parada). Nao sobrescrever/resetar/stashar automaticamente. Comparar semanticamente com a branch antes da release.
Consulta de nomes de tabelas confirmou somente gie_cycles, gie_evse_mappings e gie_interval_snapshots entre os prefixos demo_/lab_/gie_. Tabelas demo/lab e binding V3 nao existem na base oficial. Nova API nao pode ser promovida sem plano revisado de schema e mapeamento de dados. Nenhum SQL local aplicado.
Proxy Caddy possui rotas independentes para Site/API. update-emps.sh exige main limpa, rejeita mudancas Prisma/database e usa force-recreate dos servicos: nao proporciona deploy sem interrupcao. Nao executar esse script nem alterar suas travas para publicar esta branch.

## Plano de continuidade a aprovar apos compatibilidade
1. Preservar hotfix e identificar diff final; nenhuma integracao automatica em main.
2. Preparar backup atual e validar restauracao; revisar patches aditivos, IDs, grants e compatibilidade simultanea de versoes. Nao copiar dump local para o banco oficial.
3. Preparar uma stack paralela com nomes/imagens/volumes proprios, configuracao privada e banco isolado; nao publicar laboratorio com protecoes removidas. Homologar login, QR, financeiro, GIE e sessoes. Publicar endereco de homologacao exige definir dominio e controle de acesso.
4. Somente apos gates, subir novas instancias sem parar antigas e validar health. Trocar Site/API pelo reload validado do Caddy; drenar WebSockets/sessoes e manter antigas para retorno. Zero interrupcao de sessoes requer compatibilidade de jobs e contratos, nao apenas duas instancias. Nunca permitir dois monitores comandando a mesma sessao.

Nenhum deploy, merge, migracao ou importacao autorizado implicitamente por este documento. Requisicao atual de publicacao nao resolve incompatibilidades de schema/hotfix ou valida pagamentos fisicos.

## Validacao consolidada
Backend: 224 testes, 216 aprovados, 8 opt-in MySQL pulados, zero falhas (loopback autorizado). Teste QR atualizado para incluir dependencias publicQr/cardConfiguration no double, sem alteracao de comportamento produtivo. Frontend: 249 testes aprovados. Builds NestJS e Next.js otimizado aprovados no ambiente local; firmware compilado previamente. Scanner do indice Git: 88 arquivos, sem credenciais; excecao SQL0011 revisada manualmente acima. Arquivo gerado next-env.d.ts permanece apenas local.
