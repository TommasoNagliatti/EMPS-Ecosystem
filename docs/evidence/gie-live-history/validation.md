# GIE ativo com histórico demonstrativo — validação local

Branch: `feat/gie-live-with-demo-history`, derivada de `feat/gie-demo-analytics-dashboard` (`07e549e`, PR #4). Data: 16/10/2026. Ambiente: `127.0.0.1`, MySQL 8 descartável `emps_demo_test:3307`, Backend `:3001`, Site `:3000`, GIE legado `:8510` e GIE V3 `:8520`.

## Resultado

O contexto **Histórico demonstrativo · SIMULATED** mantém o fluxo e os controles do GIE em tempo de execução. Os agregados, sessões, gráficos e finanças continuam a vir das tabelas demonstrativas do MySQL e conservam as datas originais. O contexto **Operação real** permanece em sua fonte operacional; na conta local, o financeiro real exibiu R$ 0,00. Nenhum setpoint GIE foi convertido em sessão ou receita operacional.

| Instalação | GIE visto no navegador | Histórico MySQL conferido | Equipamento |
| --- | --- | --- | --- |
| Shopping Frei Caneca | Apresentação iniciada; cenas 5, 6 e 7 avançadas manualmente sem reload. Na cena 7: solar 460 kW, prédio 160 kW, EV solicitado/alocado 66 kW; quatro EVSE com 16,5 kW simulados cada. | Junho/2026: 956 tentativas, 504 recargas, 7.792,64 kWh e R$ 17.143,83 simulados antes e depois das cenas. | Apresentação comercial de 16 cenas preservada; modelo e cenas congeladas não alterados. |
| Posto 24h | Ciclo V3 visível no cenário 01/10/2025 13:30: solar 27,11 kW, prédio 12,20 kW, EV alocado 7 kW. | Dezembro/2025: 209 tentativas, 187 recargas, 3.421,08 kWh e R$ 7.526,42 simulados. | EVSE_01 e EVSE_02; BAT_01 60,8% e BAT_02 71,8% de SoC simulados, independentes. |
| Residência | Ciclo V3 visível no cenário 01/10/2025 17:00: solar 0,83 kW, prédio 0,17 kW, exportação calculada 0,67 kW. | Ano/2025: 42 recargas, 756,42 kWh e R$ 434,72 simulados; 32 próprias sem receita e 10 visitantes cobrados. | EVSE_01 de 7 kW; “Sem bateria instalada” no fluxo, sem SoC fictício. |

O importador informou `created: false` para os três lotes após o reinício: Shopping 5.477 sessões de origem/17.376 leituras; Posto 2.289/35.040; Residência 42/35.040. A camada financeira residencial ativa é `residential-owner-visitor-v2` e não altera a energia original.

## Reatividade e isolamento

- Os controles GIE permanecem montados no Dashboard e na aba Inteligência. O retorno da ação atualiza o estado diretamente; uma leitura anterior em andamento não pode sobrescrevê-lo. O polling é de 5 s enquanto visível e consulta imediatamente ao retornar para uma aba visível; falhas passam a offline e recuam para 30 s.
- O fluxo aceita somente resposta da estação selecionada, online, não isolada e identificada como SIMULATED; a apresentação legada exige `hardware_confirmed: false` e o V3 exige `physical_dispatch: false` e `hardware_commands_sent: false`.
- Somente a conta `visual.local@emps.invalid` recebe as ferramentas de apresentação quando o bootstrap confirma o MySQL descartável, origem e portas loopback, gateway OCPP ausente, pagamentos sandbox e comandos físicos desativados. Fora desse ambiente, a autorização existente continua obrigatória. O script de parada verifica identidade, PID, porta e início dos processos locais; preserva o contêiner MySQL e seus dados.
- O launcher reutilizou o mesmo banco e as mesmas três estações. Nenhum serviço ou banco da Hostinger foi consultado ou alterado. Não houve comando físico nem pagamento externo.

## Visual

Capturas antes (`07e549e`) e depois no mesmo viewport de 1270 × 2054 px. Layout, CSS, sidebar, cards, gráficos e arte do fluxo permaneceram iguais no Dashboard. Mudam os números, a data/identificação da decisão e as rotas animadas de energia. Na aba Inteligência, o componente GIE existente ocupa a posição anterior ao histórico, única adição estrutural necessária para mostrar ambos no mesmo painel; nenhuma nova página, aba, folha de estilo ou card foi criado.

| Estação | Antes | Depois |
| --- | --- | --- |
| Shopping, Dashboard | [antes](before-shopping-dashboard.jpg) | [cena 7](after-shopping-dashboard-scene-7.jpg) |
| Shopping, Inteligência | — | [cena 1](after-shopping-intelligence-scene-1.jpg), [cena 7](after-shopping-intelligence-scene-7.jpg) |
| Posto, Dashboard | [antes](before-posto-dashboard.jpg) | [após três ciclos](after-posto-dashboard-3-cycles.jpg) |
| Posto, Inteligência | — | [após três ciclos](after-posto-intelligence-3-cycles.jpg) |
| Residência, Dashboard | [antes](before-casa-dashboard.jpg) | [após três ciclos](after-casa-dashboard-3-cycles.jpg) |
| Residência, Inteligência | [antes](before-casa-intelligence.jpg) | [após três ciclos](after-casa-intelligence-3-cycles.jpg), [ano completo](after-casa-intelligence-year-2025.jpg) |

## Testes

- Frontend: `npm test` — **217/217**; inclui fluxo, perfis V3, isolamento, polling e retorno da aba visível.
- Backend: `npm test` com rede local disponível — **163 passaram, 8 ignorados, 0 falhas**; inclui teste WebSocket de isolamento e revogação. `npm run build` passou.
- Após reiniciar o conjunto no commit publicado, o Posto exibiu duas baterias independentes (BAT_01 60,8% e BAT_02 74,9% no ciclo de 01/10/2025 13:45), e a Residência exibiu um EVSE de 7 kW e nenhuma bateria no ciclo de 01/10/2025 17:15. O comparativo retornou 5.044 recargas atendidas, 86.334,61 kWh e R$ 188.706,71 simulados, incluindo R$ 434,72 residenciais.
- GIE comercial: `test_control.py` — **50/50**; exige 16 cenas únicas. Os outros testes no diretório incluem `test_dashboard.py`, que não roda no ambiente de serviço sem Streamlit.
- Next.js 16.3.8: build completo com `npx next build --webpack` passou, inclusive TypeScript e 18 páginas. O build padrão com Turbopack falhou internamente na etapa PostCSS (`creating new process`, processo Node encerrado com código 0), em sandbox e fora dele; não houve erro TypeScript nem CSS do projeto identificado.

## Limites observados

Após reiniciar o worker V3, o painel mostra “Aguardando estado da estação” até o primeiro ciclo de fixture explícito; o navegador então apresenta a decisão, carregadores e baterias. Não foi fabricado avanço temporal automático. A revalidação detectou um alerta resolvido no cenário de 2025 cujo horário antecedia a criação do registro local em 2026; o MySQL recusava a transição pelo `chk_alerts_resolution_time`. O Backend agora registra o instante em que recebeu a resolução no campo de ciclo de vida e mantém o horário original do cenário no payload GIE. O teste de regressão usa explicitamente essa data antiga. O relógio de saúde do GIE usa o instante atual a cada atualização do painel, evitando o aviso falso de horário indisponível quando a decisão chega após a montagem da página.

Este relatório documenta somente o ambiente local. A PR deve permanecer em rascunho; não autoriza merge, deploy ou migração oficial.

## Ajuste pontual da bateria do Posto — 17/10/2026

No contexto **Histórico demonstrativo · SIMULATED**, o indicador de bateria já existente na Visão geral do Posto agora lê BAT_01 e BAT_02 da decisão válida do cenário GIE V3 em execução. O rótulo identifica expressamente o cenário atual; o período histórico de dezembro/2025 continua a governar apenas os agregados MySQL. O código do card, sua posição e sua folha de estilo foram preservados; mudaram somente os textos e valores do indicador. [Antes](battery-overview-before.png), [depois](battery-overview-after.png) e [após avançar o GIE](battery-overview-cycle.png) foram capturados no mesmo navegador e viewport.

- Às 14:45 do cenário de 01/10/2025, a aba Inteligência e a Visão geral concordaram em BAT_01 **73,6%** e BAT_02 **79,5%**. Às 15:00, BAT_01 passou a **72,8%** nas duas abas; BAT_02 permaneceu em **79,5%** porque sua decisão do GIE não a alterou. Às 15:15, a Visão geral mostrou **71,4% / 79,5%**, com BAT_01 sempre antes de BAT_02. Os agregados do histórico de dezembro continuaram em 7.470,26 kWh solares, 3.421,08 kWh nos carregadores e 7.472,02 kWh no prédio.
- A operação real do Posto não mostrou SoC simulado; a Residência continuou a exibir **Sem bateria instalada** nos contextos real e demonstrativo; a Shopping manteve seus rótulos e comportamento original, inclusive **Sem SoC no dataset** no histórico.
- O teste automatizado cobre ordem inversa do inventário, dois ciclos com valores independentes, estação errada, worker offline, decisão ou estado visual inválido e SoC ausente mesmo com configuração inicial preenchida. Nesses casos, o par é indisponível e nenhum valor anterior é usado. Frontend: **217/217** testes; build Next.js com webpack, TypeScript e 18 rotas: **passou**. A gravação do cache `.next` exigiu a permissão local do ambiente de execução; não houve mudança no código para contorná-la.
