# CR-2026-10-13-006 - Integracao compativel no repositorio do Tommaso

Pedido: corrigir conflitos com o ecossistema original e enviar as melhorias
ao GitHub do Tommaso. Publicacao proposta para revisao, sem merge/deploy automatico.

## Proveniencia e preservacao

- Base original: `3fc3bc58fb27b48c21fc69a2ce44049365ddf7b1`.
- Fonte das melhorias anteriores: `2419b46b0381ffec1fee9f5848f78c5c22a3eebd`
  do repositorio matheus00M7/ecossistema-emps-fiap-test.
- Branch local: `codex/compatibilidade-site-gie-2026-10-13`.
- Trabalho em clone separado; instancia anterior e arquivos locais preservados.
- Historico Git original mantido, sem force push ou merge de historias desconexas.
- LICENSE e WORK_STATE original preservados; CI original ajustado, nao substituido.
- Melhorias anteriores de interface, navegacao, paineis, clima, mapas e perfis
  remotos transportadas com suas CRs historicas. Os PDFs anteriores descrevem
  seus cortes antigos, nao o estado de deploy desta nova branch.

O manifesto `docs/compatibility-manifest-2026-10-13.json` enumera o conjunto
completo alterado e seus hashes. O diff Git contra a base e a fonte integral
de verdade para cada linha adicionada/removida; os commits anteriores e seus
relatorios permanecem referenciados, nao sao reescritos como feitos hoje.

## Correcoes desta rodada

### R01 - Pagamento concluido nao elimina a retirada pendente

- `app/emps-charge/src/domain/models.ts`: tipos opcionais de lifecycle e
  versao da politica; preco de permanencia aceita null quando indefinido.
- Novo `src/domain/charge-lifecycle.ts`: valida metadata e calcula se a retirada
  ainda e necessaria, independente de status financeiro ou tariffVersion.
- `src/domain/normalizers.ts`: conserva lifecycle/disconnectedAt, rejeita
  metadata invalida em vez de transformar silenciosamente em recarga legada.
- `src/services/mobile-api.ts`: START aceita versao opcional anunciada pela API.
- `src/context/app-context.tsx`: retirada separada de pagamento, refresh com
  verificacao de sessao e termos V2 enviados somente quando anunciados.
- `src/app/receipt.tsx`: acao de retirada mesmo com recibo pago, prazo e polling
  ate desconexao; modo fisico aguarda gateway, sem botao de retirada manual.
- `frontend/components/charge/WebCharge.tsx`: mesmas regras no browser, impede
  iniciar outra recarga com conector ocupado e aceita confirmacao final Stripe
  quando o fechamento requer acao adicional. Polling encerra ao retirar.
- `frontend/domain/charge-lifecycle.ts` e `ChargeLifecyclePanel.tsx`: modo de
  confirmacao fisico/cliente, sem ampliar a ponte somente leitura.
- `backend/src/session-billing.service.ts`: o endpoint de desconexao existente
  tambem aceita V2 pago e V2 sem ledger V1, preservando ownership, transacao,
  idempotencia e bloqueio de sessao fisica. Nao cria novo recebimento na retirada.
- `backend/src/charge-lifecycle.service.ts`: retirada fisica segue protegida
  mesmo se a URL do gateway desaparecer depois do inicio confirmado.

### R02 - Leitores novos convivem com registros legados

- `backend/src/charge-lifecycle.ts`: opt-in por IDs e verificacao de termos no
  START; apresentacao reconhece sessoes ja persistidas com a lista desativada.
- `backend/src/main.ts`: valida configuracao de IDs no boot, sem ativacao global.
- `backend/src/tariff-engine.ts`: ledger V1 nao e inferido de JSON lifecycle-only;
  precificacao antiga permanece separada da nova regra.
- `backend/src/gie.service.ts`: a excecao para amostragem reconhece V2 de Caixa
  sem tariffVersion, mas nao altera a protecao de sessoes antigas do cutover V1.
- Documentacao explica que voltar ao backend original sem leitores compativeis
  nao e seguro depois de criar V2; nao promete rollback so com git checkout.

### R03 - Contrato original de gateway e clientes por padrao

- `backend/src/mobile.service.ts` e `admin-operations.service.ts`: snapshot,
  limite local de energia, verificacao de capacidade e novo estado PREPARING
  sao aplicados a novas sessoes somente nas instalacoes explicitamente opt-in.
- `backend/src/mobile.dtos.ts`: politica opcional e validada. Cliente antigo
  permanece aceito no fluxo original; nao inicia V2 com termos desatualizados.
- `.env.example`: lista V2 vazia por padrao, com instrucao de homologacao.
- `charging-gateway.service.ts`, ja presente na fonte importada, conserva
  /commands para START sem limite e exige capacidade de hard limit somente V2.
  Nao foi implementado o gateway fisico externo nesta entrega.

### R04 - Inicializacao nao reutiliza build antigo

- `scripts/start-local.ps1`: recompila Nest antes de iniciar servicos e aborta
  se falhar; recupera --v2 para ownership/supervisao de processos originais.
- `scripts/check-component.cjs`: verificacao da API nao herda o opt-in V2,
  conexao oficial ou flags de testes com escrita do processo chamador.
- Nao adicionados seed, migrate, reset, db push ou apagamento de volumes.

### R05 - Condicoes exibidas correspondem a regra aplicada

- `tariff-engine.ts`: original conserva 15 minutos/R$ 0,25/teto; V2 informa
  10 minutos e preco/teto de permanencia null, pois a tarifa esta pendente.
- `app/src/app/checkout.tsx`, `receipt.tsx` e WebCharge: prazos e pagamento
  separados da retirada, sem prometer cobranca de permanencia ainda nao definida.

### Dependencias, verificacao e registro

- `frontend/package.json` e lockfile: Next de 16.3.2 para 16.3.8 exato, mantendo
  a serie 16.3; nao realizada migracao major de Tailwind ou Recharts.
- `app/package.json`: suite passa a incluir automaticamente tests/*.test.ts.
- `.github/workflows/ci.yml`: permissao somente contents:read e frontend roda
  toda a suite; nenhum comando de deploy foi acrescentado ao CI original.
- Novos testes de rollout/backend, WebCharge e normalizacao/app, sem banco
  oficial ou gateway real. README/indice atualizados e guia de release novo.
- Removidos espacos/finais de linha sobrando no modelo de aprovacao e nos
  testes account-theme/station-monitoring. O OFL.txt de terceiros foi mantido
  exatamente como recebido, inclusive seu espaco final original.

## Banco de dados e GIE

Schema Prisma, migrations, SQL canonicamente existentes, seed, arquivos de
deploy Docker e core Python do GIE comparados com a base original sem diferencas.
Arquivos de politica/documentacao de database foram importados, nao executados.
Nao houve DROP, TRUNCATE, migration, alteracao de grants ou importacao de registros.

O backend ganhou/adaptou regras em campos e tabelas existentes, inclusive JSON
billingSnapshot e handlers de sessao. Isso e mudanca de backend, nao apenas CSS.
Quando ativado num ambiente com escrita, operacoes autorizadas criam/atualizam
registros normalmente; esta etapa nao realizou essas operacoes no banco oficial.

## Verificacao realizada

| Suite | Resultado |
|---|---|
| Backend generate, build e testes | 126 aprovados, 8 testes MySQL opt-in desativados, zero falhas |
| Frontend Next 16.3.8, TypeScript e build | Aprovados com Turbopack e dependencias locais |
| Frontend testes | 196 aprovados, zero falhas |
| App lint, TypeScript e testes | 34 aprovados, zero falhas |
| GIE HTTP | 11 aprovados, zero falhas |
| Estrutura/publicacao | 5 aprovados; scanner sem sinal bloqueante |

Total: 372 testes aprovados. Os novos casos verificam retirada apos pagamento,
ownership, gateway somente no escopo V2, cutover, idempotencia e termos do START.
O app nao foi testado em um iPhone real. Gateway/Stripe nos testes sao falsos.
Os oito casos MySQL precisam de homologacao posterior em banco descartavel.

Next 16.3.2 tinha alerta critico; a versao fixada elimina esse alerta no audit
executado, mas o frontend ainda possui 12 alertas (9 altos, 3 moderados).
Nao foi usado npm audit fix --force para impor migracoes incompativeis. Isso
nao e certificado de seguranca nem liberacao de producao. Referencia primaria:
https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36

## Publicacao e aprovacao

Preparado para commit/branch/PR de revisao, nao para sobrescrever main.
O GitHub informou falta de permissao de escrita de matheus00M7 no repositorio
do Tommaso (403 no dry-run). Se isso nao mudar, o envio direto nao podera ocorrer.
Conceder colaboracao e aceitar convite, ou aprovar o fluxo normal de fork/PR.

Nenhuma alteracao da Hostinger foi autorizada ou realizada nesta rodada.
Merge e deploy precisam de aprovacao separada, verificacao de hooks, backup
e homologacao conforme `docs/COMPATIBILITY_RELEASE.md`.
