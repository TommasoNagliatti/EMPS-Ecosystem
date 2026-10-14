# Proposta 2026-10-12-005 - Integracao com o banco oficial

Estado: **PROPOSTA, NAO IMPLEMENTADA, AGUARDANDO APROVACAO**.
Solicitacao: restaurar a comunicacao entre site, aplicativo, Nest, MySQL e GIE,
usando o banco oficial, com apresentacao previa das mudancas para o grupo.

## Limites desta etapa

Esta etapa leu codigo e telas autorizadas. Apenas este documento e o indice de
documentacao foram criados/atualizados. Nenhuma configuracao operacional, codigo
da aplicacao, dependencia, SQL, registro, permissao, chave ou servico da VPS foi
alterado. O modo remoto atual continua somente leitura e o GIE continua replay
isolado. Nao houve commit, push ou deploy.

Referencia original consultada: `TommasoNagliatti/EMPS-Ecosystem`, commit
`3fc3bc58fb27b48c21fc69a2ce44049365ddf7b1`, disponivel no clone local. Nao foi
consultada uma eventual versao remota mais recente. A interface atual e as
otimizacoes posteriores serao preservadas; nao se propoe reset do repositorio.

## Diagnostico confirmado

1. Site e Nest locais consultam o MySQL oficial pelo tunel SSH com SELECT-only.
   `remote-development.ts` bloqueia mutacoes HTTP/Prisma, jobs, pagamentos externos,
   comandos fisicos e credenciais do GIE operacional nesse perfil.
2. `LocalGieDemoService` consulta um replay Python autenticado, GET-only, isolado.
   `AdminDashboard` e `energyFromGie` deliberadamente impedem que esse replay
   substitua telemetria da instalacao. Essa separacao nao e erro de desenho.
3. No original, `GieService.collect()` envia demandas ao Python a partir de
   `gie_evse_mappings`. `sample()` pode atualizar energia, duracao, preco e estado
   dos carregadores de sessoes ACTIVE. Restaurar esse caminho nao e apenas ligar
   um processo: ele possui efeitos de escrita e financeiros.
4. A instalacao inspecionada pela interface nao possui historico energetico ou
   leituras fisicas confiaveis; personalizacao/treinamento automaticos indisponiveis.
   Nao foi criado dado para corrigir esses estados. Uma sessao ativa foi observada.
5. A documentacao original ja declara o contrato GIE V2 como PREPARED_NOT_ACTIVATED,
   uma estacao por processo, ate quatro slots e sem controle individual de multiplas
   baterias. Ter clonado o projeto nao significa que hardware, pool multiestacao ou
   personalizacao ja estivessem integrados.
6. O novo resumo financeiro conhece pagamentos e sessoes existentes, mas nao recebe
   custo energetico/margem validados. O feed conhece alertas, mas nao um historico
   estruturado de acoes executadas do GIE. Esses contratos exigem trabalho especifico.

## Arquitetura proposta

Site e aplicativo -> API Nest autorizada -> MySQL oficial.

API Nest -> GIE autenticado da estacao -> resultado validado -> API Nest ->
persistencia de telemetria/eventos -> realtime -> painel e aplicativo.

Python nao recebe senha do MySQL nem autoridade de pagamento. Frontend nao recebe
tokens de servico nem escreve direto no banco. Decisoes do GIE nao equivalem a
comandos fisicos confirmados; a API continua sendo autoridade de sessoes/cobranca.

O acesso atual de desenvolvimento somente leitura deve permanecer intacto.
Um runtime integrado deve ter perfil e credenciais separados, aprovados e
revogaveis. Nao basta trocar READ_ONLY por READ_WRITE ou remover os guards.
Permissoes MySQL por tabela nao garantem isolamento por estacao: esse limite
tambem exige validacao na API, testes negativos e auditoria.

## Etapas propostas e aprovacoes

| Etapa | Mudancas propostas | Aprovacao / criterio de entrada |
|---|---|---|
| 1. Inventario | Conferir esquema oficial, configuracao aprovada da instalacao, ativos, slots GIE, fontes, endpoint Python e contrato financeiro. Preparar diff e SQL sem aplicar. | Somente leitura; nao exige liberar escrita. Confirmar qual instalacao e qual objetivo: demonstracao ou hardware real. |
| 2. Ambiente integrado | Runtime Nest/GIE com configuracao separada, segredo de servico no servidor, supervisor, timeouts, desligamento seguro e acesso limitado. Preferencia de execucao final na VPS depende da capacidade e autorizacao do responsavel. | Aprovar local de execucao, janela, backup e escopo exato de acesso. Nao ampliar o usuario SELECT-only atual. |
| 3. Cadastro e vinculos | Configurar somente ativos aprovados, `gie_evse_mappings` e fontes por instalacao. Demonstracao no banco oficial preferencialmente em uma instalacao dedicada, com registros claramente simulados. | Aprovar DML com IDs e estado antes/depois. Criar instalacao de demonstracao tambem e escrita oficial e exige aprovacao. |
| 4. Estado e historico | Reutilizar o motor original; adaptar contexto e origem. Persistir resultados validos, historico, fontes/qualidade e auditoria. Separar GIE previsto/recomendado/solicitado/confirmado/falho. | Validar contratos, origem, horario/fuso, disponibilidade do intervalo, deduplicacao e estacao. Nao promover previsao/setpoint a medicao. |
| 5. Painel e financeiro | Conectar estado integrado ao fluxo e ao historico; feed de eventos; contratos de custo/margem no backend. Site/app usam os mesmos IDs e dados autorizados. | Aprovar regra de custos com unidade, fonte, periodo, tarifa e versao. Sem alterar tarifas atuais ou recalcular passado. |
| 6. Validacao e ativacao | Testes de isolamento, falhas, reconciliacao, realtime e modos; demonstracao sem hardware/PSP. Ativacao gradual, monitoramento e rollback de codigo/configuracao. | Revisao do grupo, evidencias e autorizacao explicita para publicar. Comandos fisicos e pagamentos reais continuam proibidos ate aprovacao separada. |

## Origem dos dados e separacao de modos

- DEMONSTRACAO: motor original com entradas explicitamente SIMULATED, sem hardware
  confirmado. Sessoes/pagamentos de teste devem ser separados dos comerciais. Nao
  injetar simulacao na instalacao existente com sessoes ativas reais/legadas.
- OPERACAO REAL: fontes verificadas, protocolo/medidores, limites eletricos e ack de
  equipamento. Exige bancada e autorizacao especifica. Conexao ao Python nao prova
  conexao ao inversor, bateria ou carregador.
- MEASURED, CALCULATED, EXTERNAL, FORECAST, SIMULATED e IMPORTED continuam distintos.
  Fonte configurada ou qualidade GOOD nao certifica hardware. Dados ausentes nao
  serao preenchidos com zero nem o replay passara a ser apresentado como leitura real.
- Comecar com uma instalacao e ate quatro slots, preservando MPC, modelos, perfis e
  artefatos congelados. Mais instalacoes ou baterias individuais sao projeto separado,
  nao algo ja entregue pela integracao original.

## Inventario preliminar de codigo a revisar

O inventario abaixo e candidato, nao diff aplicado nem promessa de que todos os
arquivos precisam ser alterados. O diff definitivo e o SQL serao apresentados antes
de qualquer mudanca em ambiente oficial.

| Area | Arquivos / contratos candidatos | Finalidade |
|---|---|---|
| Nest / GIE | `backend/src/gie.service.ts`, `gie-v2-contract.ts`, adaptador/politica de runtime separados a definir | Contexto por instalacao, slots, resultados, watchdog e registros idempotentes. Preservar o perfil de leitura atual. |
| Nest / dados | `backend/src/telemetry.service.ts`, `telemetry-domain.ts`, controllers de telemetria | Gravacao autorizada com origem/qualidade, historico sem misturas, intervalos completos e tempo explicito. |
| Nest / painel | `backend/src/dashboard.controller.ts`, `dashboard-summary.ts`, endpoints de avisos/financeiro a especificar | Contratos consolidados de historico, eventos e custos; limites e filtros por instalacao. |
| Nest / cobranca | `session-billing.service.ts`, `tariff-engine.ts`, `payment-gateway.service.ts`, `charging-gateway.service.ts` | Revisar compatibilidade e bloqueios de efeitos; preservar tarifas, ledger e cutover. Mudancas apenas se aprovadas e necessarias. |
| GIE Python | `gie/GIE/service/api.py`, adaptador de contexto/proveniencia a definir | Reutilizar GIEControl e motor existentes, sem reescrever/treinar modelos congelados. |
| Site | `AdminDashboard.tsx`, `domain/gie.ts`, `use-station-history.ts`, `StationNotices.tsx`, `StationFinancialSummary.tsx`, `services/emps-api.ts` | Consumir contratos aprovados; fonte/estado coerentes; nao substituir medicao por simulacao. Preservar layout. |
| Aplicativo | servicos de API, configuracao de endpoint e telas existentes a identificar | Consumir a API unificada e refletir sessoes/estacao. Nao trocar SDK/credenciais por conveniencia. Testar em aparelho. |
| Infraestrutura | iniciador integrado separado, supervisor, configuracao privada e deploy a especificar | Um so runtime escritor aprovado; tokens so no servidor; sem ampliar/expor banco ao browser. |
| Testes / documentos | backend, GIE, frontend e app; registro de mudancas e evidencias | Testar contratos completos e falhas; inventario final e procedimento de reversao. |

Caminhos do backend/site relativos a `site/emps-site-main/`. O app fica em
`app/emps-charge`. Nenhum arquivo candidato acima foi modificado nesta proposta.

## Plano de SQL e dados - ainda sem aplicar

Preferir reutilizar tabelas existentes: `gie_evse_mappings`, `telemetry_sources`,
`station_energy_readings`, `gie_cycles`, `gie_interval_snapshots`,
`station_audit_events` e tabelas atuais de sessoes/estado/pagamentos.
Existir no schema Prisma local nao comprova que cada campo/indice ja esteja
presente no banco oficial; comparar antes de propor DDL.

Preparar primeiro lista de INSERT/UPDATE esperados, IDs aprovados, condicoes,
transacoes, deduplicacao e volume de escrita. Nova tabela/campo/indice so se o
contrato exigir, com migration separada, revisao e backup antes. Nunca importar
um SQL completo sobre a base oficial, executar seed, apagar volume ou dar reset.

O caminho original `sample()` pode escrever em `charging_sessions` e
`charger_live_status`. Nao ativa-lo em sessoes comerciais existentes apenas para
animar o dashboard. Corte temporal e snapshot tarifario sao obrigatorios; nao
reprecificar, avancar nem encerrar sessoes antigas durante testes.

## Financeiro

Received/approved continua separado de faturado/pendente. Custo energetico precisa
de medicao/rastreio, tarifa versionada e periodo/fuso; solar/bateria nao sao energia
gratis. Margem operacional nao e lucro liquido. Referencias de rateio do prototipo
nao sao apuracao validada do custo total da instalacao.

Pagamentos de demonstracao usam sandbox e nunca capturam, aprovam ou estornam uma
transacao real para testar a integracao. Historico antigo deve permanecer identico.
Formula nova, ledger, settlement ou integracao Stripe/OCPP exige aprovacao propria.

## Aceite antes de publicar

1. GIE autenticado para a instalacao correta; mesma fonte/ID no site, Nest e app.
2. Sessao de teste inicia/para e altera demanda apenas nos slots aprovados; desconexao,
   stale, falha Python e timeout resultam em estado seguro, sem potencia/dado inventado.
3. Historico persiste origem e horarios; dashboard/CSV/avisos mostram dados gravados,
   com falhas e lacunas preservadas. Requisicoes/restarts nao duplicam registros.
4. Fonte simulada nao e medicao fisica; predicted/recommended nao e confirmed; setpoint
   nao e energia medida. Nenhum comando em PRESENTATION nem promocao automatica.
5. Receita/custo/margem conciliam com contratos definidos; teste nao muda cobranças,
   reservas ou sessoes comerciais existentes. Status pendente/estornado sao exercitados.
6. Permissoes, estacao errada, acesso negado e duas execucoes concorrentes sao testados;
   banco nao fica exposto e nenhuma chave/token aparece no frontend/repositorio.
7. App em telefone e site desktop/mobile, realtime, reentrada/login e recuperacao de
   processo verificados. Release aprovada, rollback ensaiado e responsavel definido.

## Backup, liberacao e rollback

Backup verificavel antes de qualquer DML/DDL oficial, com plano de restauracao
aprovado. Ativacao gradual por instalacao e flags de integracao separadas de
pagamentos/hardware. Desativacao primeiro interrompe o escritor/ciclo autorizado;
codigo/configuracao anterior pode voltar sem apagar auditoria ou pagamentos novos.

Nao restaurar cegamente o banco inteiro em rollback: isso poderia remover outras
transacoes ocorridas apos o backup. Reversao de dados deve ser especifica, revisada
e conciliada. Qualquer descarte/limpeza tem aprovacao propria.

## Decisoes que o grupo deve aprovar

- Objetivo inicial: demonstracao integrada no banco oficial OU operacao fisica real.
- Instalacao/ativos/slots autorizados. Para demonstracao, preferir instalacao dedicada.
- Local do runtime: VPS ou processo local autorizado. Como manter uma unica instancia.
- Privilegios e identidade do servico, tabelas/rotas/IDs autorizados e janela de mudanca.
- Contratos de telemetria/eventos e definicao de custo/margem.
- SQL exato, backup, deploy, criterios de aceite e responsavel pela reversao.

**Aprovacao desta proposta nao autoriza automaticamente emitir comandos fisicos,
ampliar acesso, cobrar clientes ou aplicar SQL. Esses passos exigem aprovacao de
escopo no momento da execucao, com o diff e os dados afetados conhecidos.**
