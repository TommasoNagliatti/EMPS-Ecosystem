# Alteração: ocupação dos cards do dashboard

Data: 09/10/2026. Aprovação do grupo: pendente.
Referência visual consultada: dashboard de detalhes de instalação do SEMS+.

## Pedido

Eliminar o espaço vazio na Visão geral, organizar melhor os cards da direita e
retirar frases explicativas sobre valores ilustrativos de dentro dos painéis.

## Arquivos alterados nesta etapa

Caminhos relativos a `site/emps-site-main/frontend/`:

1. `components/dashboard/StationDashboard.tsx`
   - Cabeçalho da Visão geral reúne título, ícone de informação, data e período.
   - Remove a identificação repetida de exemplo e o parágrafo explicativo desse
     card. A identificação continua no seletor de fonte, fora dos painéis.
   - Remove o rodapé textual das contribuições ambientais; os valores sem fator
     configurado continuam `--` e a informação está no tooltip existente.
   - Substitui o texto de origem do card de consumo por data e período compactos.
   - Remove o parágrafo explicativo do card de consumo.
   - Move o total para o centro do anel; adiciona percentuais nas duas laterais.
     Cada percentual é a participação no par mostrado: valor / (a + b) * 100,
     com uma casa decimal. Não representa despacho físico ou faturamento.
   - Percentuais não são calculados quando faltam dados ou o total é zero.
     Totais desconhecidos continuam `--`; não são substituídos por zero.
2. `components/dashboard/MonitoringChart.tsx`
   - Remove a frase explicativa repetida do cabeçalho do gráfico quando a fonte
     selecionada é o exemplo. Para fontes reais, mantém o nome da origem.
   - Mantém identificação de exemplo na tabela de leituras e no CSV, bem como no
     seletor de fonte externo. Não muda séries, histórico, cálculo ou controles.
3. `components/dashboard/station-dashboard.module.css`
   - Visão geral passa a ser uma coluna flexível com grade interna expansível,
     duas colunas e três linhas de altura uniforme.
   - Indicadores centralizados: ícone acima, valor/unidade e rótulo abaixo.
     Valores usam 23 px em telas maiores e 20 px nas menores; mínimo de 85 px por
     linha, espaçamento de 12 px e rótulos com quebra natural.
   - Cabeçalho compacto com quebra de linha para telas estreitas.
   - Contribuições ambientais com três indicadores alinhados e mínimo de 90 px
     por indicador, sem rodapé que aumentava a altura do card.
   - Seções de consumo centralizam o conteúdo na altura disponível, com divisor
     discreto entre os dois anéis. Total é posicionado dentro do anel; valores
     longos usam tamanho menor. Percentuais ficam abaixo das energias laterais.
   - Controle de data do gráfico fica alinhado à direita mesmo sem a frase
     explicativa. Preserva tema claro/escuro, estilos locais e movimento reduzido.

## Escopo preservado

Sem alteração no backend, GIE, aplicativo móvel, banco, API, autenticação, tarifas,
telemetria, regra de distribuição de energia ou imagem do eletroposto.
Nenhuma dependência nova, commit, push ou publicação executada. Alterações de
etapas anteriores no checkout foram preservadas.

Os totais mostrados nas capturas provêm da fonte de exemplo já existente. A
identificação deixa de se repetir dentro dos cards, mas o seletor externo mantém
`Exemplo fictício`; dados de demonstração não são apresentados como medição real
no histórico ou nos arquivos exportados.

## Validação

- 75 testes existentes do frontend passaram; nenhuma falha.
- Build de produção Next.js com TypeScript concluído.
- Desktop: seis valores alinhados em três linhas, posições verticais verificadas
  em 356, 480 e 603 px no viewport utilizado.
- Exemplo: abastecimento 47,8% / 52,2%; consumo 21,9% / 78,1%.
- Fonte sem histórico: energias, totais e percentuais continuam desconhecidos.
- Mobile 390 x 844: largura do documento 380 px, sem rolagem horizontal global;
  card de consumo com 352 px e nenhum elemento textual excedendo a própria área.
- Imagem, navegação de abas e seleção de fonte preservadas.

Documento ilustrado: `output/pdf/EMPS_ALTERACAO_CARDS_DASHBOARD_2026-10-09.pdf`.
Referência: https://semsplus.goodwe.com/#/station_monitor
