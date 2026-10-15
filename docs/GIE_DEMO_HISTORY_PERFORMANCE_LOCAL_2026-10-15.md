# Histórico demonstrativo GIE — desempenho e espaço no MySQL local

Medição em 2026-10-15, no MySQL 8 **descartável** `emps-demo-visual-mysql`, em
`127.0.0.1:3307/emps_demo_test`. As três importações estavam ativas: 7.808
tentativas de recarga, 5.044 pagamentos simulados e 87.456 leituras de 15
minutos. Nenhuma consulta foi feita ao MySQL oficial.

## Latência do comparativo

O serviço original (`50cc7c5`) transferia as 87.456 leituras para o processo
Nest/Prisma e agregava os valores diários em JavaScript. A versão revisada
agrega médias e somas diárias no MySQL e consulta somente a última observação
de bateria não nula por dia. A resposta mantém as sessões e todos os campos
anteriores; o SQL usa parâmetros Prisma para lote, estação e período.

| Rodada | Ordem | Serviço original | Agregação SQL |
| --- | --- | ---: | ---: |
| 1 | original → SQL → SQL → original | 2.972 / 3.542 ms | 1.562 / 1.131 ms |
| 2, com cache aquecido | original → SQL → SQL → original | 1.721 / 2.070 ms | 780 / 740 ms |

Essas quatro medições por versão são de **serviço/Prisma, sem HTTP ou navegador**,
no mesmo banco e processo de teste. Variam conforme cache do InnoDB e carga da
máquina; as leituras anteriores de 5,8–6,7 s foram feitas em outra execução
local, antes desta mudança. A consulta SQL com `channel=CAIXA&method=CASH`
levou 343–558 ms e retornou as mesmas 618 sessões simuladas.

Comparei a resposta antiga e a nova no banco completo: resumo, meses,
sessões, canais, métodos e 911 dias de leitura concordaram. As medidas de cada
dia tiveram diferença inferior a `0,000001`; os estados das duas baterias do
Posto foram idênticos em todos os 365 dias. Shopping manteve 181 dias sem
bateria; Residência, 365 dias sem bateria. Receita total permaneceu
R$ 189.936,12, sem tocar os ledgers operacionais.

`EXPLAIN` da agregação da Shopping escolheu o índice
`uq_demo_readings_source` pelo `batch_id` e estimou 39.086 linhas; o agrupamento
por dia usa tabela temporária e ordenação. O acesso no fixture completo ficou
abaixo de 1,6 s mesmo sem índice adicional. Um índice mais largo aumentaria o
espaço e exigiria outra migração; não há evidência local de necessidade.

## Espaço e proveniência

`information_schema.TABLES` estimou **200,94 MiB** para dados e índices das
quatro tabelas demonstrativas nesta importação, dos quais **183,88 MiB** são
`demo_energy_readings`. O valor anteriormente observado de cerca de 216 MiB
é uma estimativa da mesma ordem, sujeita a alocação e fragmentação do InnoDB.
`TABLE_ROWS` é estimativo e não foi usado para validar contagens.

`JSON_STORAGE_SIZE(source_payload)` somou **139,59 MiB** nas 87.456 leituras;
os 11 CSVs de origem ocupam **50,93 MiB** no workspace. O Posto possui ainda
**2,37 MiB** de estados de bateria em JSON. O `source_payload` repete os
campos brutos para permitir auditoria linha a linha no banco, além dos hashes
SHA-256 e arquivos de origem preservados nos lotes. A otimização de consulta
não remove, comprime nem altera esses payloads.

Uma futura compactação física exigiria migração própria, comparação de hashes
e avaliação do suporte real do MySQL de destino. Não foi aplicada nesta etapa
para manter a proveniência integral e a compatibilidade do patch 0002 já
validado.
