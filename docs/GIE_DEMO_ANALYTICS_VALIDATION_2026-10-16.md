# Validação da inteligência demonstrativa — 16/10/2026

Branch de trabalho: `feat/gie-demo-analytics-dashboard`, iniciada no commit
`4767813`, derivado de `c2053bb` (PR #3 atualizado). O commit `50cc7c5`
continua na ancestralidade.
Esta etapa usa exclusivamente o contêiner MySQL 8 descartável
`emps-demo-visual-mysql` em `127.0.0.1:3307`, com conta local. Nenhuma mudança
foi executada no banco oficial, Hostinger, GIE treinado, App Expo ou SubApp.

## Referência e alteração visual

Antes das edições, o navegador mostrou a página da rede e as vistas de
Shopping, Posto e Residência no mesmo viewport compacto. Na operação real, a
Visão geral mostrava vários campos “Sem dados”; o contexto SIMULATED substituía
o painel inteiro por uma seção de histórico. Depois do reinício integrado, os
três dashboards SIMULATED foram abertos no navegador com API e MySQL locais.
As capturas de antes e depois foram observadas na sessão de navegador, **mas
não foram salvas como arquivos**; portanto não há comparação de pixels
reproduzível anexada. A comparação estática com o commit anterior não mostra
alterações em CSS, imagens, assets ou classes visuais. Na operação real, a
grade, as abas e os cards mantêm a mesma estrutura. O contexto SIMULATED agora
alimenta esses componentes e a seção detalhada ocupa a aba **Inteligência** já
existente. Como antes ele abria uma seção separada, a organização desse
contexto mudou e não se pode declarar identidade de pixels em todos os estados.

## Reinício local controlado

O `stop-demo-visual.ps1` foi examinado e executado primeiro com `-WhatIf`.
Depois, sua execução autorizada encerrou somente os processos registrados e
identificados do Frontend (PID 952), GIE legado (PID 11644) e GIE v3
(PID 31892). O script não encerra o MySQL. O contêiner e seus dados locais
permaneceram intactos. O `start-demo-visual.ps1` concluiu: verificou o
contêiner MySQL 8 local e o schema oficial com os patches locais 0001, 0002 e
0003; as três importações responderam `created:false`, sem duplicar os lotes;
GIE v3, GIE legado, Backend e Frontend ficaram ativos. O login administrativo
local `visual.local@emps.invalid` funcionou sem usar conta da Hostinger.

A rota local autenticada `/v1/health` do GIE v3 respondeu `status:ok`,
`origin:SIMULATED` e `physical_dispatch:false`. Os três workers
`Commercial_HighAutonomy_V2`, `DEMO_CASA_001` e `DEMO_POSTO_24H_001`
responderam `status:running`, `error:null` e `physical_dispatch:false`. O
`/health` do GIE legado respondeu `status:ok`, `station_id:1` e
`hardware_confirmed:false`.

O MySQL desse teste usa volume anônimo e contêiner Docker `--rm`. Os scripts de
parada preservam o contêiner, mas seus dados são **descartáveis**: parar/remover
o contêiner por outro meio pode perder o volume e exigir recriar/importar o
ambiente. Isso não afeta nenhum banco oficial.

## Fontes e reconciliação local

| Fonte | Período | Leituras únicas de 15 min | Tentativas / atendidas | Energia EV por intervalos |
| --- | --- | ---: | ---: | ---: |
| Shopping Frei Caneca | jan–jun/2026 | 17.376 | 5.477 / 2.917 | 46.082,44141781 kWh |
| Posto 24h | 2025 | 35.040 | 2.289 / 2.085 | 39.495,743930407 kWh |
| Residência | 2025 | 35.040 | 42 / 42 | 756,4236898174 kWh |

As diferenças para as somas de energia das sessões originais são menores que
`3 × 10⁻⁷ kWh`, devidas ao arredondamento dos CSVs. Para o ano inteiro, a
consulta analítica respondeu em 361 ms (Shopping), 798 ms (Posto) e 445 ms
(Residência) no banco local. Solar: indisponível na Shopping, 75.464,7779918946
kWh no Posto e 8.301,1255791069 kWh na Residência. Importação **medida** da
rede: indisponível nas três fontes. O proxy hipotético calculado por intervalo
é 75.663,4178614345 kWh no Posto e 2.732,9181542178 kWh na Residência;
não é medição nem economia comprovada. Ocupação histórica média:
38,03% / 29,31% / 4,10%. Intervalos com fila: 3.405 / 1.021 / 0.

O cenário financeiro residencial `residential-owner-visitor-v2` reutilizou as
42 sessões originais: 32 usos próprios, sem receita, e 10 visitas, com
R$ 434,72 de receita simulada. O custo energético estimado das visitas é
R$ 158,08 e a margem de contribuição estimada R$ 276,64. O custo estimado do
uso próprio é R$ 447,05; após todo custo EV, o resultado é R$ −170,41 antes
dos demais custos, **não lucro líquido**. Duas reimportações não duplicaram
leituras, sessões ou linhas da camada v2. Os pagamentos v1 residenciais foram
preservados para proveniência, mas a API ativa não os soma na receita v2.

## Testes executados

- Backend: `npm run build` e `npx tsc --noEmit` passaram; 15 testes focados
  de analytics, API, cenário residencial, filtros e isolamento passaram.
- Frontend: `npx tsc --noEmit` e 213 testes passaram. Dois testes novos
  verificam escopo/autorização do endpoint analítico e uso de kWh exatos sem
  reintegrar médias de potência.
- Suite ampla anterior do Backend: 161 passaram, 8 ignorados, 1 falhou no
  transporte WebSocket sob sandbox (`websocket error` onde esperava
  `Não autorizado`). O teste específico foi repetido com loopback local
  autorizado por `npx tsx --test tests/realtime.integration.test.ts` e passou
  **1/1**. A suite ampla não foi repetida nesta rodada.
- Build completo de produção do Next.js: passou com
  `EMPS_LOCAL_PREVIEW=true` e `npm run build -- --webpack`, inclusive a
  verificação TypeScript e a geração de **18 páginas**. A saída isolada
  `.next-remote-preview` não conflitou com o servidor de desenvolvimento.
- `git diff --check` e análise sintática dos scripts PowerShell passaram.

## Verificação no navegador e reconciliação

O navegador em `http://127.0.0.1:3000` acessou a rede e os três dashboards
SIMULATED. Shopping preserva o período original de janeiro a junho de 2026;
Posto e Residência preservam 2025. Fluxo energético, Visão geral, gráficos,
histórico, sessões e financeiro demonstrativo foram percorridos sem deslocar
os registros para a data corrente.

| Vista/filtro | Sessões atendidas | Energia EV | Receita simulada |
| --- | ---: | ---: | ---: |
| Shopping, jun/2026 | 504 | 7.792,64 kWh | R$ 17.143,83 |
| Posto, dez/2025 | 187 | 3.421,08 kWh | R$ 7.526,42 |
| Residência, 2025 | 42 | 756,42 kWh | R$ 434,72 apenas de visitantes |
| Rede, períodos de cada fonte | 5.044 de 7.808 tentativas | 86.334,61 kWh | R$ 188.706,71 |
| Rede, apenas 2025 | 2.127 | 40.252,17 kWh | R$ 87.325,40 |
| Rede, filtro Pix | 1.750 | — | R$ 64.812,42 |

Na rede inteira, Shopping contribui 2.917 sessões / 46.082,44 kWh /
R$ 101.381,31, Posto 2.085 / 39.495,74 kWh / R$ 86.890,68 e Residência
42 / 756,42 kWh / R$ 434,72. Shopping aparece com zero em 2025, conforme a
origem de 2026. No Posto em dezembro, os carregadores EVSE01 e EVSE02 mostram
127 e 60 sessões, somando 187. Os filtros de canal e método foram aplicados
no navegador: App/cartão de crédito retornou 1.007 recargas e R$ 38.228,43;
Web/cartão de débito, 320 e R$ 12.486,08; Caixa/dinheiro, 615 e
R$ 23.122,46; Pix, 1.750 e R$ 64.812,42. Os filtros foram limpos ao final.

A discrepância inicial dos cards de carregadores da Shopping foi corrigida e
revalidada visualmente após a atualização local do Frontend. Em junho de 2026,
os quatro agrupamentos demonstrativos somam exatamente as 504 sessões,
7.792,64 kWh e R$ 17.143,83 exibidos no resumo da estação:

| Carregador demonstrativo Shopping | Sessões | Energia EV | Receita simulada |
| --- | ---: | ---: | ---: |
| AC_01 | 154 | 2.253,72 kWh | R$ 4.958,23 |
| AC_02 | 126 | 1.907,42 kWh | R$ 4.196,32 |
| AC_03 | 108 | 1.913,49 kWh | R$ 4.209,65 |
| AC_04 | 116 | 1.718,01 kWh | R$ 3.779,63 |

Essa atribuição limita-se às prévias históricas `LOCAL_ONLY_SHOPPING`. Ela não
altera o cadastro nem o mapa físico dos carregadores comerciais da Shopping.

Na Residência, as 42 sessões originais se dividem em **32 recargas próprias
sem receita** e **10 recargas de visitantes com R$ 434,72**. O custo energético
estimado das vendas é R$ 158,08 e a margem de contribuição estimada é
R$ 276,64. O custo de uso próprio é R$ 447,05; após toda energia EV, o
resultado é R$ −170,41 antes dos demais custos, sem indicação de lucro
líquido. O carregador residencial de 7 kW aparece cadastrado e `PENDING`, sem
afirmação de disponibilidade física. A página de pagamentos operacionais
retornou zero resultados e não exibiu receitas demonstrativas.

## Pendência para aceite visual

As capturas comparáveis de antes/depois no mesmo viewport, estação e contexto
não foram salvas como arquivos. A inspeção estática e as observações no
navegador não equivalem a uma comparação automática de pixels. Esta limitação
deve permanecer explícita na PR em rascunho; o aceite visual final cabe ao
proprietário antes de qualquer implantação.
