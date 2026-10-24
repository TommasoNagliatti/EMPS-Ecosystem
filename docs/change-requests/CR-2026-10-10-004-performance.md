# CR-2026-10-10-004 - Desempenho do painel local

Data: 10/10/2026. Branch: codex/hostinger-remote-development.
Estado: implementado e testado neste PC; aguardando revisao para publicacao.
Nenhum commit, push, deploy ou alteracao operacional na VPS nesta atualizacao.

## Pedido e diagnostico

O usuario relatou demora e pequenas travadas ao abrir abas, principalmente o
painel. O frontend local estava em next dev, que compila as rotas na primeira
abertura. O painel tambem esperava cinco chamadas REST, com leituras duplicadas
de sessoes, pagamentos e seus relacionamentos completos pelo tunel do MySQL.
O GIE consultava seu estado a cada cinco segundos, inclusive offline.

## Medicoes

Mesma instalacao autorizada, mesmo PC, mesma API local e MySQL oficial.
Tres leituras por configuracao, corpo da resposta completamente recebido.
Nao sao medidas de pintura da tela, teste de carga, SLA ou garantia de tempo.

| Medida | Antes | Depois |
|---|---:|---:|
| Chamadas para os dados operacionais do painel | 5 | 1 |
| Tempo por rodada, em ms | 8119 / 7078 / 7000 | 2285 / 2387 / 1854 |
| Mediana | 7078 ms | 2285 ms |
| JSON total por rodada, sem compressao | 871624 bytes | 77119 bytes |

Reducoes observadas: 67,7% na mediana, 91,2% no corpo JSON e 80% nas chamadas.
Uma medicao intermediaria ficou em 3182 a 3735 ms; a rede e a concorrencia
variam. A amostra final foi coletada com o ambiente reiniciado e inclui o codigo
dos pagamentos. Nao houve cache de dados de outra conta ou troca por uma copia.

Em verificacao HTTP separada, o HTML respondeu 200: /stations 42 ms,
/stations/13/dashboard 10 ms, /chargers 6 ms e /sessions 6 ms. Esses tempos nao
incluem autenticacao, consultas da API, imagem, clima, grafico ou renderizacao.

## Arquivos existentes alterados

Prefixos frontend/ e backend/ abaixo referem-se a site/emps-site-main/.

| Arquivo | Alteracao desta atualizacao |
|---|---|
| backend/src/dashboard.controller.ts | Novo GET /dashboard/panel autenticado e limitado por stationScope. Quatro consultas Prisma em paralelo, com campos selecionados para sessoes/pagamentos. Reutiliza relacoes em memoria, conserva sessoes ativas, cliente avulso, codigos de pagamento e alarmes resolvidos. Mantem GET /dashboard/summary. |
| frontend/services/emps-api.ts | Usa o painel consolidado e os mapeadores existentes. ApiResponseError conserva o status HTTP. Apenas 404 permite recorrer aos cinco endpoints legados; 403/429/500 nao provocam consultas adicionais. |
| frontend/components/dashboard/RoleDashboard.tsx | Repassa os dados da instalacao ja obtidos na verificacao de acesso, sem repetir a consulta. Mantem verificacao da conta, permissao, ID da URL e descarte de resposta antiga. |
| frontend/components/dashboard/AdminDashboard.tsx | Impede leituras sobrepostas e repeticao inicial apenas por conexao do socket; aplica atualizacao silenciosa com startTransition; suspende o polling fallback em pagina oculta. Usa telemetria operacional se o GIE estiver offline. Callback de atualizacao estavel. |
| frontend/components/dashboard/StationDashboard.tsx | Reutiliza a instalacao validada; busca propria continua disponivel quando necessario. Leitura climatica mais recente por reduce memoizado, em vez de ordenar todo o historico. Controles de data e callbacks do grafico estaveis. |
| frontend/components/dashboard/MonitoringChart.tsx | React.memo evita redesenhar o grafico quando apenas dados operacionais/GIE mudam. Nao altera series, barras, datas, integracao de energia ou cores. |
| frontend/components/dashboard/use-station-history.ts | Historico comparativo desativado tem referencia estavel; nao invalida o memo do grafico em toda atualizacao operacional. Mantem cancelamento e isolamento de datas. |
| frontend/components/energy/GieControls.tsx | Consulta seguinte so depois da anterior terminar. Compartilha leitura pendente com acoes; 5 s online, 30 s offline, nenhuma consulta periodica com a pagina oculta. Ignora respostas de uma instalacao anterior ou componente desmontado. |
| frontend/tests/station-navigation.test.cjs | Atualiza o contrato do painel para uma chamada consolidada e preserva testes de contexto/autorizacao. |
| frontend/next.config.ts | EMPS_LOCAL_PREVIEW=true usa diretorio separado .next-remote-preview. Modo padrao conserva .next e React Strict Mode. |
| backend/scripts/remote-development.cjs | --preview compila e inicia somente o frontend local otimizado. Backend continua development e read-only. Build e processo supervisionados; erro encerra apenas os filhos locais. Mantem preflight, tunel privado e bloqueios de integracoes. |
| scripts/start-remote-dev.ps1 | Acrescenta -Optimized, que repassa --preview. Modo de edicao padrao continua disponivel. |
| .gitignore | Ignora .next-remote-preview para nao versionar artefatos de build. |
| frontend/next-env.d.ts | Gerado automaticamente pelo Next para apontar aos tipos do diretorio de preview. Nao editado manualmente. |
| frontend/tsconfig.json | Next adicionou automaticamente os includes de tipos do preview, conservando os includes existentes. |

## Novos arquivos de codigo e testes

- backend/src/dashboard-summary.ts: extrai as formulas existentes em funcao
  compartilhada pelos dois endpoints. Historico completo continua no resumo;
  nao foi aplicado limite que diminuiria receita, energia ou contagem.
- backend/tests/dashboard-panel.test.ts: quatro testes para guards, escopo,
  consultas de leitura, equivalencia de indicadores, avulsos, pagamentos,
  alarmes, sessoes ativas e base vazia.
- frontend/tests/dashboard-performance.test.cjs: cinco testes para fallback
  legado, erros, leituras sobrepostas, polling offline, pagina oculta e referencia estavel do historico comparativo.

## Evidencias e seguranca

- Backend: build OK; 80 testes, 72 passaram, zero falhas, oito integracoes
  mutantes do MySQL nao executadas. Nao habilitado EMPS_V2_MYSQL_TEST.
- Frontend: build otimizado OK, tsc --noEmit OK, 116 testes passaram.
- Comparacao de respostas reais pelos mesmos mapeadores:
  IDENTICAL_MAPPED_DASHBOARD; 49 sessoes, 43 pagamentos e tres carregadores.
- API local: health 200; painel sem autenticacao 401; POST /v2/stations com
  corpo vazio recusado 403 pelo guard remoto antes de qualquer escrita.
- Preflight: emps_db / MySQL 8.0.46, UUID oficial conferido, SELECT somente,
  NO_PRISMA_DIFF, jobs/comandos fisicos/efeitos financeiros/escritas desativados.
- Navegador: login existente, lista, painel, dispositivos e 49 sessoes,
  alarmes, inteligencia offline, curva e barras do exemplo ja existente.
  A fonte foi retornada aos dados da instalacao; nada salvo no banco.
- git diff --check sem erros; avisos LF/CRLF em arquivos de texto.
- Nenhuma credencial incluida nos documentos. Diagnostico temporario apenas
  leu a configuracao privada, assinou token LOCAL de teste curto e efetuou GETs.

O banco oficial nao foi clonado nem alterado. Nao alterados schema.prisma,
indices, migrations, grants, SSH, CORS oficial, VPS, GIE Python/ML, tarifas,
cobranca, aplicativo Expo, imagens, CSS ou desenho do painel. A API modificada
e a copia de codigo local; o backend publicado nao recebeu esta atualizacao.

## Execucao e limites

Site: http://localhost:3010/stations. API local 3011, tunel privado 3317.
O ambiente final foi deixado rodando em segundo plano com --preview.
Para reproduzir, na raiz do ecossistema:

```powershell
.\scripts\stop-remote-dev.ps1
.\scripts\start-remote-dev.ps1 -Optimized
```

Sem -Optimized, o site usa modo de edicao com atualizacao automatica. Em preview,
alteracoes futuras de codigo exigem nova compilacao/reinicio local. Reiniciar o
backend limpa refresh tokens mantidos em memoria; pode exigir novo login, sem
alterar usuarios ou tokens no banco oficial. Tokens JWT ja emitidos mantem sua
validade curta conforme o contrato anterior.

O tunel remoto ainda acrescenta latencia. O painel continua lendo o historico
operacional completo para preservar os indicadores. Paginacao/agregacao no SQL
para bases grandes e validacao sob carga exigem outra revisao. Nao foi feito
teste em iPhone fisico, publicacao na Hostinger ou teste de carga na producao.
O endpoint legado permanece completo para compatibilidade; backend antigo usa
fallback e nao recebe a reducao do novo endpoint ate aprovar seu deploy.

Relatorio, imagens e manifesto: output/CR-2026-10-10-004 e output/pdf.
Arquivos temporarios de medicao/renderizacao: tmp/dashboard-performance,
ignorados pelo Git. Builds, dist, tsbuildinfo, logs e controle de PID sao gerados
locais, nao alteracoes de dados oficiais. Alteracoes preexistentes preservadas.

## Aprovacao

Revisar diff desta atualizacao separadamente das alteracoes anteriores.
Validar ambiente de teste, contrato do endpoint e politica de polling antes de
aprovar um commit/PR ou publicacao. Nenhuma aprovacao de producao foi presumida.
