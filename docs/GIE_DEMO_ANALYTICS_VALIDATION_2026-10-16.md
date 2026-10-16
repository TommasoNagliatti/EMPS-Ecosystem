# Validação da inteligência demonstrativa — 16/10/2026

Branch de trabalho: `feat/gie-demo-analytics-dashboard`, derivada de
`c2053bb` (PR #3 atualizado). O commit `50cc7c5` continua na ancestralidade.
Esta etapa usa exclusivamente o contêiner MySQL 8 descartável
`emps-demo-visual-mysql` em `127.0.0.1:3307`, com conta local. Nenhuma mudança
foi executada no banco oficial, Hostinger, GIE treinado, App Expo ou SubApp.

## Referência e alteração visual

Antes das edições, o navegador mostrou a página da rede e as vistas de
Shopping, Posto e Residência no mesmo viewport compacto. Na operação real, a
Visão geral mostrava vários campos “Sem dados”; o contexto SIMULATED substituía
o painel inteiro por uma seção de histórico. As capturas foram observadas na
sessão de navegador, mas ainda não foram gravadas como arquivos de comparação.
O código desta branch não modifica CSS, imagens, classes, tamanhos, menus,
animações nem estrutura dos cards. O contexto SIMULATED passa a alimentar os
componentes existentes; a seção detalhada fica na aba **Inteligência** já
existente. A comparação visual antes/depois no mesmo estado ainda depende de
reiniciar o Backend e navegar com o MySQL local.

## Fontes e reconciliação local

| Fonte | Período | Leituras únicas de 15 min | Tentativas / atendidas | Energia EV por intervalos |
| --- | --- | ---: | ---: | ---: |
| Shopping Frei Caneca | jan–jun/2026 | 17.376 | 5.477 / 2.917 | 46.082,44141781 kWh |
| Posto 24h | 2025 | 35.040 | 2.289 / 2.085 | 39.495,743930407 kWh |
| Residência | 2025 | 35.040 | 42 / 42 | 756,4236898174 kWh |

As diferenças para as somas de energia das sessões originais são menores que
`3 × 10⁻⁷ kWh`, devidas ao arredondamento dos CSVs. Para o ano inteiro, a
consulta analítica respondeu em 361 ms (Shopping), 798 ms (Posto) e 445 ms
(Residência) no banco local. Solar: indisponível na Shopping, 75.464,7779918946
kWh no Posto e 8.301,1255791069 kWh na Residência. Importação **medida** da
rede: indisponível nas três fontes. O proxy hipotético calculado por intervalo
é 75.663,4178614345 kWh no Posto e 2.732,9181542178 kWh na Residência;
não é medição nem economia comprovada. Ocupação histórica média:
38,03% / 29,31% / 4,10%. Intervalos com fila: 3.405 / 1.021 / 0.

O cenário financeiro residencial `residential-owner-visitor-v2` reutilizou as
42 sessões originais: 32 usos próprios, sem receita, e 10 visitas, com
R$ 434,72 de receita simulada. O custo energético estimado das visitas é
R$ 158,08 e a margem de contribuição estimada R$ 276,64. O custo estimado do
uso próprio é R$ 447,05; após todo custo EV, o resultado é R$ −170,41 antes
dos demais custos, **não lucro líquido**. Duas reimportações não duplicaram
leituras, sessões ou linhas da camada v2. Os pagamentos v1 residenciais foram
preservados para proveniência, mas a API ativa não os soma na receita v2.

## Testes executados

- Backend: `npm run build` e `npx tsc --noEmit` passaram; 15 testes focados
  de analytics, API, cenário residencial, filtros e isolamento passaram.
- Frontend: `npx tsc --noEmit` e 213 testes passaram. Dois testes novos
  verificam escopo/autorização do endpoint analítico e uso de kWh exatos sem
  reintegrar médias de potência.
- Suite ampla do Backend: 161 passaram, 8 ignorados, 1 falhou no transporte
  WebSocket sob sandbox (`websocket error` onde esperava `Não autorizado`).
  A falha não toca os arquivos desta branch e requer repetição com loopback
  autorizado antes da publicação.
- Build Next.js de produção: Turbopack não conseguiu criar subprocesso no
  sandbox. A tentativa `--webpack` encontrou `.next` ocupada pelo servidor de
  desenvolvimento registrado na porta 3000. O TypeScript e os testes acima
  passaram; o build completo deve ser repetido após parar o serviço local.
- `git diff --check` e análise sintática dos scripts PowerShell passaram.

## Pendências para aceite e publicação

1. Reiniciar o conjunto local com `scripts/stop-demo-visual.ps1` e
   `scripts/start-demo-visual.ps1`, preservando o contêiner MySQL. O iniciador
   verifica identidade dos processos, portas locais e schema antes de agir.
2. Confirmar login, API e MySQL reais no navegador para as três instalações:
   fluxo, Visão geral, gráfico em vários meses, carregadores, sessões,
   motoristas fictícios, canais/métodos, avisos, financeiro real e comparativo.
3. Gravar capturas antes/depois no mesmo viewport e documentar diferenças de
   conteúdo sem mudança de layout ou estilo. Conferir ausência de comandos
   físicos/pagamentos externos pelo navegador e logs.
4. Repetir o build completo e o teste WebSocket com acesso local permitido;
   então registrar commit, publicar branch e abrir PR sem merge.

Em 16/10/2026, o verificador automático de aprovação recusou a execução do
iniciador por **limite de uso** antes de iniciar o comando. Isso não foi uma
conclusão de insegurança. O Backend local está parado; o Frontend e os GIEs
anteriores ainda tinham listeners registrados. Nenhum procedimento alternativo
foi usado para contornar a revisão. Os serviços/arquivos do MySQL local foram
preservados.
