# Documento de alteração: dashboard do eletroposto

Data: 09/10/2026. Projeto: EMPS-Ecosystem-2026-10-07.
Status: implementado e verificado localmente; aprovação do grupo pendente.

## Objetivo e limites

Adaptar a organização visual do dashboard de detalhes de instalação do SEMS+ ao
eletroposto EMPS, preservando a imagem existente e as integrações operacionais.
O resultado aproxima a composição, a tipografia e os controles da referência;
não é uma reprodução dos dados, das regras comerciais ou de todos os recursos
proprietários do SEMS+.

Esta alteração modifica somente o frontend do site. Não altera código do backend,
GIE, aplicativo móvel, esquema MySQL, registros do banco, autenticação ou tarifas
comerciais. Nenhum commit, push, publicação ou migração foi executado nesta etapa.
O ecossistema local foi reiniciado para permitir a verificação. Alterações de
etapas anteriores já presentes no checkout foram preservadas e não fazem parte
do inventário abaixo.

## Inventário completo desta etapa

Todos os caminhos abaixo são relativos a `site/emps-site-main/frontend/`.

1. **Alterado: `app/dashboard/page.tsx`.** Aplica ao dashboard a fonte Poppins local
   já utilizada no formulário de instalações. Mantém o componente de seleção por
   perfil e não muda permissões ou rotas.
2. **Alterado: `components/dashboard/AdminDashboard.tsx`.** Substitui a antiga
   composição de indicadores, tabelas e gráfico pelo novo `StationDashboard`.
   Mantém carregamento pela API, tratamento de erro, proteção contra respostas
   antigas, atualização por eventos, intervalos de contingência e atualização
   dos carregadores. Reutiliza os controles GIE existentes e recusa estados GIE
   de outra instalação. O rótulo identifica a saída demonstrativa do motor.
3. **Criado: `components/dashboard/StationDashboard.tsx`.** Compõe cabeçalho da
   instalação, abas Dashboard/Dispositivos/Alarmes/Inteligência, clima, cena e
   diagrama, visão geral, contribuições ambientais, histórico, consumo e oito
   indicadores operacionais. Inclui filtro de sessões por ID/cliente/carregador e
   filtros de alarmes por texto, severidade, datas e situação. Os controles GIE
   permanecem montados mesmo com a aba Inteligência oculta. Data e período são
   compartilhados pelo histórico e pelos totais de consumo; não mudam o fluxo
   instantâneo. Não há edição ou criação de instalação nesta etapa.
4. **Criado: `components/dashboard/MonitoringChart.tsx`.** Implementa dois gráficos
   sincronizados para tarifas/SOC e potências assinadas, bandas de carga/descarga,
   picos, legendas selecionáveis, ampliação com saída por Escape, tabela de até
   500 leituras e CSV de todas as leituras carregadas. Também inclui energia
   diária, comparação da geração diária, potência dos carregadores e mapa de
   calor solar por hora. Não implementa o comparador avançado entre instalações
   ou períodos do SEMS+. As tarifas do exemplo são fictícias, não comerciais.
5. **Criado: `components/dashboard/EnergyDiagram.tsx`.** Acrescenta visualização
   alternativa com Solar/Rede/Prédio/Bateria/Carregadores e inversor central.
   Conexões usam a telemetria recebida, com sentido reverso para carga da bateria
   e exportação para a rede, preservando as decisões do GIE. Não cria alocação
   energética própria no site nem substitui a imagem do eletroposto.
6. **Criado: `components/dashboard/use-station-history.ts`.** Consulta o endpoint
   GET existente `/v2/stations/:id/telemetry/history` por intervalo UTC. Divide
   intervalos quando a resposta atinge 1.000 leituras, limita a busca a 24
   requisições e avisa quando o resultado é parcial. Cancela requisições ao mudar
   o intervalo ou desmontar. Não grava leituras.
7. **Criado: `components/dashboard/use-station-weather.ts`.** Consulta condições
   atuais do Open-Meteo com coordenadas da instalação arredondadas a duas casas,
   sem cookies ou credenciais. Usa prazo de oito segundos, cache e atualização
   de quinze minutos, tratamento de indisponibilidade e atribuição ao provedor.
   Temperatura e umidade medidas recentemente têm prioridade na interface.
   O clima não é enviado ao GIE nem modifica geração ou carregamento.
8. **Criado: `domain/station-monitoring.ts`.** Centraliza tipos, conversão numérica,
   datas no fuso da instalação, janelas de dia/semana/mês/ano, separação de fontes,
   normalização, qualidade, lacunas, integração kW para kWh, bandas de bateria,
   agregação diária e exemplo isolado de 289 pontos. Divide intervalos curtos que
   cruzam a meia-noite para não atribuir energia ao dia errado. O exemplo nunca
   é enviado à API ou persistido. Valores desconhecidos continuam nulos.
9. **Criado: `components/dashboard/station-dashboard.module.css`.** Estilização
   restrita ao dashboard: painéis escuros/claros arredondados, brilho interno
   discreto, proporção 2:1, controles compactos, tabelas com rolagem local,
   adaptação para telas pequenas e preferência de movimento reduzido. Inputs e
   selects móveis usam 16 px para evitar zoom automático no Safari.
10. **Criado: `tests/station-monitoring.test.cjs`.** Onze testes para dados ausentes,
    datas e fuso, horário de verão, duplicidade/qualidade, sinais da bateria,
    integração, lacunas, zero conhecido, fontes separadas, exemplo determinístico
    e divisão na meia-noite. Reutiliza o padrão de testes existente no projeto.

Documentação produzida: este arquivo e o relatório em PDF com capturas de tela.
Nenhuma dependência ou imagem de produção foi adicionada ou substituída.

## Fluxo de dados e regras de apresentação

- Cadastro e metadados: GET existente `/v2/stations/:id`.
- Indicadores, carregadores, sessões e alarmes: `api.dashboard()` existente.
- Fluxo instantâneo: estado GIE convertido por `energyFromGie`, com fallback da
  telemetria já disponível no dashboard. Modo demonstrativo é identificado.
- Gráficos: histórico separado por origem e proveniência; não mistura dados
  medidos, simulados e importados. Leituras ruins não geram valores válidos.
- Histórico ausente: estado vazio, não uma curva inventada. A opção explícita
  **Exemplo fictício** permite avaliar a curva completa de 08/10/2026.
- Bateria: campos separados de descarga/carga têm prioridade. Na alternativa
  assinada, positivo significa descarga e negativo significa carga; confirmar
  essa convenção com a equipe responsável pela ingestão física.
- Energia: integração trapezoidal somente com dois pontos conhecidos e distância
  de até vinte minutos. Lacunas não são preenchidas; resultado não é faturamento.
- Contribuições ambientais: permanecem `--` enquanto fatores não forem definidos.
- Tarifas de importação/exportação reais: permanecem ausentes, pois o contrato
  histórico consultado não contém essas informações. Preço cobrado ao motorista
  não é automaticamente tratado como custo de importação da rede.

## Verificação

- 75 testes do frontend passaram, sem falhas, incluindo onze novos testes.
- Build de produção Next.js concluído, com TypeScript e geração das páginas.
- Navegador: cena/diagrama, data 08/10, exemplo, gráficos, ampliação, legendas,
  tabela, consumo/fluxo, dispositivos, alarmes e inteligência conferidos.
- Tema claro e escuro conferidos. Tela de 390 x 844 verificada, sem rolagem
  horizontal global. Inputs móveis mantêm tamanho adequado.
- Não havia leituras históricas, sessões reais ou alarmes nessa instalação local:
  filtros com conjuntos reais não vazios ainda dependem desses dados.
- Serviços locais: site 3000, backend 3001, GIE 8510 e Expo 8081 iniciados.
  Isso não representa publicação em produção ou teste em dispositivo iOS físico.

## Pendências para aprovação e produção

Validar a identidade visual e o inventário; confirmar convenções de potência com
o backend/GIE; fornecer histórico físico e tarifas reais; definir fatores de
impacto ambiental; revisar termos, capacidade e licença comercial do provedor de
clima; validar alarmes e sessões com dados reais. O filtro de alarmes opera sobre
o conjunto retornado pelo dashboard existente, não sobre um histórico completo
de alarmes no servidor. Comparação avançada de períodos/instalações do SEMS+ não
está incluída. Os períodos são o calendário local da instalação, não últimos
sete/trinta dias móveis.

## Referências

- SEMS+ GoodWe: https://semsplus.goodwe.com/#/station_monitor
- Open-Meteo: https://open-meteo.com/en/docs
- Recharts e Lucide já existentes no projeto.

Responsável pela revisão: ____________________
Decisão do grupo / data: ____________________
Publicação autorizada: sim / não
