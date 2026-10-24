# CR-2026-10-12-006 - Desativacao do replay GIE local

## Solicitacao e decisao

O usuario rejeitou dados simulados e informou que ainda nao possui equipamentos
conectados. A alternativa de demonstracao integrada no banco oficial da proposta
005 nao sera ativada. Esta alteracao desativa o replay local, nao implementa uma
conexao fisica e nao libera gravacao no banco oficial.

## Alteracoes exatas

- Na configuracao privada do clone ativo
  `EMPS-Ecosystem-2026-10-07/site/emps-site-main/backend/.env.remote`, foi alterado
  somente `EMPS_LOCAL_GIE_DEMO`: de `"true"` para `"false"`. O arquivo continua
  ignorado pelo Git. Nenhum segredo foi alterado ou publicado.
- O iniciador local e seus processos dependentes foram encerrados pelo script
  existente que valida identidade/PID. Site, Nest e tunel foram iniciados novamente
  pelo iniciador otimizado existente, desta vez sem iniciar o Python de replay.
- Criados este registro e o PDF privado de alteracao; atualizado `docs/README.md`.
  Os arquivos do frontend abaixo foram atualizados no repositorio organizado e
  sincronizados para o clone ativo, com cinco hashes correspondentes.

### Frontend - arquivos relativos a site/emps-site-main/frontend

| Arquivo | Alteracao desta entrega |
|---|---|
| `components/dashboard/StationDashboard.tsx` | Remove estado/callback/import de exemplo e opcao ficticia do seletor. Filtra leituras simuladas antes de montar fontes, curvas, comparacao, totais e clima local. Mantem a cena e o layout. |
| `components/dashboard/MonitoringChart.tsx` | Remove props/caminhos de exemplo, botao Ver exemplo e exportacao ficticia. Tooltips, tabela e CSV continuam com fonte/qualidade do historico selecionado. Preserva estados vazio, erro, carga, expansao e Escape. |
| `domain/station-monitoring.ts` | Adiciona `readingSource` ao tipo e `isNonSimulatedReading`, que exclui origem SIMULATED, fonte SIMULATED ou readingSource SIMULATOR. Nao promove outras origens a MEASURED. |
| `tests/station-monitoring.test.cjs` | Adiciona teste de filtragem por tres sinais de simulacao; preserva registros medidos, importados e de origem desconhecida sem reclassifica-los. |
| `tests/station-insights.test.cjs` | Atualiza contrato do grafico e verifica estado vazio sem botao de exemplo. |

O hook `use-station-history.ts` foi editado provisoriamente e voltou integralmente
ao codigo anterior desta tarefa. Seu comportamento de cache/paginacao nao mudou.
Nao foram alterados backend, motor Python GIE, modelos, dependencias, schema, API
de escrita, aplicativo movel, foto/cabos do fluxo ou regra financeira.

## Estado resultante

- Site e API locais funcionam com o banco oficial em modo READ_ONLY.
- Replay isolado desligado; nao ha processo `service.isolated_preview` ou servidor
  na porta 8013. O iniciador confirmou `localGieDemo: false`.
- Jobs operacionais, comandos fisicos e efeitos de pagamentos continuam desativados.
- Nao foram criadas leituras, fontes, ciclos, instalacoes, sessoes ou pagamentos.
  Nada foi apagado ou alterado na VPS. Nenhuma permissao de escrita foi criada.
- Arquivos do replay e seus testes foram preservados; eles nao estao em execucao.
  A desativacao do replay nao atesta que registros preexistentes sejam fisicos.
- Dados simulados eventualmente gravados antes nao foram apagados; o historico
  do painel nao os seleciona. O gerador de fixtures e testes existentes continuam
  no codigo, sem caminho de exemplo na pagina operacional.
- Sem equipamento/fonte real validada, o GIE operacional permanece indisponivel.
  Dado ausente nao deve ser interpretado como zero ou como medicao real.

## Verificacao

- Build Nest e build otimizado Next concluidos pelo iniciador existente.
- Comparacao somente leitura do schema: `NO_PRISMA_DIFF`; nenhum SQL aplicado.
- Site `/login`: HTTP 200. API `/auth/health`: `status: ok`.
- Portas 3010, 3011 e 3317 escutando; porta 8013 sem servidor; zero processos de
  replay Python encontrados.
- Testes focados: 18 aprovados, zero falhas. A primeira execucao foi feita enquanto
  o build limpava `dist` e falhou em dois imports; apos concluir o build, a mesma
  suite passou integralmente, sem alterar codigo.
- Suite frontend: 167 testes aprovados, zero falhas. Uma tentativa intermediaria
  expos dependencias do novo import no harness do hook; o filtro foi mantido no
  componente, preservando o hook e seus testes de cache/concorrencia.
- Reinicios locais podem exigir novo login. Nao houve bypass de autenticacao.
  O painel autenticado foi acessado no navegador; GIE offline e campos energeticos
  ausentes permaneceram indisponiveis, sem trocar por dados artificiais.

## Pendencias para operacao real

1. Identificar instalacao, inversor, bateria, medidores e carregadores reais e a
   integracao disponivel. Nao enviar senhas ou tokens em documentos/chat.
2. Validar fonte, unidade, horario, autenticacao, limites e confirmacoes de hardware.
   Estado do banco e setpoint calculado nao sao prova de leitura fisica.
3. Preparar e aprovar os vinculos, acesso de gravacao limitado e o fluxo de ingestao
   de dados reais, com backup e auditoria. Preservar registros/cobrancas existentes.
4. Testar comunicacao e falhas antes de habilitar escrita ou comandos reais.

Sem commit, push ou deploy. Esta desativacao e local; nao e uma publicacao no site
oficial nem uma integracao fisica concluida.
