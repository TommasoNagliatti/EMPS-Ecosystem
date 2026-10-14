# CR-2026-10-12-004 - Dashboard, graficos e avisos

Data: 2026-10-12. Estado: implementado e verificado localmente; aguardando revisao do grupo.
Referencia: EMPS-FRONT-01 v1.0, especificacao recebida em PDF nesta data.
Base Git: `ccef3c9327cb6915b8af4bbf103c53a4b73a4de6`, preservando as alteracoes
locais anteriores, inclusive CR-2026-10-12-003. Nenhum commit, push ou deploy nesta entrega.

## Escopo e comportamento

- Preservados imagem, renderizador, perspectiva, cabos, overlays e proporcoes do fluxo
  de energia. Nenhuma troca de imagem, logo, fonte, menu ou identidade visual.
- Visao geral compactada em seis indicadores: energia solar, energia dos carregadores,
  importacao da rede, SoC atual, consumo do predio e disponibilidade/uso atual.
- Energia historica continua calculada por integracao de leituras validas, identificada
  como estimativa; lacunas nao recebem zeros inventados. SoC atual so aparece quando
  valido e recente. Disponibilidade atual nao e apresentada como indicador historico.
- O card de ambiente deu lugar a "Avisos e acoes do GIE": ate tres alertas existentes,
  ordenados por data, com horario, gravidade, origem e fase quando fornecida pelo backend.
  "Ver todos" abre a aba de alarmes existente. O detalhe usa dialogo com animacao suave.
- Nao sao criados eventos a cada consulta nem acoes executadas a partir de mensagens de
  estado. Sem registros do GIE, o historico de acoes aparece indisponivel. Fonte simulada
  e identificada explicitamente; o relogio do replay isolado nao vira telemetria real.
- Um grafico principal substitui os graficos auxiliares de tarifa/SoC e os dois aneis de
  consumo. Potencia usa apenas kW e inicia com solar, predio e carregadores. Rede e bateria
  ficam opcionais na legenda. Monitoramento de energia usa barras estreitas, em kWh.
- Permanecem filtros de periodo/data, fonte, comparacao, tabela, CSV e ampliacao. Tooltip,
  tabela e CSV incluem fonte/qualidade e fuso. Escape fecha a tabela sem recolher o grafico.
- CSV escapa textos que poderiam ser interpretados como formulas de planilha. Valores
  numericos negativos validos continuam numericos.
- O mapa de calor representa energia agregada dos carregadores, nao ocupacao. Sem medicao
  individual, a aba de carregadores informa essa limitacao; setpoint nao vira medicao.
- O card "Receita e margem - hoje" usa registros financeiros da resposta consolidada
  existente. Receita recebida e faturado em aberto ficam separados. Custo energetico e
  margem operacional permanecem "A calcular" porque nao existe apuracao validada recebida.
- A faixa inferior resume sessoes ativas, ocupacao atual, disponibilidade e ticket de
  sessoes encerradas. Nao repete a receita. Layout reorganizado para telas menores.

## Criterios de dados e calculo

1. O dia financeiro segue o fuso da instalacao, nao o dia UTC ou o fuso do computador.
2. Receita soma somente pagamentos `APPROVED` com data de pagamento de hoje, nao futura,
   valor confirmado nao negativo e identificador estavel. `PENDING`, `DECLINED` e
   `REFUNDED` nao entram. Duplicatas por ID sao consolidadas; soma em centavos inteiros.
3. Faturado em aberto soma sessoes `FINISHED`, encerradas hoje, com valor confirmado e
   pagamento `PENDING` ou `DECLINED`. Nao equivale a dinheiro recebido.
4. Colecoes completas e vazias podem resultar em zero. Contrato incompleto, status/data/
   valor essencial ausente ou invalido resulta em indisponibilidade, nao em falso zero.
5. A completude so e assumida para `/dashboard/panel` com ambas as colecoes recebidas.
   O caminho alternativo legado nao permite afirmar totais financeiros completos.
6. O horario exibido conserva o instante real da consulta, inclusive ao reutilizar cache.
   Confirmacao com mais de cinco minutos e sinalizada como atualizacao pendente.
7. Custos, tarifas, economia, lucro liquido e margem nao sao estimados no frontend.
   O total recebido e um resumo dos estados atuais retornados, nao um livro contabil
   de estornos parciais ou movimentacoes financeiras historicas.
8. Alertas usam escopo de instalacao, quando informado, e a autorizacao da API existente.
   Fases so sao mapeadas quando explicitamente presentes no contrato. Datas ausentes nao
   sao substituidas pelo horario atual. Registros futuros/incompletos nao entram no feed.
9. GIE offline, atualizado, sem atualizacao e replay isolado possuem estados distintos.
   Horario invalido/futuro nao e tratado como confirmacao real de funcionamento.

## Inventario completo desta alteracao

Os 12 arquivos abaixo pertencem a `site/emps-site-main/frontend/`.

| Arquivo | Mudanca |
|---|---|
| `components/dashboard/StationDashboard.tsx` | Nova composicao, seis indicadores, feed, financeiro e faixa operacional; remove aneis redundantes; mantem imagem e abas. |
| `components/dashboard/AdminDashboard.tsx` | Encaminha o estado do GIE ja consultado para o painel; nenhuma nova consulta. |
| `components/dashboard/MonitoringChart.tsx` | Grafico unico, tres curvas iniciais, series opcionais, fonte/qualidade, mapa de calor de energia, CSV seguro e Escape do dialogo. |
| `components/dashboard/station-dashboard.module.css` | Dimensionamento compacto, feed, financeiro, estados, responsividade e continuidade das animacoes suaves. |
| `components/dashboard/StationNotices.tsx` (novo) | Feed de alertas, estado do GIE, vazio honesto, acesso a alarmes e dialogo de detalhes. |
| `components/dashboard/StationFinancialSummary.tsx` (novo) | Resumo financeiro de hoje, horarios/fuso, valores desconhecidos e link de pagamentos. |
| `domain/emps.ts` | Campos opcionais de origem/fase/modo/instalacao de alerta; contrato de registros financeiros e horario da resposta. Nao sao colunas de banco. |
| `domain/station-insights.ts` (novo) | Funcoes puras para totais, selecao de avisos e saude/fonte do GIE. |
| `domain/station-monitoring.ts` | Conserva fonte e qualidade de leituras; marca lacunas como ausentes. |
| `services/emps-mappers.ts` | Mapeia origem/fase explicita, datas opcionais e valores financeiros sem inventar data ou zero. |
| `services/emps-api.ts` | Marca completude apenas na resposta consolidada e preserva horario real do cache. Transporte e autorizacao existentes mantidos. |
| `tests/station-insights.test.cjs` (novo) | 15 testes de calculo, fuso, estados, origem, lacunas, renderizacao, series, Escape e CSV. |

Documentacao: este registro e o indice `docs/README.md`. PDF e capturas de verificacao
ficam em `output/`, ignorado pelo Git, por conterem dados de operacao local autorizada.
Nao foram alterados dependencias, arquivos de lock ou manifesto historico de publicacao.
Os 12 arquivos foram sincronizados com a copia ativa e tiveram hashes conferidos.

## Verificacao

| Verificacao | Resultado |
|---|---|
| Testes do frontend | 166 aprovados, zero falhas; 15 casos novos nesta entrega. |
| Build otimizado | Compilacao, verificacao TypeScript e geracao de rotas aprovadas. |
| Testes da estrutura | 5 aprovados. |
| Higiene do diff | `git diff --check` sem erros, somente avisos de terminador de linha Windows. |
| Publicacao | Regras locais sem sinal bloqueante; nao substituem auditoria de seguranca. |
| Desktop | Tres curvas iniciais, alternancia de rede/bateria, barras, periodo, fonte, ampliacao e tabela conferidos. |
| Teclado | Escape fecha a tabela mantendo o grafico ampliado; depois pode recolher o grafico. |
| Alarmes e pagamentos | "Ver todos" acessa a aba de alarmes; link financeiro acessa `/payments`. |
| Mobile e tablet | Viewports 390x844 e 768x1024; sem rolagem horizontal da pagina nos limites DOM inspecionados. |
| Console final | Sem erros capturados na amostra inspecionada apos o reinicio. |

Fixtures verificam pagamentos pendentes/recusados/estornados, fuso, dados ausentes,
duplicatas, valores em centavos, escopo de alertas, fases nao inferidas, GIE offline/
atrasado/simulado, horario futuro, lacunas e protecao CSV. Nenhum registro oficial foi
modificado para produzir esses cenarios. A instalacao inspecionada nao tem historico
energetico/avisos reais suficiente para todos os estados: curvas completas foram
conferidas com o exemplo ficticio existente, somente em memoria e identificado na tela.
O dialogo com alerta real, exportacao baixada, iPhone fisico, carga concorrente e todos
os perfis reais nao foram exercitados nesta entrega. Nao ha script de lint configurado.

## Limites, impacto e pendencias

- Nenhum codigo-fonte do backend, GIE Python, app movel ou SQL foi alterado.
- Nenhuma migration, seed, esquema, indice, permissao, senha ou registro do banco foi alterado.
- Banco oficial permaneceu somente leitura pelo tunel existente; replay do GIE isolado.
- Apenas processos locais gerenciados foram reiniciados e o inicializador existente
  recompilou o backend local. Nenhum servico da VPS foi reiniciado ou publicado.
- Nenhum novo endpoint, comando de carregamento ou acesso direto a MySQL/Python no browser.
- Pendente: contrato backend validado para custo energetico e margem; historico persistido
  de eventos/acoes do GIE com antes/depois, motivo e confirmacao de execucao; medicao
  historica por carregador. Interface nao declara esses recursos como concluidos.
- Simulador financeiro historico P2 esta fora desta entrega. O painel nao substitui
  conciliacao financeira, integracao de hardware ou auditoria operacional.

## Revisao e reversao

Revisar este conjunto de 12 arquivos e os dois documentos antes de publicar. Para
reverter, retirar somente o diff desta CR usando uma copia aprovada do estado anterior
ao upgrade. Preservar a CR-003 e demais mudancas locais. Nao usar reset do workspace
inteiro contra HEAD, pois isso removeria trabalho anterior ainda nao commitado.
Nao ha rollback de banco ou migration. Publicacao depende de aprovacao do grupo e
pedido explicito; esta entrega permanece local.
