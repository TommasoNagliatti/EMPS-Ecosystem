# CR-2026-10-12-001 - Paineis operacionais

Data: 12/10/2026. Estado: implementado e validado localmente; aguardando revisao do grupo. Nao publicado.

## Pedido e limites

Melhorar Carregadores, Sessoes, Pagamentos, Clientes e Alertas, preservando o padrao visual existente e o acesso somente leitura ao banco oficial. O trabalho nao implementa o modo de simulacao GIE no dashboard.

A copia de trabalho utilizada foi EMPS-Ecosystem-2026-10-07. Alteracoes anteriores e arquivos privados foram preservados. Nenhum commit, push, deploy, migration, seed, cadastro, pagamento, comando fisico ou alteracao de registro oficial foi executado.

## Interface e comportamento

- Cabecalho com titulo da tela, descricao concisa, indicador somente leitura e atualizacao manual.
- Resumo em faixa sem cartoes aninhados: quatro indicadores calculados apenas com os registros devolvidos pela API e pelas condicoes de busca/periodo. Filtro de status altera a tabela e as contagens das abas, sem esconder os outros totais do resumo da consulta.
- Campos de busca especificos por recurso; limpeza de busca/filtros; contagem de cada situacao; ordenacao; paginacao local de 25 linhas.
- Tabelas com cabecalhos menores, alinhamento numerico, datas de atualizacao, rolagem horizontal interna no celular e acesso aos detalhes pelo icone de informacao.
- Detalhes em dialogo nativo modal com abertura de 220 ms, fundo de 180 ms, foco contido, fechamento por Escape/botao/clique externo e bloqueio da rolagem da pagina. A preferencia de movimento reduzido remove as animacoes.
- Estados distintos para consulta em andamento, vazio real, filtro sem resultado e erro. Uma falha inicial nao exibe zero como se a consulta tivesse funcionado. Uma falha de atualizacao preserva os dados anteriores e mostra aviso.
- Operacoes existentes de encerrar sessao, aprovar pagamento, resolver alerta e acerto no caixa continuam com os mesmos endpoints e valores. Fora de somente leitura, passam por confirmacao antes do envio e recarregam a resposta da API, sem fabricar um status otimista.
- Mensagens de erro usam apresentacao de erro, e nao o antigo icone de sucesso.

## Carregadores

Equipamentos e solicitacoes agora ficam em visoes separadas. A primeira tela mostra os equipamentos; provisionamentos e opcoes de cadastro so sao consultados quando a pessoa abre Solicitacoes. O texto promocional grande foi removido, sem remover o fluxo original de provisionamento.

A tabela de equipamentos inclui instalacao, conector, potencia nominal, cadastro, operacao, detalhes e QR. Identidade OCPP, serie, fabricante/modelo, ultima comunicacao e potencia atual ficam no dialogo. QR existente pode ser visualizado sem escrita; gerar QR ausente e bloqueado no modo de leitura. Solicitar/validar/aprovar/rejeitar/cancelar/excluir tambem ficam indisponiveis nesse modo.

Cadastro ENABLED e exibido como Habilitado, nao como online. O status de operacao exige lastSeenAt valido, nao mais de 15 minutos antigo e nao mais de 5 segundos no futuro. Sem leitura recente, o status/potencia atual ficam desconhecidos. Estados administrativos desabilitado/manutencao/pendente prevalecem sobre telemetria. Leituras de potencia invalidas ou negativas sao rejeitadas na exibicao; zero medido continua valido. Potencia nominal vazia, invalida ou nao positiva nao vira zero.

Atualizacao manual e consulta a cada 60 segundos quando a pagina esta visivel; consultas silenciosas nao se sobrepoem. Nao houve comando OCPP nem alteracao de estado fisico.

## Sessoes e pagamentos

Busca por ID/nome/carregador continua usando o parametro q existente da API, agora com espera de 300 ms e sem as duas chamadas iniciais duplicadas do componente anterior. Respostas atrasadas nao substituem a consulta mais nova.

Periodos: todo o periodo, hoje, semana desde segunda-feira, mes corrente e intervalo personalizado. O calendario e o fuso sao os do navegador. Inicio e fim sao inclusivos; intervalo invertido mostra aviso. Sessoes usam dataInicio; pagamentos usam dataPagamento. Pagamentos sem confirmacao permanecem em Todo o periodo e ficam fora dos recortes datados; nao ha data de criacao de pagamento no contrato atual do frontend.

Resumo de sessoes: quantidade, recargas ativas, energia entregue e quantidade aguardando pagamento. Resumo de pagamentos: quantidade, valores aprovados, pendentes e estornados. Sao somas de registros, nao novas regras de faturamento. Pagamento sem data aparece como Nao confirmado, e nao Em andamento.

Ordenacao por mais recente, mais antigo, nome ou maior valor. Datas ausentes ficam no fim. Acerto no caixa conserva a regra preexistente de valor positivo abaixo de R$ 0,50 e os valores congelados da sessao.

## Clientes e alertas

Clientes: busca local normalizada por acentos/maiusculas, ID, nome, e-mail e placa; status exato; ordenacao; resumo de clientes ativos, clientes com recarga e quantidade de recargas. Corrigida a comparacao por substring que fazia ativo coincidir com inativo. Veiculo e placa ausentes deixam de repetir dois placeholders.

Alertas: situacao e severidade permanecem campos separados. Criticos usa severidade exata; o resumo de criticos atuais exclui resolvidos. Ordenacao inicial por prioridade coloca nao resolvidos antes de resolvidos, e severidade critica antes das demais. A base consultada estava sem alertas; nenhum alerta foi inventado para a demonstracao. Os casos com alertas foram exercitados nos testes locais.

Referencias de cliente ausentes nos detalhes aparecem como Nao associado, preservando o valor original do contrato em memoria.

## Dois ajustes no iniciador local

1. backend/scripts/remote-development.cjs acrescenta NEXT_PUBLIC_EMPS_READ_ONLY=true ao ambiente do frontend. E apenas uma indicacao publica de capacidade; as protecoes efetivas de HTTP, Prisma, MySQL e escopo continuam no servidor, sem alteracao. Nenhum segredo e enviado ao navegador.
2. scripts/start-remote-dev.ps1 passa o caminho absoluto do iniciador Node. O comando de parada seguro recusava a inicializacao relativa porque nao conseguia conferir a identidade. O ajuste foi confirmado iniciando, parando com stop-remote-dev.ps1 e iniciando novamente. A primeira arvore antiga foi encerrada somente apos conferir PID, ancestral, caminho e horario de criacao.

Nao foram alterados controladores, servicos de negocio, modelos Prisma, SQL, credenciais, permissoes de usuarios, configuracao privada, codigo Python do GIE ou aplicativo movel.

## Inventario das fontes

Modificados (8):
- scripts/start-remote-dev.ps1
- site/emps-site-main/backend/scripts/remote-development.cjs
- site/emps-site-main/frontend/services/emps-api.ts
- site/emps-site-main/frontend/components/operations/OperationalPage.tsx
- site/emps-site-main/frontend/components/operations/operation-config.tsx
- site/emps-site-main/frontend/components/chargers/CanonicalChargers.tsx
- site/emps-site-main/frontend/components/chargers/ChargerProvisioningPage.tsx
- site/emps-site-main/frontend/styles/provisioning.css

Novos (5):
- site/emps-site-main/frontend/components/operations/operational-model.ts
- site/emps-site-main/frontend/components/operations/OperationsUI.tsx
- site/emps-site-main/frontend/components/operations/operations.module.css
- site/emps-site-main/frontend/components/chargers/charger-list-model.ts
- site/emps-site-main/frontend/tests/operational-panels.test.cjs

Esta CR, o PDF, as imagens, os resultados dos testes e o manifesto sao documentacao/artefatos adicionais. A compilacao regenerou apenas arquivos locais de build. Nenhum pacote novo foi instalado.

## Verificacao

- Frontend: 138 testes aprovados, sem falhas; 20 novos casos nesta CR.
- TypeScript: verificacao sem erros e build otimizado Next.js concluido.
- Protecoes remotas: 11 testes aprovados, sem acesso de escrita ao MySQL.
- Preflight: schemaComparison=NO_PRISMA_DIFF; banco oficial somente leitura; jobs, pagamentos externos e comandos fisicos desligados.
- Navegador: cinco rotas, busca de sessao por ID, intervalo de 08/10/2026, filtro de pagamentos aprovados, filtro de clientes inativos, detalhes de sessao e carregador, Escape, QR ja existente e visoes de equipamentos/solicitacoes.
- Responsividade: conferir os cinco paineis em 390 x 844; tabela com scroll interno, sem alargar a pagina.
- O relatorio usa sessoes de cliente avulso e clientes filtrados para nao expor nomes/contatos individuais nas imagens compartilhadas.

Operacoes de escrita, liquidacao, aprovacao, exclusao e provisionamento nao foram executadas contra a base oficial. Exigem homologacao futura em ambiente descartavel autorizado. Cores seguem as variaveis do tema existente; a conferencia visual principal foi feita no tema escuro.

## Reversao e aprovacao

output/CR-2026-10-12-001/baseline preserva a versao imediatamente anterior dos oito arquivos modificados, incluindo alteracoes preexistentes. change-manifest.json registra os hashes das fontes. Para reverter, revisar a baseline, restaurar apenas estes arquivos e retirar apenas os cinco novos arquivos apos conferir que ninguem os alterou. Nao usar git reset/checkout geral.

Depois recompilar e reiniciar a previa local. Nao existe rollback SQL porque nao houve escrita ou mudanca de esquema. Restaurar o iniciador antigo reintroduz a incompatibilidade do caminho relativo com o comando seguro de parada.

Para aprovar: revisar telas, contratos preservados, criterios de frescor de telemetria, periodo por data de confirmacao e diff da CR. Publicacao permanece pendente de autorizacao do grupo.
