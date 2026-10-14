# Previsão do tempo e abertura suave dos pop-ups

Data: 09/10/2026. Status: alteração local, aguardando aprovação do grupo.

Projeto: `<PASTA-LOCAL-DO-PROJETO>`.
Todos os caminhos de código abaixo partem de `site/emps-site-main/frontend`.

## Pedido e resultado

Adicionar ao clima do dashboard um pop-up inspirado no SEMS+, com temperatura,
mínima/máxima, umidade, vento, amanhecer, pôr do sol e hoje mais quatro dias.
Suavizar a abertura dos pop-ups do site, mantendo o efeito aprovado do menu EMPS.

O botão de clima abre por hover, clique ou teclado. A seleção de um dia modifica
os detalhes sem fechar o painel. Hoje apresenta temperatura/umidade de sensores
locais recentes quando disponíveis; os demais dados vêm do Open-Meteo. Nos dias
futuros são apresentados intervalo de temperatura, vento máximo e umidade média,
sem inventar uma temperatura instantânea futura. O botão de fechar, Escape,
clique fora e retorno de foco permanecem disponíveis.

## Inventário exato desta alteração

1. **Novo `domain/station-weather.ts`:** tipos StationWeather/WeatherDay; validação
   de coordenadas; chave por latitude/longitude aproximadas e fuso; montagem da
   consulta; tratamento da resposta desconhecida; conversão de segundos Unix
   para milissegundos; datas no fuso da instalação; classificação e nomes WMO
   em português. Exclui dias passados, inválidos e repetidos; ordena e limita a
   cinco dias. Valores ausentes continuam null; umidade fora de 0..100, vento
   negativo e códigos desconhecidos são descartados; mínima maior que máxima
   não é exibida. O horário atual inválido rejeita a resposta.
2. **Alterado `components/dashboard/use-station-weather.ts`:** recebe também o
   fuso e retorna `{weather, loading, error, refresh}`. A consulta existente de
   clima passa a pedir current + daily, cinco dias, Celsius e km/h. Cache por
   localização/fuso por 15 minutos, atualização periódica e atualização manual.
   Timeout de 8 segundos, AbortController, limpeza de intervalo, bloqueio de
   respostas antigas depois de trocar a instalação ou desmontar o componente.
   Requisição sem credenciais; coordenadas arredondadas a duas casas decimais.
   Falhas e localização inválida recebem estados próprios, sem dados fictícios.
3. **Novo `components/dashboard/WeatherPopover.tsx`:** botão meteorológico,
   ícones Lucide para condições e dia/noite; conteúdo de hoje/futuro; quatro
   métricas; cinco seletores de dia; link do provedor e horário da leitura;
   atualizar, carregando, erro, ausência de previsão diária e tentar novamente.
   Sensor local recente conserva a prioridade para temperatura e umidade de hoje.
4. **Novo `components/dashboard/weather-popover.module.css`:** composição
   compacta de 472 px limitada à janela; resumo + grade 2 x 2 + linha de dias;
   cores discretas, estados selecionado/hover/foco, temas claro/escuro;
   adaptação móvel abaixo de 480 px; carregamento sem giro em movimento reduzido.
5. **Alterado `components/dashboard/StationDashboard.tsx`:** integra o novo
   componente e a assinatura do hook. Mantém umidade, vento, cidade, provedor e
   atualização GIE na barra existente. Não altera cards, histórico, regras de
   despacho, estado de carregadores ou imagem da cena.
6. **Alterado `components/ui/Popover.tsx`:** hover espera 140 ms; passagem até o
   painel mantém tolerância de 150 ms já existente; clique não tem espera
   artificial. Clique/teclado fixam a abertura até fechar, Escape ou interação
   externa; sair com o mouse fecha somente quando a abertura ocorreu por hover.
   Timers são cancelados ao sair, clicar, usar teclado e desmontar.
   Calcula origem da expansão junto ao botão; anima somente depois de posicionar.
   Mede offsetWidth/offsetHeight, sem incluir escala da animação, e usa
   ResizeObserver para acomodar conteúdo que muda de tamanho. Desconecta o
   observador ao fechar. Mantém portal, alinhamento, limite da janela, foco,
   fechamento externo/Escape/resize/scroll e navegação lateral por ArrowRight.
7. **Alterado `components/ui/popover.module.css`:** abertura de 300 ms com
   opacidade, deslocamento curto e escala discreta. Origem segue o botão.
   Exclui o flyout EMPS para preservar seu clip-path/reveal anterior. Desativa
   a animação quando prefers-reduced-motion estiver ativo.
8. **Alterado `styles/animations.css`:** reveal de 300 ms para dialog nativo e
   dialogs internos do app; fade de 300 ms para tooltip visível do Recharts,
   sem modificar sua transformação/posição. Regras de movimento reduzido.
   Abrange tabela de leituras, simulador de energia e confirmação de caixa;
   não modifica suas ações. Controles nativos do navegador não são substituídos.
9. **Alterado `styles/charger-board.css`:** detalhes do carregador passam a
   transições de opacidade/visibilidade de 280 ms e movimento de 300 ms; painel
   de liberação manual usa o mesmo reveal de 300 ms. Geometria, permissões,
   botões e lógica operacional permanecem inalterados.
10. **Novo `tests/station-weather.test.cjs`:** oito testes do modelo: coordenadas,
    consulta, fuso/unidades, resposta parcial, timestamps, valores inválidos,
    limite/deduplicação e classificação meteorológica.

## Dados, privacidade e limites

- Uma única consulta meteorológica reúne dados atuais e diários, separada de
  histórico de energia, telemetria e backend. Não pede autorização de GPS.
- Usa a posição cadastrada da instalação, aproximada a duas casas decimais;
  não envia nome, e-mail, tokens, sessão de login ou posição precisa do usuário.
- API externa: https://api.open-meteo.com/v1/forecast . Documentação:
  https://open-meteo.com/en/docs . Referência visual: página de detalhes do
  SEMS+ GoodWe, consultada em sessão já autenticada.
- A previsão é meteorológica, não medição física do eletroposto. Não muda o
  cálculo solar, as tarifas nem os comandos GIE. O clima atual não depende
  da data histórica selecionada no gráfico.
- Não acrescenta dependências, variáveis de ambiente, chaves ou serviços.

## Verificação

- 83 testes passaram (75 existentes + 8 novos); build de produção e TypeScript.
- Navegador local: previsão real de São Paulo, hoje e próximos quatro dias;
  seleção do dia seguinte; rótulos vento máximo/umidade média; Escape e foco;
  clique fora; atualizar previsão; temas claro/escuro.
- Viewport móvel 390 x 844: painel dentro da janela, sem rolagem horizontal.
- Duração computada de 0,3 s no clima, perfil e tabela. Menu EMPS continua
  com emps-flyout-reveal de 0,3 s. Filtros usam o mesmo Popover compartilhado.
- Timeout, resposta parcial e valores inválidos têm testes de modelo/guardas;
  indisponibilidade de rede, preferência de movimento reduzido e ações de caixa
  não foram induzidas manualmente no navegador durante esta validação.
- A atualização automática de estilos em desenvolvimento apresentou um aviso
  transitório de HMR; a página foi recarregada para a conferência final.

## Escopo preservado e aprovação

Nenhuma alteração deste pedido em backend Nest.js, MySQL, GIE, aplicativo móvel,
migrações, contratos internos, autenticação, senhas, tarifas, dados cadastrados
ou imagem da instalação. Apenas a preferência de tema foi alternada na validação
e devolvida ao escuro. Alterações anteriores no checkout foram preservadas.
Nenhum commit, push ou deploy executado.

Artefatos: este registro e
`output/pdf/EMPS_ALTERACAO_CLIMA_POPUPS_2026-10-09.pdf`, com imagens de referência
e do resultado. O script auxiliar de geração fica em `tmp/pdfs/` e não é código
de execução do site.

Aprovação do grupo: _____________________ Data: _____________________
