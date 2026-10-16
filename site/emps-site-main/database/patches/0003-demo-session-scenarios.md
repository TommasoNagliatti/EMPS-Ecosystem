# Candidato 0003: cenário financeiro residencial demonstrativo

Estado: **somente ambiente MySQL local descartável nesta etapa**. O SQL em
`0003-demo-session-scenarios.sql` cria apenas `demo_session_scenarios`; a migration
Prisma `20261016_demo_session_scenarios/migration.sql` contém o mesmo SQL.
Nenhuma aprovação para execução no banco oficial decorre deste arquivo.

## Interpretação versionada

`residential-owner-visitor-v2` é uma camada financeira sobre as 42 sessões
originais da Residência. A chave `(session_id, scenario_version)` impede
duplicação. A FK composta restringe cada linha à sessão, estação e lote
demonstrativos correspondentes. O patch não duplica as 35.040 leituras de 15
minutos, não altera kWh ou datas e não escreve nas tabelas operacionais.

A regra explícita marca como **VISITOR** cada quarta sessão pelo ordinal do
`source_session_id` original. As demais sessões concluídas são **OWNER**.
No dataset atual: 32 usos próprios, 10 visitas. Uso próprio representa uma
hipótese de autorização por RFID, sem credencial, usuário autenticável ou
pagamento criado. Receita de uso próprio é zero; custo energético estimado
permanece atribuído à energia consumida. Visitas seguem tarifa simulada de
R$ 2,20/kWh e custo estimado de R$ 0,80/kWh. Canal e método só existem nas
visitas. IDs e nomes dos motoristas são determinísticos e fictícios.

O cenário v1 importado e suas 42 linhas em `demo_payments` permanecem
preservados como proveniência. As consultas da experiência residencial v2
devem usar **explicitamente** `scenario_version = residential-owner-visitor-v2`;
somar pagamentos v1 à receita v2 contaria a mesma sessão duas vezes.

Valores reconciliados atuais: 756,4236898176 kWh no total, sendo
558,8242757770 kWh do proprietário e 197,5994140406 kWh de visitantes.
Receita simulada v2: R$ 434,72; custo energético estimado total: R$ 605,13
(proprietário R$ 447,05; visitantes R$ 158,08). A diferença entre receita e
esse único custo é uma **margem de contribuição estimada**, não lucro líquido:
não há despesas fixas, impostos e manutenção suficientes para calculá-lo.

## Aplicação local e validação

O `CREATE TABLE IF NOT EXISTS` permite repetir o patch no mesmo banco local
descartável. Antes da importação, o aplicador deve confirmar banco de teste em
loopback e MySQL 8, aplicar 0001, 0002 e 0003 em ordem e inspecionar a tabela.
O importador preenche ou verifica as 42 linhas da versão v2 mesmo quando o lote
v1 já existe; reimportar não cria novas leituras ou sessões. Divergência ou
preenchimento parcial da versão v2 é conflito explícito.

Qualquer eventual uso oficial exige revisão separada de esquema, migração,
backup, compatibilidade e autorização específica. Não usar `db push` ou reset
do banco oficial.
