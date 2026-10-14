# CR-2026-10-12-003 - Navegacao do site

Data: 2026-10-12. Estado: implementado e verificado localmente; aguardando revisao do grupo.
Base: `ccef3c9327cb6915b8af4bbf103c53a4b73a4de6`.
Escopo: frontend do site. Nao houve commit, push ou publicacao na VPS nesta alteracao.

## Pedido e diagnostico

Reduzir a espera repetida ao abrir paginas e retornar ao painel de uma instalacao.
As telas reiniciavam listas vazias, repetiam consultas GET e, no painel, aguardavam
sessao, instalacao, modulo do painel e dados operacionais antes de mostrar o conteudo.
O ambiente ja usa uma compilacao local otimizada; nao se tratava apenas de compilacao
de paginas em modo de desenvolvimento.

## Comportamento implementado

- Links internos antecipam o codigo de rotas do Next, inclusive rotas dinamicas.
- A intencao de navegacao antecipa apenas leituras conhecidas: mouse por 80 ms,
  foco de teclado ou pressionamento principal do ponteiro. Sair do link cancela
  o temporizador; nao ha pre-carga irrestrita de todas as paginas ou escrita.
- O modulo grande do painel e antecipado apenas nos links de painel.
- Respostas GET autorizadas ficam em memoria desta aba, por no maximo 30 segundos,
  com limite de 24 entradas. Nao sao persistidas em disco ou compartilhadas entre abas.
- Uma resposta com menos de 5 segundos pode atender uma navegacao normal sem nova
  consulta. Entre 5 e 30 segundos, o conteudo recente aparece enquanto e reconsultado.
- Leituras concorrentes da mesma chave compartilham uma requisicao. Cancelar um
  consumidor nao interrompe a leitura de outro consumidor ou a antecipacao.
- A chave inclui API, usuario, perfil, modo, instalacao e caminho completo com filtros.
- A troca de usuario/perfil/modo, logout, escrita, resposta 401/403 ou evento real
  de atualizacao invalida as consultas. Respostas antigas nao repovoam o cache.
- Atualizacao manual, polling e atualizacao em tempo real forcados continuam indo
  a API. Se ja existir uma requisicao igual em andamento, compartilham essa leitura.
- O transporte HTTP continua sem cache (`no-store`). Endpoints de autenticacao,
  cotacoes de pagamento, comandos e estado do GIE nao entram no cache de navegacao.
- Os horarios de consulta preservam a data real da resposta, nao o horario de retorno
  a pagina. Falhas e negacoes de acesso continuam visiveis.
- O painel pode reutilizar o cadastro autorizado recente por ate 30 segundos e ainda
  revalida a sessao e o acesso. Uma negacao remove o painel. Uma sessao expirada nao
  fornece conteudo do cache. Nao houve mudanca em permissoes ou validacao do servidor.

## Inventario completo

Os 19 arquivos de codigo/teste abaixo pertencem a `site/emps-site-main/frontend/`.

| Arquivo | Alteracao |
|---|---|
| `services/navigation-cache.ts` (novo) | Cache limitado, validade, clonagem, deduplicacao, cancelamento independente e rotas GET permitidas. |
| `services/emps-api.ts` | Integra cache, chaves por contexto, invalidacao, leitura recente, antecipacao e opcao de forcar consulta; mantem transporte e autorizacao. |
| `components/shell/NavigationLink.tsx` (novo) | Link interno com pre-carga de codigo, intencao de navegacao e antecipacao do modulo do painel. |
| `components/shell/SidebarNavigation.tsx` | Usa o novo link somente nos destinos internos EMPS. |
| `components/stations/StationListTable.tsx` | Usa o novo link nos acessos da tabela de instalacoes. |
| `components/stations/StationList.tsx` | Inicia com lista recente, mantem conteudo na consulta e distingue atualizacao/falha de acesso. |
| `components/dashboard/StationDashboard.tsx` | Usa o novo link nos acessos de volta e configuracao. |
| `components/dashboard/RoleDashboard.tsx` | Reaproveita cadastro autorizado recente, revalida acesso e descarta respostas de outro contexto. |
| `components/dashboard/AdminDashboard.tsx` | Inicia com painel recente; revalida, atualiza em segundo plano e remove dados quando acesso e negado. |
| `components/dashboard/use-station-history.ts` | Reconsultas disparadas por revisao do historico nao usam a janela de reutilizacao de 5 segundos. |
| `components/chargers/CanonicalChargers.tsx` | Inicia com carregadores/instalacoes recentes, conserva horario de consulta e forca atualizacoes explicitas. |
| `components/operations/OperationalPage.tsx` | Inicia sessoes, pagamentos, clientes e alertas com respostas recentes; consulta de fundo e invalidacao por acesso negado. |
| `components/realtime/RealtimeProvider.tsx` | Invalida as leituras ao receber um evento novo e valido, sem repetir eventos duplicados. |
| `components/energy/GieControls.tsx` | Recebe o ID inicial da instalacao da URL; impede selecionar outra instalacao salva ao iniciar o painel. Somente frontend. |
| `tests/navigation-performance.test.cjs` (novo) | 11 casos de cache, segregacao, antecipacao GET, validade, erros, invalidacao e endpoints excluidos. |
| `tests/dashboard-performance.test.cjs` | Ajusta os mocks para o novo modulo e leitura inicial recente. |
| `tests/station-navigation.test.cjs` | Adapta mocks e testa retorno com cadastro de 12 segundos e retirada de acesso apos negacao. |
| `tests/operational-panels.test.cjs` | Adapta mocks e testa renderizacao imediata de linhas recentes com horario original. |
| `tests/account-theme.test.cjs` | Adapta o mock dos links internos, mantendo cobertura da barra lateral. |

Documentacao adicional: este registro e o indice `docs/README.md`.
O relatorio PDF e capturas de verificacao ficam apenas em `output/`, ignorado pelo Git.
O manifesto e o PDF da publicacao anterior continuam historicos e nao foram regenerados.

## Verificacao realizada

| Verificacao | Resultado |
|---|---|
| Testes do frontend | 151 aprovados; zero falhas. |
| Compilacao otimizada da copia em execucao | Compilacao, TypeScript e geracao de rotas concluidos. |
| Disponibilidade local | Site na porta 3010 e API na porta 3011 responderam HTTP 200. |
| Estrutura do repositorio | 5 testes aprovados. |
| Verificacao de publicacao | Sem sinal bloqueante nas regras revisadas; nao substitui auditoria de seguranca. |
| Higiene do diff | `git diff --check` sem erros; avisos de terminador de linha do ambiente Windows. |
| Navegacao no navegador do Codex | Retorno a sessoes, pagamentos, clientes, alertas e carregadores com tabelas, sem indicador de consulta inicial. |
| Painel da instalacao | Retorno com fluxo visivel; botao Atualizar mantem o conteudo durante a consulta. |
| Console no trecho inspecionado | Sem erros capturados na amostra. |

A amostra final de retorno as cinco abas registrou 213 a 288 ms entre clique e captura
do estado da interface. Um retorno ao painel, com consulta ainda recente, registrou
478 ms ate confirmar o conteudo e capturar o estado. Esses tempos incluem a automacao
e nao constituem benchmark de rede, SLA ou comparacao percentual controlada.

Consultas iniciais e retornos apos expirar o cache ainda aguardam a API. Em uma das
consultas do painel, fora da janela recente, a confirmacao do conteudo levou cerca de
3,1 segundos. Atualizar a aba inteira limpa a memoria; o primeiro acesso pode mostrar
carregamento. Nao se ocultaram erros, criaram valores ficticios ou garantiram latencia zero.

## Limites e impacto operacional

- Nenhum arquivo-fonte do backend, app movel, motor Python do GIE ou SQL foi alterado.
- Nenhuma migration, mudanca de esquema, permissao, senha, registro ou indice no banco.
- O acesso ao banco oficial permaneceu somente leitura pelo tunel ja autorizado.
- Apenas os processos locais deste workspace foram reiniciados para compilar o site;
  o build do backend executado pelo inicializador existente nao alterou seu codigo-fonte.
- A sessao local expirou apos o reinicio da API e o usuario entrou novamente; nao houve
  criacao de conta, remocao de autenticacao ou alteracao de senha para concluir os testes.
- Nao houve acesso de escrita, reinicio de servicos da VPS, deploy ou novo push no GitHub.
- A verificacao de segregacao e expirada/negada foi feita com fixtures automatizadas;
  nao se alteraram permissoes reais no banco para simular esses casos.
- Os testes visuais desta alteracao foram feitos no navegador do Codex; nao houve
  validacao em iPhone fisico ou benchmark de carga concorrente.

## Revisao e reversao

Revisar os 19 arquivos acima e os dois documentos. Para reverter, remover apenas este
conjunto de alteracoes apos revisar o diff contra a base informada; preservar todas as
mudancas anteriores. Nao reverter o workspace inteiro nem apagar a memoria de dados
oficiais. O cache nao precisa de migration ou limpeza de banco, pois existe apenas na
memoria do navegador. Publicar somente apos aprovacao do grupo e pedido explicito.
