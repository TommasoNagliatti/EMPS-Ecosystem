# Validação da integração MySQL local (17/10/2026)

## Origem, cópia e preservação

Esta validação usou somente três contêineres **locais**. O banco antigo
`emps-mysql:3306/emps_db` foi auditado antes de qualquer patch: 10 usuários,
8 estações, 13 carregadores, 65 sessões operacionais, 61 pagamentos e
45 intenções. A Shopping Frei Caneca já existia como estação **39**, sob a conta
proprietária **105**. O dump transacional foi salvo fora do Git em
`C:\goodwill_ai\EMPS_BACKUPS\emps_db_integration_20261017.sql`, SHA-256
`57B59D2BAF2F0E67C17A380D4C574DDD749388895F3E939FC96765B113AE73CB`.

O dump foi restaurado em `emps-legacy-integration-mysql:3308/emps_integration_test`
com volume próprio. Somente essa cópia recebeu os patches **0001–0003**. A
estrutura final possui 36 tabelas. A preparação idempotente preservou a
Shopping 39 e adicionou Posto **46** e Residência **47** ao proprietário 105.
Essas instalações estão em DRAFT/PRIVATE/PENDING/SIMULATED, sem gateway OCPP.
A conta de revisão local foi criada na cópia, sem alterar as dez contas antigas.

| Banco local | Usuários | Estações | Carregadores | Sessões operacionais | Pagamentos operacionais |
| --- | ---: | ---: | ---: | ---: | ---: |
| Antigo 3306, preservado | 10 | 8 | 13 | 65 | 61 |
| Demonstrativo 3307, preservado | 1 | 3 | 7 | 0 | 0 |
| Cópia de integração 3308 | 11 | 10 | 16 | 65 | 61 |

Na cópia, as tabelas demonstrativas contêm **7.808** eventos de sessão,
**5.044** recargas cobradas e **87.456** leituras de 15 minutos. A importação
repetida retornou os mesmos lotes e não duplicou registros. As verificações
somente leitura `CHECKSUM TABLE ... EXTENDED` de sessões, pagamentos, intenções,
comandos e reservas operacionais coincidiram entre 3306 e 3308. Nenhuma
conexão ao MySQL oficial ou à Hostinger foi usada.

## Navegação e reconciliação

O Site integrado em `http://127.0.0.1:3010` consumiu o Backend local 3011,
com `NEXT_PUBLIC_EMPS_DEMO_MODE=false`. O login da conta local de revisão
mostrou as **dez** estações. O proprietário testou `admin.dev@emps.local` com
sua senha antiga na porta 3010 e confirmou que entrou. A porta 3000 continua
ligada ao ambiente demonstrativo separado e não valida o login antigo.
Essa conta antiga possui permissão para a estação 13 na cópia; o navegador
mostrou ali seus três carregadores e 43 pagamentos operacionais. Para navegar
pelas dez estações com uma única conta, use o administrador local de revisão.

| Instalação | Período original | Recargas cobradas | Energia EV | Receita simulada |
| --- | --- | ---: | ---: | ---: |
| Shopping 39 | jan–jun/2026 | 2.917 | 46.082,44 kWh | R$ 101.381,31 |
| Posto 46 | jan–dez/2025 | 2.085 | 39.495,74 kWh | R$ 86.890,68 |
| Residência 47 | jan–dez/2025 | 10 visitantes | 756,42 kWh no total | R$ 434,72 |

Na Residência, **32** das 42 sessões são uso próprio sem receita e **10** são
visitantes cobrados. O dashboard anual, os cartões dos carregadores, as sessões
e o comparativo exibiram esses totais coerentemente. Os cartões dos dois
carregadores do Posto e do único residencial indicam PENDING e ausência de
conexão física; ações de reinício e manutenção ficam desabilitadas no contexto
demonstrativo. O contexto operacional mostrou R$ 0,00 hoje no Posto e na
Residência, sem copiar a receita simulada para pagamentos reais. Na cópia,
os 61 pagamentos operacionais antigos continuam em três estações legadas,
separados das tabelas demonstrativas.

O comparativo sem filtro retornou 5.044 recargas, **86.334,61 kWh** e
**R$ 188.706,71** de receita simulada; a soma reconcilia com as três linhas.
Com filtro de 2025, a Shopping ficou sem resultados e o total foi 2.127
recargas, **40.252,17 kWh** e **R$ 87.325,40**. Com canal App EMPS, a receita
foi **R$ 94.628,75**; App + Pix, **R$ 41.256,71**. O comparativo mantém as
datas de origem e usa meses cobertos para as médias mensais.

## GIE, segurança e testes

Os três workers V3 iniciaram juntos em 8540; o GIE comercial legado da Shopping
rodou em 8530. Cada perfil recebeu um ciclo **SIMULATED**, com
`hardware_commands_sent=false` e `physical_dispatch=false`. O Posto apresentou
BAT_01 **54,6%** e BAT_02 **52,5%** na Inteligência e na Visão geral; após um
ciclo local de 15 minutos, ambos os locais passaram para **56%** e **57,2%**
na ordem correta. A Residência continuou com “Sem bateria instalada”. Antes
do primeiro ciclo, o estado era revisão 0 e a interface corretamente indicava
decisão indisponível. O launcher agora executa apenas esse primeiro ciclo
quando a decisão ainda não existe; após reiniciar os workers, isso avança o
cenário em 15 minutos simulados.

O launcher limita o Backend ao clone 3308, sandbox de pagamentos, sem OCPP,
sem comandos físicos e com escopo operacional de recarga vazio. Os jobs de
sessões e reservas não podem alcançar os registros antigos; a atualização
automática das decisões GIE continua ativa. O script de parada encerra apenas
os quatro processos locais registrados e preserva contêineres/volumes.

- Backend: build NestJS passou; **167 testes passaram**, oito testes MySQL
  condicionais foram ignorados, nenhuma falha. O teste WebSocket passou na
  suíte completa com loopback permitido. Nenhum teste escreveu em MySQL.
- Frontend: verificação TypeScript e **217 testes passaram**. O build Next.js
  completo com Webpack gerou **18 páginas**, incluindo dashboards e
  `/stations/overview`. O Turbopack havia ficado parado neste Windows; o
  build Webpack suportado passou.
- GIE: testes das 16 cenas comerciais e prévia isolada foram executados.
  **54 testes passaram** com loopback local permitido.

Capturas da validação: [lista das dez estações](evidence/legacy-local/stations.png),
[Residência anual](evidence/legacy-local/residencia-annual.png),
[Posto com GIE ativo](evidence/legacy-local/posto-gie.png),
[comparativo](evidence/legacy-local/network-overview.png) e cartões de
carregador [antes](evidence/legacy-local/charger-before-mobile.png) e
[depois](evidence/legacy-local/charger-after-mobile.png) no mesmo viewport.

Para iniciar e consultar a senha da conta local, siga
[as instruções de prévia](local-legacy-integration.md). O arquivo de credenciais
fica fora do repositório. Nenhum merge ou deploy foi feito.
