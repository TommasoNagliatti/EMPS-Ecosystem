# Alteração: gráficos de monitoramento do eletroposto

Data de conclusão: 10/10/2026. Trabalho iniciado em 09/10/2026.

Projeto: `EMPS-Ecosystem-2026-10-07`, clone do novo ecossistema. Esta entrega não altera o projeto anterior.

## Pedido e referência

Refinar os gráficos do dashboard com base no painel autenticado do SEMS+, principalmente as barras excessivamente largas quando há poucos dias com leituras. Foram inspecionadas as visualizações de curva de potência, monitoramento de energia, comparação de geração, carregador e mapa de calor. A referência foi consultada no navegador; seus dados não foram importados para a instalação EMPS.

Referência: https://semsplus.goodwe.com/#/station_monitor/station_detail

## Resultado

- Barras limitadas a 8 px no desktop, com intervalo de 1 px entre séries e topo discretamente arredondado. A largura não cresce para preencher um período com poucos dados.
- Energia em sete séries: geração solar, consumo do prédio, carga e descarga da bateria, exportação e importação da rede e carregadores. As legendas permitem ocultar e mostrar cada série.
- Calendário completo do período no eixo: horas para dia; dias para semana/mês; doze meses para ano. Intervalos sem leituras permanecem ausentes, e zero medido continua sendo zero.
- Comparação da geração com o período anterior, em dourado e roxo, alinhada pela posição no calendário. O ano compara os meses dos dois anos; o mês compara os dias dos dois meses.
- Mapa de calor em calendário de segunda a domingo, energia solar diária em verde e dias sem leituras em cinza.
- Carregadores: curva de potência em kW no dia e energia acumulada em kWh nos períodos maiores. A informação é agregada por instalação, não individualizada por conector.
- Tabela e CSV usam os dados e as unidades da visualização selecionada. Campos desconhecidos ficam vazios no CSV. O exemplo visual continua identificado e isolado dos dados da instalação.
- Menu de período permanece clicável com o gráfico ampliado. A tabela abre com transição curta e respeita a preferência de movimento reduzido.

## Inventário exato desta entrega

Os caminhos abaixo são relativos a `site/emps-site-main/frontend/`. Os arquivos já continham alterações de entregas anteriores; esta relação descreve somente o incremento dos gráficos.

### `domain/station-monitoring.ts`

Adiciona a definição das sete séries de energia, os tipos `EnergyKey` e `EnergyBucket`, e as funções `energyBuckets`, `previousMonitoringWindow` e `compareGeneration`.

`energyBuckets` monta os intervalos do calendário no fuso da instalação, ordena as amostras, recorta intervalos nas fronteiras de hora/dia/mês e distribui energia por integração das leituras. Não interpola lacunas maiores que vinte minutos. Mantém desconhecido distinto de zero, separa os sinais de carga/descarga e importação/exportação e respeita dias com mudança de horário de verão. As funções preexistentes `integrate`, `summarize`, normalização e demonstração não tiveram suas fórmulas alteradas.

### `components/dashboard/StationDashboard.tsx`

Calcula a janela anterior e consulta o endpoint já existente de histórico somente na comparação de geração, quando não estiver no exemplo. Escolhe a mesma origem e proveniência nos dois períodos para não misturar dados medidos e simulados. Reposiciona o exemplo no calendário selecionado e fornece os dados anteriores, carregamento, erro e aviso de resultado parcial ao gráfico.

Define o período inicial de cada visualização: dia para potência/carregadores, semana para energia, ano para comparação e mês para mapa de calor. A troca de período conserva o modo de exemplo; a demonstração continua preenchendo apenas um dia, sem fabricar uma semana ou um ano de histórico. Os controles compartilhados de data da visão geral, histórico e consumo continuam sincronizados.

### `components/dashboard/MonitoringChart.tsx`

Substitui os dados de barras por agregação com calendário completo; limita a largura e o espaçamento das barras. Acrescenta sete totais/legendas em energia, séries anterior/atual na comparação e tooltips com data, cor, valor e unidade. Remove a faixa de picos das visualizações que não são curva de potência. Mantém as duas curvas de potência, suas legendas e faixas da bateria.

Atualiza o mapa de calor para calendário diário verde. Ajusta a visualização de carregadores às unidades disponíveis. Adapta tabela e exportação ao gráfico selecionado, preservando células desconhecidas e identificação da origem. Mantém carregamento, erro, histórico vazio, limite de 500 linhas exibidas e CSV com todas as linhas carregadas. Acrescenta ícone na aba ativa e rolagem interna do gráfico quando necessária.

### `components/dashboard/station-dashboard.module.css`

Ajusta alinhamento da aba ativa, dimensões desktop/celular, rolagem interna, legendas e contraste dos tooltips. Impede que o contêiner das barras seja comprimido pelo layout flexível e corte as datas do eixo; reduz a altura do gráfico ampliado no celular para acomodar suas legendas. Define a camada do menu de período acima do gráfico ampliado. Acrescenta grade/escala do calendário, estado sem leitura e estilos da tabela com animação curta e alternativa para movimento reduzido. Não altera CSS da lateral, autenticação, mapa geográfico ou imagem do eletroposto.

### `tests/station-monitoring.test.cjs`

Acrescenta sete testes comportamentais: calendário vazio completo; conservação de energia ao dividir uma hora; doze meses no ano; zeros/lacunas/importação-exportação; recorte nas fronteiras sem dupla contagem; dia de 23 horas; alinhamento e ausência de valores na comparação anterior. A largura e o menu foram conferidos no navegador, sem depender de um teste que apenas reproduza a estrutura do CSS.

### Documentação e recursos temporários

- Este registro e `output/pdf/EMPS_ALTERACAO_GRAFICOS_2026-10-10.pdf` documentam o incremento.
- Capturas de referência, estado anterior e resultado foram usadas no PDF. O exemplo é explicitamente identificado nas imagens.
- Um componente de teste temporário em `/chart-qa` foi removido antes do build final. A conferência final também foi feita no dashboard autenticado real.
- O gerador do relatório fica em `tmp/pdfs/build-chart-report.py`, fora do código do site.

## Verificação executada

- 104 testes do frontend aprovados; zero falhas.
- Build Next.js concluído e verificação TypeScript aprovada.
- Entrada autenticada local, lista da instalação e dashboard conferidos.
- API de saúde respondeu `status: ok`, `database: mysql`.
- Consultas reais ao histórico da instalação retornaram HTTP 200 para dia, ano atual e ano anterior. Como a instalação não tinha leituras históricas na origem selecionada, o estado vazio foi preservado. Nenhuma telemetria foi inserida para preencher o gráfico.
- Desktop 1543 x 878: sete barras com 8 px no exemplo semanal; legenda de série, tabela, exportação CSV, troca de período, comparação e calendário conferidos.
- Celular 390 x 844: página com largura de rolagem igual a 390 px; barras do exemplo com 3 px e rolagem contida no gráfico/controles. Teste em Chrome com viewport móvel, não em um aparelho físico ou Safari.
- Tabela mensal com 31 intervalos; CSV com sete séries em kWh e valores desconhecidos vazios.

## Limites e diferenças intencionais

Não é uma reprodução integral de todos os módulos do SEMS+. Esta entrega aproxima as cinco visualizações do dashboard e adapta os indicadores ao eletroposto.

Continuam disponíveis dia, semana, mês e ano. Os modos `All`/`Customize`, a tela externa `Data Comparison`, os controles de filtro mínimo/máximo do mapa de calor e a seleção individual de carregador não foram implementados nesta entrega. A API consultada fornece o agregado da instalação. A série de autoconsumo da referência não foi inventada: foi usado o indicador existente de energia dos carregadores. O calendário mantém todo o período, inclusive dias ainda sem leituras.

Os valores em kWh são estimativas obtidas por integração do histórico de potência disponível. Não constituem novo medidor fiscal nem substituem o fechamento financeiro. O exemplo fictício é apenas uma visualização local, sem gravação ou envio ao GIE. A curva diária de carregadores usa kW porque essa é a medida temporal disponível.

## Escopo preservado

Nesta entrega não foram alterados código do backend, schema/migrações MySQL, GIE, aplicativo móvel, autenticação, permissões, tarifas, variáveis de ambiente, dependências ou imagem do eletroposto. Não foram editados cadastros ou gravadas leituras históricas. O teste de login usou a autenticação normal já existente.

O backend possui alterações acumuladas de entregas anteriores na listagem de instalações; elas não fazem parte deste incremento. Nenhuma alteração anterior foi revertida. Não houve commit, push ou publicação em hospedagem nesta entrega.

## Execução local

Em 10/10/2026, o inicializador existente do novo clone colocou em execução o site (`http://localhost:3000/stations`), a API (`http://localhost:3001/auth/health`) e o GIE (`http://127.0.0.1:8510`). O backend usa MySQL na porta local 3307, container `emps-ecosystem-2026-mysql`. Os containers dos projetos anteriores foram preservados. O aplicativo móvel não foi iniciado nesta retomada.

Registro de inicialização: `site/emps-site-main/backend/reports/launch-charts-2026-10-10.log`.

Status: alterações locais para revisão do grupo. A hospedagem pública não foi atualizada.
