# Integração GIE V3 multiestação com EMPS

## Origem e estado

- Base EMPS: `codex/compatibilidade-site-gie-2026-10-13` no commit `6d5c0f8bcd7df57a07cb91c432d0abbe3bf6c4b0`, PR #1 ainda em rascunho na verificação de 14/10/2026. Esta integração deve ser revisada como dependente daquele PR; não pressupõe merge na `main`.
- Fonte dos módulos GIE V3: `TommasoNagliatti/GIE`, branch `feat/gie-multistation-v3`, commit `15d0154bd45c0a8e0080a10f3445052a4222d4cb`. Foram incorporados os módulos e artefatos necessários ao runtime em `gie/GIE`; o GIE comercial original do EMPS não foi removido.
- Comparação de conteúdo com o commit de origem: os módulos/modelos/dados incorporados são idênticos, exceto a extensão de rotas em `src/gie_multistation/api.py` e os novos `events.py`/`test_events.py` para expor ao backend o feed de alertas já detectado pelo painel.
- Nenhuma migration foi aplicada ao MySQL oficial, nenhuma instalação foi criada na conta real e nenhum serviço da Hostinger foi alterado nesta etapa.

## Arquitetura

O navegador e o App falam somente com o NestJS. O NestJS verifica a associação do usuário à instalação e usa `gie_station_bindings` para traduzir o ID numérico do MySQL para a identidade textual do Python. O serviço FastAPI mantém um worker, estado, modelos, cache e checkpoint por identidade. A geração (`generation`) é verificada entre health e state; respostas divergentes ou de outra estação são rejeitadas. O estado apresentado é sempre `SIMULATED`, com `physical_dispatch=false` e `hardware_commands_sent=false`.

| Instalação EMPS | GIE | Equipamentos da demonstração |
| --- | --- | --- |
| Shopping Frei Caneca, registro existente | `Commercial_HighAutonomy_V2` | Quatro EVSEs e MPC/cenas comerciais originais, sem recriar estação ou alterar sessões |
| Posto 24h, novo registro privado | `DEMO_POSTO_24H_001` | Dois EVSEs de 22 kW, solar 50 kWp, dois inversores de 30 kW, BAT_01 e BAT_02 independentes de 61,4 kWh nominais / 60 kWh úteis de referência cada |
| Residência, novo registro privado | `DEMO_CASA_001` | Um EVSE de 7 kW, solar 5,5 kWp, inversor de 6 kW, nenhuma bateria cadastrada |
| Estação futura sem histórico aprovado | `EMPS_<id numérico>` | Configuração técnica aprovada convertida para `Provision`, modelo `BASELINE`; não recebe modelos de outra estação |

Posto e residência são criados idempotentemente pelo endpoint de proprietário, na conta que realmente possui a instalação comercial. Endereço, CEP, coordenadas, fotos e tarifas permanecem vazios. Os carregadores ficam `PENDING`; as instalações, `PRIVATE` e `DRAFT`. O fluxo de publicação comum recusa a promoção desses perfis simulados até um processo posterior de conversão e homologação. A bateria residencial hipotética de 5,4 kWh permanece somente no comparador GIE.

## Contratos e rotas

| EMPS autenticado | FastAPI interno | Resultado |
| --- | --- | --- |
| `GET /stations/:id/gie/health` | `GET /v1/stations/{gie_id}/health` | Saúde do worker e geração da instalação autorizada |
| `GET /stations/:id/gie/state` | health, initialize quando parado, state, events | Decisão, 48 previsões de 15 min quando disponíveis, histórico de até 100 ciclos da geração e falha de alertas separada da energia |
| `POST /stations/:id/gie/cycle` | `/v1/stations/{gie_id}/cycle` ou `/v2/stations/{gie_id}/cycle` | Avança apenas cenário simulado; BASELINE exige instante explícito e dados atuais SIMULATED quando fornecidos |
| `POST /stations/:id/gie/mode`, `presentation/:action`, `manual-demo/event` | rotas V1 equivalentes | Ações simuladas autorizadas; as 16 cenas permanecem exclusivas do perfil comercial |
| `POST /stations/:id/gie/provision` | `POST /v2/stations` e health com token de leitura | Adaptador explícito de configuração aprovada, SoC de 0–100 para 0–1, vínculo local somente após provisionamento e escopo de leitura confirmados |
| `POST /v2/stations/:id/gie/demo-installations` | health e configuração dos três perfis antes da transação | Vincula comercial existente e cria as duas instalações privadas uma única vez |
| `POST /stations/:id/gie/alerts/:alertId/ack` | `POST /v1/stations/{gie_id}/alerts/{alert_id}/ack` | Reconhece no GIE e sincroniza revisão; resolução permanece de responsabilidade do detector GIE |

O feed `GET /v1/stations/{gie_id}/events?after=<cursor>` é persistido em SQLite por estação no volume GIE e sincronizado pelo backend à tabela `alerts`. O cursor e a revisão evitam duplicatas. A transação trava o vínculo da estação; realtime publica mudanças de alerta. O dashboard lista apenas alertas acessíveis à conta. A rota genérica de alteração de status recusa alertas GIE. Os detectores atuais cobrem, entre outros, EVSE indisponível, demanda EV limitada, SoC mínimo, proximidade do limite de rede, dados atuais insuficientes, MPC bloqueado, BASELINE e a baixa confiança da previsão EV residencial. Não há evento distinto de mudança significativa de distribuição de potência; health mostra worker parado/falho, mas o feed ainda não registra toda transição de ciclo de vida como alerta persistente.

O provisionamento dinâmico exige `GIE_V3_PROVISIONING_TOKEN` com permissão explícita e `GIE_V3_SERVICE_TOKEN` com leitura explícita da identidade `EMPS_<id>`. Não se amplia o escopo automaticamente nem se usa wildcard. Conflito de configuração no Python é tratado como falha para revisão, sem sobrescrever cadastro anterior. O endpoint de transição de modelo personalizado permanece 409 no GIE.

## Dados e segurança de cobrança

Configuração elétrica não é medição. A interface não substitui valores ausentes por zero, identifica a simulação, mantém as duas baterias do posto separadas e não calcula economia em reais com resultados MPC. Previsões residenciais de recarga têm qualidade limitada e não representam garantia.

O GIE V3 não envia setpoints a OCPP, GoodWe, Modbus ou ESP32. Quando uma estação passa a ter vínculo V3, o sampler legado deixa de transformar setpoints demonstrativos em energia de sessão. Se não houver caminho OCPP de medição configurado, novos inícios de recarga nessa estação são recusados antes da gravação da sessão. Isso torna a verificação do medidor OCPP um requisito de implantação do perfil comercial; não se deve remover a proteção para aparentar compatibilidade de cobrança. Sessões existentes não são convertidas, e o vínculo comercial só é criado sem sessões ativas.

## Banco e arquivos de implantação

Migration proposta: `site/emps-site-main/backend/prisma/migrations/20261014_gie_multistation_binding/migration.sql`. Ela cria `gie_station_bindings` (identidades únicas, geração e cursor), acrescenta à tabela `alerts` o ID/revisão/geração/carga do GIE e o horário de reconhecimento. Não remove ou reescreve colunas, usuários, estações, sessões ou pagamentos. A compatibilidade com o MySQL oficial ainda requer inspeção de versão/schema e execução aprovada após backup.

Container: `gie/GIE/Dockerfile.multistation`, sobreposição `site/emps-site-main/docker-compose.gie-v3.yml`. Os arquivos de runtime `src`, `data`, `models` e `site_profiles` somam aproximadamente 73,5 MB antes das bibliotecas Python; relatórios históricos, caches, testes, ambiente virtual e diretórios temporários estão excluídos do contexto. O serviço usa uma instância de API/gerenciador, volume persistente `/var/lib/gie`, raiz somente leitura, health check, parada graciosa e limites configuráveis `GIE_V3_CPU_LIMIT`/`GIE_V3_MEMORY_LIMIT` (padrões 2 CPU/4 GiB). Não há medição do tamanho final da imagem nem de RAM dos três workers neste host, pois o daemon Docker local estava indisponível.

## Verificações e limites conhecidos

- Backend NestJS: `prisma validate`, build e suíte automatizada; 136 testes aprovados e 8 testes MySQL opt-in não executados, sem falhas (14/10/2026). O teste novo cobre adaptador multibateria, isolamento de IDs/gerações, provisionamento sem vínculo em falha, revisão de alertas, bloqueio de cobrança sem medição e cadastro idempotente.
- Site Next.js: compilação de produção e 200 testes aprovados. A compilação precisou sair do isolamento local do Windows para o Next.js resolver o caminho do projeto.
- App Expo: lint, typecheck e 34 testes aprovados. O Web Charge também está coberto por testes existentes do Site e backend.
- GIE Python: 66 testes executados no bundle, 61 aprovados e 5 erros por arquivos de evidência/treinamento deliberadamente ausentes (`reports/multistation/v1/preservation_before.json`, `reports/provisioning/v1/four_stations.json`, CSV mensal usado pelo teste de treino, `reports/energy_v3/.../cycles_24h.csv` e `reports/panel/v1/interactive_96.json`). Os testes de workers isolados, ciclos simultâneos, reinício, BASELINE, Energy V3, alertas persistentes e 16 cenas comerciais passaram. Esses cinco testes são de reprodução histórica/painel e exigem o clone GIE completo; não indicam falha de ciclo da API do container. Uma resposta real dos três perfis mostrou 48 previsões e decisões independentes para BAT_01/BAT_02, sem bateria no estado residencial. Inicialização retorna estado nulo até o primeiro ciclo.
- Docker: a configuração Compose passou na validação sintática com escopo de token fictício. Não foi possível construir nem iniciar a imagem localmente sem o daemon. A sobreposição deve ser validada junto ao Compose efetivamente usado na VPS; este arquivo isolado não substitui o Compose oficial, que não está versionado neste checkout.
- Divergência histórica preservada: `docs/release/frozen_manifest.json` do GIE declara SHA-256 `c957cd2ba2f792547b6b336183049738eebaa9d4109cf3c1836ae6615f705808` para `demo/high_autonomy_v2/app.py`; o arquivo versionado possui `897e3d650c1800dd1f7441fa984b703c50b18ce705871b0d4dbbdc59eb3e`. Nenhum hash ou artefato foi alterado para esconder a diferença.

## Etapa posterior na Hostinger, dependente de aprovação expressa

1. Confirmar commit/PR revisados, estado do PR #1, ID real e proprietário da Shopping Frei Caneca; não presumir `1` ou outro ID. Conferir schema MySQL 8, serviços, rede Compose, backups restauráveis, espaço, RAM e CPU atuais da VPS. Conferir que o medidor OCPP e a continuidade de cobrança foram testados antes de vincular a estação comercial.
2. Preparar tokens separados com escopos exatos para os três IDs conhecidos e para cada futuro `EMPS_<id>`; configurar backend e GIE na mesma rede interna. Fazer build e validação local da imagem/Compose na VPS sem trocar serviços online. Não expor a API Python ou tokens ao navegador.
3. Fazer backup consistente do MySQL e dos volumes GIE existentes, registrar imagens/commit atuais e ensaiar restauração. Aplicar somente a migration aditiva aprovada. Atualizar serviços com health checks, mantendo a instalação comercial anterior operacional até a verificação de compatibilidade.
4. Autenticar como o proprietário real, definir `GIE_COMMERCIAL_STATION_ID` com o ID conferido e chamar uma vez `POST /v2/stations/<ID>/gie/demo-installations`. Anotar os dois IDs numéricos retornados. Validar as três instalações na mesma conta, perfis, autorização cruzada, ciclos, alertas, BAT_01/BAT_02, residência sem bateria, cenas comerciais e persistência após reinício controlado fora de sessões ativas.
5. Em falha: interromper o serviço/roteamento V3 e restaurar imagens e Compose anteriores. O backend anterior ignora as colunas/tabela aditivas; preservá-las para diagnóstico em vez de apagar dados. Restaurar backup de banco/volume somente mediante análise específica, sem reset global ou exclusão de sessões. As duas instalações DRAFT/PRIVATE não exigem publicação nem cobrança.

**Ponto de aprovação:** antes do passo 3 ou de qualquer alteração nos serviços ou no MySQL oficial, apresentar o commit final, a migration, os serviços afetados, os resultados dos testes, a verificação de backups/capacidade e este plano de recuperação ao proprietário e obter autorização expressa. Esta autorização ainda não foi dada.
