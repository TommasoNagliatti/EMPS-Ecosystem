# Histórico demonstrativo GIE: revisão e implantação futura

**Estado em 15/10/2026:** proposta de desenvolvimento na branch
`feat/gie-demo-history-mysql`, criada sobre `efbc0fa` do PR #2. Este documento é
um roteiro de revisão. Não registra aprovação, merge, deploy, importação no MySQL
oficial ou alteração na Hostinger. A ordem de dependência é PR #1, PR #2 e a PR
deste histórico; cada integração e publicação depende da sua própria revisão.

## O que os dados representam

| Instalação | Período original | Tentativas | Recargas com kWh positivo | kWh AC entregue | Intervalos de 15 minutos |
| --- | --- | ---: | ---: | ---: | ---: |
| Shopping Frei Caneca, GIE comercial original | jan–jun/2026 | 5.477 | 2.917 | 46.082,44141759 | 17.376 |
| Posto 24h, `DEMO_POSTO_24H_001` | jan–dez/2025 | 2.289 | 2.085 | 39.495,7439304049 | 35.040 |
| Residência, `DEMO_CASA_001` | jan–dez/2025 | 42 | 42 | 756,4236898176 | 35.040 |

No total, os arquivos contêm 7.808 tentativas, 5.044 recargas atendidas e
87.456 intervalos. Esses totais são **da fonte CSV**, não um recibo de carga no
MySQL. A auditoria de hashes, colunas, estados e reconciliação está em
`docs/GIE_DEMO_HISTORY_DATASETS_2026-10-15.md`. Preservar as datas originais:
Shopping em 2026, Posto e Residência em 2025. O comparativo deve mostrar o
período de cada estação e, quando fizer sentido, médias por mês coberto. A média
por mês é uma normalização descritiva; não significa desempenho simultâneo nem
projeção comercial.

O parser guarda o fim da série como limite **exclusivo**: 01/07/2026 00:00 para
Shopping e 01/01/2026 00:00 para Posto/Residência, no horário local. Ao exibir
o período ou contar meses cobertos, usar o último instante **anterior** a esse
limite; os resultados devem ser seis e doze meses, respectivamente.

Energia AC entregue nas sessões é a base do valor demonstrativo; consumo da
edificação e geração solar são séries distintas. Os CSVs não contêm tarifas,
canais, métodos ou quitação de pagamentos. O cenário financeiro aplica tarifa,
taxa e custo explicitamente versionados aos kWh entregues; a seleção de canal e
método usa semente fixa. Os valores são sempre **SIMULATED** e não correspondem
a recebimento, nota fiscal, cobrança Pix ou cartão real.

Os três CSVs comerciais não trazem potência solar, potência de rede, despacho
ou estado de bateria históricos. Posto e Residência têm geração solar nos CSVs,
mas não potência de rede medida nem SOC/despacho de baterias. No Posto, `BAT_01`
e `BAT_02` são componentes independentes do perfil GIE; disponibilidade no
manifesto não é estado de carga histórico. A Residência oficial não possui
bateria. Gráficos devem deixar ausentes os campos desconhecidos, sem derivar
potência de rede ou estado de bateria por diferença. Nenhuma série sintética é
telemetria física atual.

## Fronteira operacional

- `demo_import_batches`, `demo_charging_sessions`, `demo_payments` e
  `demo_energy_readings` são as únicas tabelas previstas para o histórico. A
  migração 0002 é aditiva. Nenhuma sessão ou pagamento fictício deve entrar em
  `charging_sessions`, `payments`, `payment_intents` ou nas leituras operacionais.
- A API de histórico usa proprietário autenticado, estação e lote `ACTIVE`.
  Cada consulta individual deve verificar a titularidade; a visão de rede deve
  partir somente das estações da mesma conta. Filtros de data, canal e método
  afetam apenas os resultados demonstrativos. Lotes `STAGED` ou `SUPERSEDED`
  não devem aparecer como ativos.
- A Shopping mantém as recargas comerciais legadas, o GIE original e as 16
  cenas de apresentação. O vínculo de histórico GIE não transforma setpoints
  simulados em medição faturável nem inicia migração operacional V3.
- Posto e Residência permanecem `DRAFT`/`PRIVATE`/`SIMULATED`, com carregadores
  pendentes, sem gateway OCPP, despacho físico ou pagamento real. O requisito
  de medição física continua para qualquer operação comercial real.
- O painel operacional deve continuar a consultar suas próprias tabelas. Na
  ausência de operações efetivas, seus indicadores de sessão paga e receita
  devem ficar em zero. O histórico demonstrativo tem rótulo e navegação
  próprios, sem ser somado ao financeiro real.

## Verificação antes de propor qualquer publicação

1. Revisar os três PRs na ordem acima, o head exato, o diff completo, os hashes
   dos CSVs e a migração. Registrar o commit aprovado integral e os testes do
   head final. Confirmar que CI não aciona deploy por webhook ou automação
   externa, pois o workflow do repositório sozinho não prova isso.
2. Repetir os testes em MySQL 8 **local e descartável**: esquema base seguido
   dos patches 0001 e 0002; conta de teste proprietária das três estações;
   importação, reimportação idempotente, reset de **um lote identificado**,
   filtros, segregação de outra conta, somas e reconciliação por estação.
   Conferir contagens e amostras das tabelas operacionais antes e depois. Testar
   que o importador não chama provedores, comandos OCPP ou workers físicos.
3. Conferir no Site os três históricos individuais, a visão de rede, os
   períodos corretos, gráficos de 15 minutos agregados sem perda de significado,
   canais e métodos separados, estados vazios, rótulo SIMULATED e os indicadores
   operacionais reais isolados. Verificar as 16 cenas comerciais, GIE V3 do
   Posto/Residência, alertas e persistência previstos no PR #2.
4. Para a VPS, coletar **somente depois de autorização de acesso**: inventário
   de versão/UUID do MySQL, schema efetivo e migrations/recibos, espaço em disco
   e memória, tamanho das tabelas, ocupação de `alerts`, volumes GIE, estado dos
   serviços e jobs, filas/recargas ativas, janelas de manutenção, backups
   recentes e evidência de restauração. Não presumir que os dados da auditoria
   anterior ainda refletem a VPS de hoje. O custo de armazenamento deve ser
   medido na carga local, pois os campos JSON de proveniência afetam o volume.

## Sequência futura, sujeita a aprovações específicas

1. Aprovar e integrar os PRs de dependência e este PR; obter um commit imutável
   em `origin/main`. A publicação no GitHub, por si só, não altera registros
   MySQL e não constitui aprovação de deploy.
2. Solicitar aprovação **específica para o patch 0001** e, em etapa própria,
   **para o patch 0002**. Seguir `docs/DATABASE_CHANGE_POLICY.md` e as notas
   `site/emps-site-main/database/patches/0001-gie-v3-multistation.md` e
   `0002-demo-history.md`: revisar SQL integral, conferir checksums, backup
   novo e restaurável, esquema real, compatibilidade e recibo. A aplicação
   privada exige commit integrado em `origin/main`. O procedimento de atualização
   atual bloqueia diffs Prisma/database; sua adaptação requer revisão e não
   deve ser contornada por `db push`, `migrate reset` ou `--allow-db-risk`.
3. Após cada expansão estrutural aprovada, validar tabelas, índices, chaves,
   contagens operacionais e diff Prisma em leitura. DDL MySQL pode deixar
   aplicação parcial: uma falha exige inspeção e novo plano/patch aprovado.
4. Solicitar autorização separada para publicar backend/frontend e configurar
   os serviços na Hostinger. Confirmar capacidade da VPS, variáveis privadas,
   roteamento dos workers GIE, isolamento da Shopping e ausência de comandos
   físicos nas duas demonstrações. Fazer uma verificação funcional com a versão
   publicada antes de preencher qualquer histórico.
5. Solicitar autorização separada para identificar a conta proprietária real,
   cadastrar ou confirmar Posto/Residência privados e importar **dados
   demonstrativos**. O importador atual de desenvolvimento bloqueia produção e
   exige MySQL em loopback com nome de banco de teste confirmado. A etapa
   oficial precisa de um procedimento específico, revisado e aprovado; não
   remover o bloqueio nem copiar banco local sobre o oficial. Conferir
   identidades GIE, mapeamento dos carregadores, hashes, versão/semente/tarifa e
   contagens esperadas antes de ativar os lotes. A Shopping exige identidade
   comercial fixada; um mapeamento físico de `AC_01`–`AC_04` não deve ser
   presumido.
6. Verificar cada lote ativado e o acesso pelo proprietário; registrar ID do
   lote, dataset, hash, cenário, semente, contagens, energia e receita **simulada**.
   Comparar novamente as contagens das tabelas operacionais e o funcionamento
   das recargas reais. Nenhum passo autoriza cobrança ou movimentação financeira.

## Falha, retorno e limpeza de lote

Se uma carga falhar, preservar o lote `STAGED` para diagnóstico; ele não deve
ser exibido como histórico ativo. Reimportar o mesmo dataset/cenário/semente
deve reutilizar o lote íntegro e não duplicar linhas. Um novo cenário cria
outro lote; a ativação marca o lote anterior como `SUPERSEDED`. O retorno de
código não desfaz SQL ou dados.

Uma limpeza de dados demonstrativos precisa identificar **estação e UUID do
lote** e contar previamente sessões, pagamentos e intervalos afetados. Apagar
somente esse lote, em ordem pagamentos, sessões, intervalos, lote, sob transação
e autorização de proprietário; conferir os mesmos totais após a operação.
Nunca usar exclusão global, limpar histórico financeiro real ou restaurar um
dump antigo por cima de transações novas. Se o problema for estrutural, seguir
o recibo e o plano de correção de `docs/DATABASE_CHANGE_POLICY.md`; não repetir
automaticamente um DDL parcialmente aplicado.

## Regressão GIE local nesta revisão

Execução em 15/10/2026, somente no checkout local. Os comandos abaixo foram
rodados na pasta indicada, com `PYTHONPATH=src`,
`PYTHONDONTWRITEBYTECODE=1` e `-p no:cacheprovider` nos testes Python. Nenhum
comando tocou a VPS ou o banco oficial.

| Pasta e comando | Resultado | Cobertura relevante |
| --- | --- | --- |
| `gie/GIE`: `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider tests/gie_control/test_control.py -k "test_scene or test_offline_all_scenes"` | **17 aprovados**, 33 não selecionados | As 16 cenas comerciais passam validação de física/comportamento; o teste adicional percorre todas offline, sem conexão de rede. |
| `gie/GIE`: `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider src/gie_energy_v3/test_math.py -k "test_01_no_battery_priority or test_03_two_distinct_batteries_soc or test_04_battery_unavailable"` | **3 aprovados**, 20 não selecionados | Caso sem bateria, duas baterias com estados separados e bateria indisponível. |
| `gie/GIE`: `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider src/gie_energy_v3/test_math.py::Mathematics::test_22_checkpoint_and_sequential_energy` | **1 aprovado** com `TEMP`/`TMP` em diretório local gravável | Persistência de energia entre ciclos e rejeição de checkpoint com outra identidade de estação. |
| `site/emps-site-main/backend`: `npx tsx --test tests/gie-v3.test.ts` | **14 aprovados** | Provisionamento das duas baterias, identidade por estação, troca de geração, eventos e alertas, instalação privada sem OCPP, manutenção da rota comercial legada e bloqueio de recarga/pagamento/comando físico nas duas demonstrações. |
| Leitura JSON de `src/gie_control/assets/scenes.json` e dos manifestos Posto/Casa | **Verificações aprovadas** | 16 cenas; Posto com `BAT_01`/`BAT_02` em inversores distintos e dois EVSEs de 22 kW; Residência com um EVSE de 7 kW e lista de baterias vazia. |
| Raiz do repositório: `git diff --quiet efbc0fa -- gie/GIE/src gie/GIE/models gie/GIE/site_profiles` | **Sem diferenças** | Código GIE, modelos treinados, perfis e cenas continuam idênticos ao commit base do PR #2. Os dois CSVs de sessões adicionados ficam em `gie/GIE/data`. |

O teste com três **processos reais** em
`src/gie_multistation/test_isolation.py` foi iniciado duas vezes, com seleção
dos casos 01–05 (incluindo igualdade exata das 16 cenas no serviço), e não
concluiu a inicialização dos workers após mais de 90 segundos em cada tentativa;
foi interrompido sem resultado de aprovação/reprovação. A segunda execução
usou `TEMP`/`TMP` gravável, portanto esse limite não se explica apenas pelo
diretório temporário restrito. O teste local de checkpoint falhou inicialmente
com `PermissionError` nesse diretório restrito e **passou** quando executado
com um diretório temporário gravável, removido ao final. A bateria de testes
acima não substitui um novo ensaio de processos reais e eventos persistidos em
ambiente capaz de iniciar os três workers; nenhum sucesso foi presumido para
esse ensaio interrompido.
