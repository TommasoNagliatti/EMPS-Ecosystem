# Resultado da integração MySQL local do histórico demonstrativo

**Data:** 15/10/2026. **Escopo:** contêiner MySQL 8.0.46 descartável,
publicado somente em `127.0.0.1:3307`, banco `emps_demo_test`. O teste não
conectou à Hostinger nem ao MySQL oficial. O esquema foi carregado a partir de
`database/EMPS_Database_Completo.sql` com o nome de banco trocado apenas na
cópia enviada ao contêiner, seguido dos patches 0001 e 0002. Ambos os patches
terminaram sem erro. O SQL 0002 usado teve SHA-256
`8dfc5fa008d4d864ee43bf7859309aaf4bc9688cb3630006b95793ff37bc5945`.

Para reproduzir, iniciar `mysql:8.0` **sem volume** e com publicação de porta
restrita a `127.0.0.1:3307`; criar apenas `emps_demo_test`, copiar o SQL base
para esse banco, aplicar 0001 e 0002 em ordem e gerar o Prisma Client local.
Executar os três scripts de teste mencionados aqui com `NODE_ENV=test`,
`EMPS_REMOTE_DEVELOPMENT=false`, `DEMO_HISTORY_TEST_DATABASE=emps_demo_test` e
`DATABASE_URL` apontando ao usuário **não root** desse contêiner. O importador
CLI exige essas mesmas salvaguardas no modo `--apply`; seu modo `--plan` lê CSVs
sem banco. Encerrar/remover o contêiner ao fim dos testes, sem reaproveitar um
banco real nem um túnel para a VPS.

O teste de carga está em `site/emps-site-main/backend/scripts/demo-history-mysql-smoke.ts`.
Ele cria uma conta e três estações **somente no banco descartável**, preserva
Posto e Residência em `DRAFT`/`PRIVATE`/`SIMULATED`, importa os arquivos
originais, repete a carga, verifica titularidade e remove/reimporta apenas o
lote identificado da Residência. O CLI `--plan` também leu os três datasets sem
abrir conexão com o banco.

| Instalação | Tentativas gravadas | Pagamentos simulados | Leituras de 15 min | kWh AC das sessões | Receita simulada com R$ 2,20/kWh |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shopping | 5.477 | 2.917 | 17.376 | 46.082,4414175900 | R$ 101.381,31 |
| Posto | 2.289 | 2.085 | 35.040 | 39.495,7439304049 | R$ 86.890,68 |
| Residência | 42 | 42 | 35.040 | 756,4236898176 | R$ 1.664,13 |
| **Total** | **7.808** | **5.044** | **87.456** | **86.334,6090378125** | **R$ 189.936,12** |

Canal e método são dimensões **separadas** do pagamento fictício. No teste,
as contagens por estação foram:

| Instalação | APP_EMPS | WEB_CHARGE | CAIXA | PIX | Cartão de crédito | Cartão de débito | Dinheiro |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Shopping | 1.470 | 854 | 593 | 1.036 | 992 | 523 | 366 |
| Posto | 1.047 | 616 | 422 | 710 | 739 | 387 | 249 |
| Residência | 19 | 15 | 8 | 17 | 15 | 7 | 3 |

Cada lado de cada linha soma o número de pagamentos simulados da instalação.
As distribuições foram geradas pela semente `20261015` e pelo cenário
`demo-finance-v1`; não são dados de recebimento observados nos CSVs.

Uma consulta `GROUP BY` diretamente em `demo_payments` confirmou também a
distribuição de valores na rede inteira:

| Dimensão | Valor | Pagamentos | Receita simulada |
| --- | --- | ---: | ---: |
| Canal | APP_EMPS | 2.536 | R$ 95.224,23 |
| Canal | WEB_CHARGE | 1.485 | R$ 56.152,27 |
| Canal | CAIXA | 1.023 | R$ 38.559,62 |
| **Canais** | **Total** | **5.044** | **R$ 189.936,12** |
| Método | PIX | 1.763 | R$ 65.318,70 |
| Método | Cartão de crédito | 1.746 | R$ 66.212,97 |
| Método | Cartão de débito | 917 | R$ 35.148,22 |
| Método | Dinheiro | 618 | R$ 23.256,23 |
| **Métodos** | **Total** | **5.044** | **R$ 189.936,12** |

Os dois totais reconciliam exatamente com a soma dos lotes; a tabela não duplica
receita ao combinar canal e método.

Os três lotes terminaram `ACTIVE`. A primeira carga levou 154,6 s no computador
de teste; a segunda levou 15,7 s, retornou os mesmos UUIDs, marcou `created=false`
e não duplicou linhas. O reset da Residência removeu exatamente 42 pagamentos,
42 sessões e 35.040 leituras do seu lote; a carga seguinte recriou somente esse
lote. Uma conta proprietária diferente não conseguiu executar o reset. Depois
dos testes, havia exatamente 3 lotes, 7.808 sessões, 5.044 pagamentos e 87.456
leituras demonstrativas. `charging_sessions`, `payments`, `payment_intents` e
`station_energy_readings` operacionais permaneceram com zero registros na
fixture. O painel operacional de cada estação mostrou zero sessões, zero
pagamentos e zero receita, enquanto a consulta demonstrativa mostrou os valores
da tabela acima.

O mapeamento **opcional e explícito** dos IDs históricos comerciais `AC_01` a
`AC_04` para quatro carregadores EMPS da **mesma** estação também passou no
MySQL. O importador rejeitou um ID pertencente ao Posto, aceitou os quatro IDs
válidos, vinculou todas as sessões atendidas aos respectivos carregadores e
reutilizou o lote sem duplicação quando o mapa foi repetido. Alterar/remover o
mapa de um lote existente exige reset explícito desse lote. Sem mapa comprovado,
o `sourceChargerId` histórico permanece e a FK comercial fica nula; nenhuma
correspondência física é presumida. Esse caso está coberto por
`scripts/demo-history-commercial-map-smoke.ts`.

`scripts/demo-history-read-smoke.ts` consultou os três históricos e o
comparativo da rede no mesmo banco. Resultado: 7.808 tentativas, 5.044 recargas,
R$ 189.936,12 simulados e 18 meses distintos de fonte (12 em 2025, 6 em 2026).
As leituras foram agregadas em 181 dias para Shopping e 365 para cada perfil
novo. A consulta filtrada a 2025 retornou somente 2.127 recargas com kWh. A
primeira implementação sequencial da rede levou 12,8 s; após paralelizar a
consulta das três estações, levou 5,8 s em uma execução e 6,1 s com filtro de
2025, abaixo do timeout de 12 s do frontend. Os tempos são medições locais de
serviço/Prisma, sem HTTP, e podem mudar com hardware, índices e volume.

Em uma terceira leitura, o comparativo levou 6,7 s sem filtro, 5,5 s com filtro
de 2025 e 5,8 s com `channel=CAIXA&method=CASH`. Este último retornou 618
sessões e R$ 23.256,23, exatamente a contagem e o valor de `demo_payments`
para essa combinação nos três lotes ativos. Uma segunda conta não conseguiu ler
o histórico individual, recebeu rede vazia sem receita e teve negado o filtro
direto pelo ID da Shopping. Essa verificação usou os serviços Nest/Prisma no
banco real de teste, sem HTTP; o frontend e a autenticação HTTP têm testes
separados.

`information_schema.TABLES` estimou cerca de 216 MiB nas quatro tabelas demo
após a carga (aproximadamente 200 MiB em `demo_energy_readings`, sobretudo pelo
JSON de proveniência). `TABLE_ROWS` do InnoDB é estimativo; as contagens acima
vieram de `COUNT(*)`. Capacidade e latência da VPS terão de ser medidas antes
de qualquer proposta de publicação.

Os cenários de tarifa, canal e método são hipóteses determinísticas do sistema
de demonstração. Nenhum pagamento foi enviado a provedor, e nenhum comando
físico ou telemetria operacional foi produzido por esses scripts. Os resultados
não provam medições físicas, receita recebida ou compatibilidade com o esquema
real da VPS; ela permanece sem alterações e requer aprovação específica para
cada etapa futura.
