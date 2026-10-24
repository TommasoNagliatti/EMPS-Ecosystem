# Teste visual integrado local — 15/10/2026

## Ambiente e isolamento

Checkout `feat/gie-demo-history-mysql`, base `50cc7c5`. O teste usou apenas
`emps-demo-visual-mysql` (`mysql:8.0`, `127.0.0.1:3307`, banco
`emps_demo_test`), com schema-base do repositório e patches 0001/0002. A
Shopping foi cadastrada como referência comercial local; Posto e Residência
foram criados pelo serviço real de instalações demonstrativas, sob o mesmo
administrador local. IDs: Shopping 1, Posto 2, Residência 3. A Shopping segue
ACTIVE/PUBLIC/APPROVED com GIE legado; Posto e Residência seguem
DRAFT/PRIVATE/SIMULATED sem OCPP. O Frontend rodou com
`NEXT_PUBLIC_EMPS_DEMO_MODE=false` e consumiu a API Nest em `127.0.0.1:3001`.
Comandos físicos, pagamentos externos e gateway OCPP ficaram desabilitados.

Não havia cópia sanitizada e autorizada dos registros existentes do EMPS no
workspace. Por isso, a preservação de um registro da Shopping foi verificada
na base local: três retomadas conservaram o mesmo ID e os mesmos três lotes,
com `created=false` nas importações repetidas. A compatibilidade de dados
específicos do banco oficial ainda depende de uma cópia sanitizada aprovada.
Nenhuma conexão ao MySQL oficial ou à VPS foi feita.

## Dados importados e conferidos no navegador

| Instalação | Tentativas | Recargas atendidas | Energia | Receita simulada |
| --- | ---: | ---: | ---: | ---: |
| Shopping Frei Caneca | 5.477 | 2.917 | 46.082,44 kWh | R$ 101.381,31 |
| Posto 24h | 2.289 | 2.085 | 39.495,74 kWh | R$ 86.890,68 |
| Residência | 42 | 42 | 756,42 kWh | R$ 1.664,13 |
| Rede | 7.808 | 5.044 | 86.334,61 kWh | R$ 189.936,12 |

Os painéis individuais exibiram sessões paginadas, energia, valores
SIMULATED, evolução mensal, carregadores, canais App/Web/Caixa e métodos
Pix/cartão de crédito/cartão de débito/dinheiro. O comparativo apresentou as
três instalações com seus períodos originais (Posto e Residência em 2025;
Shopping no primeiro semestre de 2026). Um filtro visual de março de 2025,
Posto + App EMPS + Pix retornou 39 recargas, 724,79 kWh e R$ 1.594,51.
Na Shopping, março de 2026 + Caixa + dinheiro retornou 64 recargas,
1.019,23 kWh e R$ 2.242,31. A página operacional `/payments` mostrou zero
transações e R$ 0,00 aprovado na base isolada; a receita fictícia não foi
promovida ao financeiro operacional.

No painel operacional, Shopping manteve o GIE comercial legado e quatro
EVSEs. Posto mostrou dois EVSEs e perfil GIE conectado; o teste do worker
confirmou duas decisões de bateria independentes. Residência mostrou um EVSE,
nenhuma bateria e um alerta de baixa confiança marcado `GIE · simulado`.
As 16 cenas comerciais originais passaram na suíte de isolamento GIE.

## Testes e desempenho

- Iniciador `scripts/start-demo-visual.ps1`: executado com serviços ativos e
  depois de encerrá-los; ambos os caminhos terminaram com Site, API, GIE
  legado e GIE multiestação respondendo. MySQL e lotes foram preservados.
- Frontend: 211 testes aprovados; `tsc --noEmit` aprovado.
- Backend: 36 testes direcionados aprovados; `tsc --noEmit` aprovado.
- GIE multiestação: 16 aprovados, 1 ignorado por manifesto histórico não
  versionado; 0 falhas. Inicialização paralela: 4,72 s, pico simultâneo dos
  três workers de aproximadamente 403 MiB residentes. Ver relatório próprio.
- HTTP `GET /demo-history/network` no banco completo, após a otimização:
  1.139, 1.008, 941 e 907 ms em quatro chamadas locais autenticadas;
  resposta de cerca de 2,06 MB. O SQL agora agrega leituras por dia no MySQL,
  preservando os registros brutos. Ver relatório de desempenho.
- Quatro tabelas demonstrativas ocupavam aproximadamente 200,94 MiB no
  `information_schema`, dos quais 139,59 MiB eram JSON de proveniência.
  Nenhum payload foi removido ou compactado.

O erro inicial de `P1017` observado quando a importação ocorria com o
Backend ativo foi corrigido no timer de atualização do GIE comercial: a
rejeição agora é registrada sem encerrar o processo. O iniciador importa antes
de iniciar a API numa partida limpa e pula a geração Prisma quando a API já
está ativa, evitando bloqueio do DLL no Windows. A causa da execução antiga
de workers acima de 90 s não pode ser provada sem seu log; a restrição de
socket do sandbox foi reproduzida, e a inicialização local dos três passou.

Os serviços ficam vinculados a `127.0.0.1`. O endereço e as credenciais
locais são apresentados pelo iniciador e armazenados fora do repositório.
Não houve deploy nem merge.
