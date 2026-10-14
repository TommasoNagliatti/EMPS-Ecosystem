# Controle de data da Visão geral

Data: 09/10/2026. Projeto: EMPS-Ecosystem-2026-10-07.
Estado: implementado e validado localmente; aprovação do grupo pendente.
Sem commit, push, deploy ou alteração no repositório antigo.

## Solicitação e resultado

Adicionar seleção de data ao card Visão geral, usando como referência o print do aplicativo SEMS+ enviado pelo usuário. O cabeçalho agora possui calendário, setas para navegar e menu de período em português: Dia, Semana, Mês e Ano. A escolha é compartilhada com Histórico de energia e Monitoramento do consumo, que receberam o mesmo controle.

Não foram implementadas as opções All/Todos e Customize/Personalizar que também aparecem na referência. O contrato atual consulta intervalos delimitados; o backend existente limita o intervalo a 24 meses. O escopo desta entrega é selecionar datas nos quatro períodos já suportados, sem ampliar esse contrato.

## Arquivos de implementação

Caminhos abaixo relativos a `site/emps-site-main/frontend`.

1. `components/dashboard/DateControl.tsx` (novo): extrai o controle antes interno ao dashboard. Calendário nativo, setas e menu do componente Popover existente; seleção vermelha, rótulos acessíveis por seção e navegação pelo teclado. Valida a data tanto em onInput quanto em onChange, rejeitando vazio, calendário inválido e futuro. Limita a entrada até o dia atual no fuso da instalação. O pop-up herda a abertura suave de 300 ms, Escape, retorno do foco e fechamento externo já existentes.
2. `domain/station-monitoring.ts` (alterado): acrescenta isCalendarDay e moveMonitoringDay. Valida datas reais a partir do ano 1000; navega um dia, sete dias, um mês ou um ano. Ajusta fim de mês e ano bissexto. Ao avançar para a semana/mês/ano corrente, usa hoje como âncora quando o dia equivalente ainda seria futuro; bloqueia períodos totalmente futuros e a navegação antes do limite mínimo. Preserva dateWindow, integração de leituras e fórmulas anteriores.
3. `components/dashboard/StationDashboard.tsx` (alterado): importa o controle compartilhado, remove sua antiga versão interna e os imports sem uso. Substitui o texto estático de data na Visão geral e no Consumo e padroniza o controle do Histórico. Os três controles usam o mesmo estado day/period e a mesma consulta de histórico. Sinaliza carregamento com aria-busy na Visão geral. Mantém a regra existente de sair do exemplo diário quando se escolhe outro período.
4. `components/dashboard/station-dashboard.module.css` (alterado): estilos do calendário e das setas, menu de período, seleção, foco e temas. Ajusta cabeçalho para quebrar linha em telas menores; calendário com fonte de 16 px no celular. Mantém o controle do Consumo abrangendo as colunas da grade no breakpoint intermediário, sem comprimir os gráficos. Não altera a imagem, as barras da bateria ou a animação dos cabos.
5. `components/dashboard/use-station-history.ts` (alterado): associa resultados à chave estação/from/to/revisão. Ao trocar a seleção, não exibe valores do intervalo anterior com a nova data enquanto a próxima consulta é preparada. Preserva AbortController; respostas antigas canceladas não substituem o resultado atual. Endpoint, divisão de consultas limitadas a 1.000 linhas, orçamento de 24 requisições e sinalização de truncamento permanecem iguais.
6. `tests/date-control.test.cjs` (novo): oito testes de calendário, navegação diária/semanal, fim de mês, ano bissexto, período corrente/futuro, limites e entrada manual/calendário. Inclui renderização com rótulos distintos e data máxima nos três controles.
7. `tests/station-history.test.cjs` (novo): dois testes para ocultar imediatamente leituras antigas ao mudar o intervalo/revisão e para abortar a consulta anterior sem aceitar sua resposta atrasada.

## Dados e limites

- Visão geral, curva histórica e totais de consumo usam a janela histórica selecionada e a API já existente `/v2/stations/:id/telemetry/history?from=...&to=...`.
- Clima, cena GIE, estado dos carregadores, ocupação e indicadores operacionais Receita hoje/Receita no mês continuam atuais. Esta alteração não cria histórico meteorológico nem refaz os resumos operacionais para uma data passada.
- Ausência de leituras continua representada por `--`; não é preenchida com zero nem com dados inventados. Contribuições ambientais continuam sem valor quando faltam os fatores necessários.
- O exemplo fictício diário já existente foi usado apenas para conferir a composição com números; não gera medições físicas e não foi gravado no banco. Ao encerrar a conferência, a fonte voltou para Dados da instalação, Dia e 09/10/2026.
- A seleção pertence ao estado da página; não cria preferências persistidas ou novos registros. Consultas grandes continuam sujeitas aos limites e avisos já existentes.

## Validação

- `node --test tests/*.test.cjs`: 93 testes aprovados, sendo 83 anteriores e 10 novos.
- `npm run build`: Next.js e TypeScript concluídos com sucesso.
- Navegador: mudança de período na Visão geral sincroniza Histórico e Consumo; preenchimento do calendário no Consumo também sincroniza os demais.
- Conferidos Dia, Semana, Mês e Ano; avanço até o período corrente, bloqueio de futuro, calendário de 30/09 e ajuste de 31/12/2025 para o ano corrente.
- Conferidos menu por teclado, fechamento e animação de 0,3 s.
- Layout conferido no desktop, 900 x 900 e 390 x 844, sem rolagem horizontal da página. Fontes dos campos de data móveis em 16 px.
- Temas claro e escuro conferidos. Tema escuro restaurado; recarga final do dashboard concluída.
- Revisão React: componente compartilhado fora do componente principal; estado histórico único; cancelamento/limpeza das consultas; eventos com tipos definidos; botões e campos rotulados. Sem bibliotecas ou dependências adicionais.

## Preservado

Backend Nest.js, MySQL, GIE, aplicativo móvel, contratos, tabelas, migrações, contas, credenciais, autenticação, tarifas, regras de energia e cadastros não foram alterados nesta entrega. Alterações anteriores no workspace foram preservadas. Não foi executado nenhum comando de escrita no banco.

## Documentação e evidências

Registro detalhado: este arquivo. PDF com imagens: `output/pdf/EMPS_ALTERACAO_DATA_VISAO_GERAL_2026-10-09.pdf`.
Gerador do documento: `tmp/pdfs/build-overview-date-report.py` (apoio local, não usado pelo site).

Capturas mantidas no arquivo local privado de evidencias:

- `emps-overview-date-final-20261009.jpg`: entrega final, tema escuro, dados da instalação.
- `emps-overview-date-example-20261009.jpg`: conferência com o exemplo diário já existente.
- `emps-overview-date-mobile-20261009.jpg`: viewport móvel.
- `emps-overview-date-light-20261009.jpg`: tema claro.

Aprovação: ____________________  Responsável: ____________________  Data: ____________________
