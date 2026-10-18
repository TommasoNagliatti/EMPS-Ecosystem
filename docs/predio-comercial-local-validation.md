# Prédio Comercial: validação da integração local (17/10/2026)

## Ambiente e acesso

A integração foi aplicada exclusivamente na cópia `emps_integration_test` do
contêiner `emps-legacy-integration-mysql`, em `127.0.0.1:3308`. O Site local é
`http://127.0.0.1:3010/login`, a API é `http://127.0.0.1:3011` e o comparativo
é `http://127.0.0.1:3010/stations/overview`. O Frontend usa
`NEXT_PUBLIC_EMPS_DEMO_MODE=false`. O MySQL antigo 3306, o demonstrativo 3307,
o MySQL oficial e a Hostinger não foram alterados.

Antes da integração, uma cópia transacional verificada da base 3308 foi salva
fora do Git em `C:\goodwill_ai\EMPS_BACKUPS\emps_integration_pre_predio_20261017.sql.gz`
(SHA-256 `E9AA117C7E79EED5302069BC31F0F93E158CD28F7E1C29FD742570A2034AD750`).

Uma consulta somente leitura confirmou a conta antiga
`admin.dev@emps.local` (ID 64) ativa, proprietária do **Prédio Comercial**
(estação 13) e integrante `MANAGER` do Posto 24h (46) e da Residência (47).
As duas últimas continuam pertencendo à conta 105 e permanecem
`PENDING/DRAFT/PRIVATE/SIMULATED`, com dois e um carregadores cadastrados,
respectivamente. A estação 13 conservou seus **três** carregadores e a
configuração operacional. A Shopping Frei Caneca (39) continua pertencendo à
conta 105. A cópia ainda contém **65 sessões** e **61 pagamentos** operacionais
antigos; os registros sintéticos estão somente nas tabelas `demo_*`.

O login normal da conta local de revisão funcionou na API e listou dez
estações. Seu perfil é `VIEWER` no Prédio 13; por isso, o histórico financeiro
do Prédio retorna `403` para essa conta, como esperado. Para testar Prédio,
Posto e Residência no Site, use `admin.dev@emps.local` com a senha antiga que
você conhece. Nenhuma senha foi incluída no repositório.

## Fontes, importação e reconciliação

O pacote entregue deriva de `demanda_carregadores_6_meses.csv`, SHA-256
`3c63f7b11e808b0bcb5d4dd66af0a0282ff628a830f2892c03411dbad10ee2cd`.
Seus 2.917 registros de sessão tinham início, carregador e motorista
**inferidos** da demanda agregada. A importação preferiu os eventos individuais
originais de `gie/GIE/data/sessoes_carregadores_6_meses.csv`, preservando IDs,
datas, carregadores e energia. Os canais App/Web/Caixa e métodos
Pix/cartão/dinheiro foram associados deterministicamente como cenário
financeiro fictício versionado. Os motoristas demonstrativos não são usuários
autenticáveis. O lote é idempotente e não usa `charging_sessions`, `payments`
ou `payment_intents`.

| Medida | CSV sintético entregue | Eventos originais importados | Diferença importado − entregue |
| --- | ---: | ---: | ---: |
| Recargas pagas | 2.917 | 2.917 | 0 |
| Energia EV | 46.082,44141781 kWh | 46.082,44141759 kWh | −0,00000022 kWh |
| Receita simulada | R$ 101.381,50 | R$ 101.381,31 | −R$ 0,19 |
| Custo energético estimado | R$ 36.866,29 | R$ 36.865,81 | −R$ 0,48 |
| Margem energética estimada | R$ 64.515,21 | R$ 64.515,50 | +R$ 0,29 |

O lote ativo do Prédio contém **5.477 eventos**, dos quais **2.917** têm
pagamentos simulados, e **17.376 leituras** de 15 minutos, de janeiro a junho
de 2026. A diferença de centavos decorre da escolha dos kWh de cada evento
original e do arredondamento por recarga. Custo e margem são estimativas do
cenário, não lucro líquido nem recebimento operacional.

Os eventos originais identificam quatro carregadores históricos: AC_01 (881
recargas), AC_02 (761), AC_03 (670) e AC_04 (605). Seus `sourceChargerId`
foram preservados, mas todos os `chargerId` demonstrativos do Prédio são
`NULL`: não existe mapeamento comprovado desses quatro IDs para os três
carregadores físicos cadastrados. Nenhum quarto carregador foi criado.

A Shopping 39 e o Prédio 13 têm o **mesmo SHA-256 da fonte energética** e os
mesmos 2.917 pagamentos simulados. A API mantém as duas linhas para análise
individual; quando ambas estiverem autorizadas numa comparação, inclui a
Shopping uma vez nos totais e marca o Prédio como origem compartilhada, sem
duplicar sessões, kWh, receita ou distribuições por canal e carregador. O
teste automatizado cobre esse caso. As permissões atuais não permitem que uma
conta comum veja simultaneamente os dois históricos: a conta de revisão é
`VIEWER` no Prédio, e `admin.dev` não administra a Shopping. Portanto, essa
deduplicação não foi exercitada por navegador com dados vivos sem ampliar
acessos.

Na Residência, a interpretação financeira ativa continua separada do lote
original: **32** recargas próprias com receita **R$ 0,00** e **10** recargas
de visitantes com receita simulada **R$ 434,72**. O lote antigo conserva seus
valores apenas para auditoria; a visão administrativa usa o cenário versionado.

## GIE, testes e limites

O ambiente local iniciou MySQL 3308, Backend 3011, Frontend 3010, GIE V3
8540 e GIE legado da Shopping 8530. Os três workers V3 — Prédio, Posto e
Residência — chegaram à revisão 1; um ciclo do Prédio avançou apenas ele à
revisão 2, e ciclos próprios avançaram Posto e Residência à revisão 2, com
gerações estáveis. Todos confirmaram `physical_dispatch=false` e
`hardware_commands_sent=false`. A Shopping manteve sua apresentação legada:
modo NORMAL → PRESENTATION, cena 1 → 2 das 16 cenas, sem confirmação física;
depois voltou a NORMAL. Nenhum modelo treinado foi alterado.

O build do Backend passou; sua suíte completa teve **173 testes aprovados**,
**8 ignorados** e **0 falhas** quando o teste WebSocket pôde abrir o loopback
local. O Frontend teve **218 testes aprovados**, checagem TypeScript válida e
build Next.js/Webpack completo com 18 páginas. O diff do Frontend não alterou
CSS, layout, sidebar ou desenho dos componentes: ajustou filtros, dados e
textos informativos no comparativo e na nota de origem do histórico.

A API local confirmou o login da conta de revisão, os estados GIE online das
quatro estações e os históricos das estações 39, 46 e 47; o Prédio 13 respondeu
`403` no histórico financeiro para esse perfil `VIEWER`.
A ferramenta de navegador bloqueou a URL local durante esta execução, então
**a inspeção visual final no navegador não foi concluída**. Não há captura de
tela desta etapa. Uma tentativa de usar um token de teste fabricado foi
bloqueada pela revisão automática e não foi contornada. A navegação pessoal
com `admin.dev@emps.local` permanece o teste visual pendente.

## Como abrir a prévia

Na branch `feat/predio-comercial-local-integration`, com a cópia MySQL já
restaurada e as dependências instaladas, execute em PowerShell 7:

```powershell
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\start-legacy-integration.ps1
```

O cadastro e a importação local são idempotentes. Para reaplicá-los após
atualizar a branch, use o script de preparação e depois reinicie apenas os
serviços registrados; o volume MySQL é preservado:

```powershell
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\setup-legacy-integration.ps1
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\stop-legacy-integration.ps1 -WhatIf
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\stop-legacy-integration.ps1
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\start-legacy-integration.ps1
```

O guia [local-legacy-integration.md](local-legacy-integration.md) contém os
pré-requisitos, as verificações do launcher e o procedimento para ler a
credencial da conta local de revisão sem colocá-la no Git.
