# Documentacao EMPS

## Guias atuais

| Documento | Finalidade |
|---|---|
| [Execucao local](../STARTUP.md) | Instalar, configurar, iniciar e testar |
| [Arquitetura](../ARCHITECTURE.md) | Limites entre site, app, API, MySQL e GIE |
| [API V2](API_V2.md) | Contratos de integracao existentes |
| [Arquitetura V2](EMPS_V2_ARCHITECTURE.md) | Associacoes e entidades do dominio |
| [GIE V2](GIE_V2_HANDOFF.md) | Contratos e limitacoes de gerenciamento |
| [Remoto somente leitura](REMOTE_DEVELOPMENT_HOSTINGER.md) | Requisitos de acesso individual a VPS |
| [Politica de banco](DATABASE_CHANGE_POLICY.md) | Aprovacao de alteracoes estruturais |
| [Stripe Sandbox](STRIPE_SANDBOX.md) | Pagamentos de teste, sem chaves publicadas |
| [RFID / GoodWe pendente](RFID_GOODWE_INTEGRATION_PENDING.md) | Dependencias de integracao real |
| [Modelo de aprovacao](CHANGE_APPROVAL_TEMPLATE.md) | Revisao pelo grupo |
| [Release compativel](COMPATIBILITY_RELEASE.md) | Homologacao, opt-in e limites de rollback |

## Historico

[Integracao no historico do Tommaso e correcoes de compatibilidade](change-requests/CR-2026-10-13-006-compatibility-integration.md).
[Relatorio completo dessa integracao em PDF](change-requests/pdf/EMPS_INTEGRACAO_COMPATIVEL_TOMMASO_2026-10-13.pdf).
O [manifesto de arquivos](compatibility-manifest-2026-10-13.json) registra todos
os arquivos diferentes da base, sem incluir configuracoes privadas.

`change-requests/` registra as alteracoes consolidadas. Esses registros sao
historicos, nao comandos para reaplicar migrations ou repetir alteracoes.
Capturas e PDFs anteriores com informacoes de operacao real ficam na copia
local privada; nao acompanham o repositorio publico.

[Envio de codigo e relatorio para revisao em 13/10](change-requests/CR-2026-10-13-005-github-publication.md).
[Relatorio complementar publico em PDF](change-requests/pdf/EMPS_RELATORIO_COMPLEMENTAR_PUBLICO_2026-10-13.pdf).
A edicao publica omite capturas operacionais e identificadores privados;
o relatorio completo original permanece na copia local.

[Publicacao e organizacao desta versao](change-requests/CR-2026-10-12-002-github-publication.md).
[Relatorio em PDF](change-requests/pdf/EMPS_ORGANIZACAO_GITHUB_2026-10-12.pdf).

[Otimizacao da navegacao, pendente de revisao](change-requests/CR-2026-10-12-003-navigation-performance.md).

[Dashboard, graficos e avisos, pendente de revisao](change-requests/CR-2026-10-12-004-dashboard-insights.md).

[Proposta de integracao com banco oficial, nao implementada](change-requests/PROPOSTA-2026-10-12-005-integracao-oficial.md).

[Replay GIE local desativado; integracao fisica pendente](change-requests/CR-2026-10-12-006-disable-isolated-gie.md).

[Caixa somente leitura, alteracao revertida](change-requests/CR-2026-10-13-001-readonly-cashier.md).

[Caixa de teste na instalacao 13, conexao local limitada](change-requests/CR-2026-10-13-002-official-cash-test.md).

[Encerramento pre-pago sem pendencia duplicada](change-requests/CR-2026-10-13-003-prepaid-cash-stop.md).

[Limite, saldo a devolver e 10 minutos de retirada; implementado localmente, nao publicado](change-requests/CR-2026-10-13-004-budget-refund-removal.md).

Auditorias de infraestrutura, chaves, configuracoes individuais e inventarios
de contas foram mantidos fora desta publicacao. O repositorio nao concede
acesso ao banco oficial, mesmo para quem consegue clona-lo.
