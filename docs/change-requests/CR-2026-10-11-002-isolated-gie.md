# CR-2026-10-11-002 - Teste GIE isolado

Data: 11/10/2026. Repositorio EMPS-Ecosystem-2026-10-07.
Base Git: 3fc3bc58fb27b48c21fc69a2ce44049365ddf7b1.
Alteracoes anteriores no working tree foram preservadas. Nao houve commit,
push ou publicacao em producao nesta solicitacao.

## Solicitacao e limites

O usuario pediu o GIE online no painel da instalacao Shopping Frei Caneca e
escolheu explicitamente um teste isolado neste PC. A instalacao 39 tem dois
carregadores, mas nao tem associacoes GIE nem fontes de telemetria cadastradas.
Este teste nao supre essas ausencias com registros artificiais na base oficial.

Resultado pretendido: painel > Inteligencia > GIE - Teste local, conectado a
um replay autenticado do prototipo. Sao 16 cenas existentes, quatro EVSEs
virtuais e atualizacao automatica. Nao e leitura de equipamentos reais nem
homologacao do GIE em producao. Dados ausentes no painel oficial continuam ausentes.

## Arquivos novos

| Arquivo (relativo ao repositorio) | Conteudo |
|---|---|
| gie/GIE/service/isolated_preview.py | Fabrica FastAPI GET-only autenticada; valida opt-in e ausencia de credenciais operacionais. Reutiliza GIEControl em PRESENTATION, cena 05, intervalo 10 s, loop de 16 cenas. Identifica origem LOCAL_ISOLATED_GIE_DEMO, isolated=true e hardware_confirmed=false. Quatro IDs virtuais sem sessoes associadas. |
| site/emps-site-main/backend/src/local-gie-demo.service.ts | Validacao de configuracao; leitura de acesso a instalacao pelo escopo existente; GET em loopback autenticado; deduplicacao de consultas simultaneas; validacao de origem, instalacao, modo e frescor; falha segura offline. |
| site/emps-site-main/backend/tests/local-gie-demo.test.ts | Sete testes de opt-in, autorizacao, isolamento, concorrencia, falhas, ambiente Python e bloqueio de comandos. |
| gie/GIE/tests/service/test_isolated_preview.py | Quatro testes de contrato, autenticacao GET-only, avancos/loop limitados e ambiente sem credenciais. |
| site/emps-site-main/frontend/tests/local-gie-demo.test.cjs | Dois testes de nao substituicao da telemetria oficial e renderizacao simulada com comandos desabilitados. |
| docs/change-requests/CR-2026-10-11-002-isolated-gie.md | Este registro de alteracao. |

## Arquivos existentes alterados

| Arquivo | Alteracao exata desta solicitacao |
|---|---|
| site/emps-site-main/backend/src/app.module.ts | Importa e registra LocalGieDemoService como provider. |
| site/emps-site-main/backend/src/gie.service.ts | Envelope recebe identificadores opcionais de isolamento. Controller injeta o novo servico e desvia somente GET state/health da instalacao configurada, com verificacao de acesso. Motor operacional e sample nao foram alterados. |
| site/emps-site-main/backend/scripts/remote-development.cjs | Valida replay opcional/porta/instalacao existente, inicia e supervisiona Python em loopback, confere health, passa ambiente minimo sem credenciais, repassa opt-in so ao Nest e remove as quatro variaveis do ambiente Next. Desligado por padrao. |
| site/emps-site-main/backend/.env.remote.example | Acrescenta quatro campos opcionais desativados, sem segredos. |
| site/emps-site-main/backend/.env.remote (privado/ignorado) | Acrescenta somente quatro variaveis para habilitar replay na instalacao 39/porta 8013, com token local separado. Hash normalizado das demais linhas permaneceu identico. Nao incluir arquivo ou token no controle de versao. |
| site/emps-site-main/frontend/domain/gie.ts | Tipos opcionais de isolamento/origem/confianca; energyFromGie recusa origem isolada como telemetria operacional. |
| site/emps-site-main/frontend/components/dashboard/AdminDashboard.tsx | Usa somente GIE online NAO isolado para sobrescrever telemetria/mode do dashboard. Replay fica restrito ao controle GIE. |
| site/emps-site-main/frontend/components/energy/GieControls.tsx | Identifica Teste local/Simulacao isolada e carregadores virtuais; aviso de ausencia de hardware/cobranca/escrita; desabilita comandos do replay. Mantem polling com deduplicacao e pausa em aba oculta. |
| site/emps-site-main/frontend/tests/energy-flow.test.cjs | Regressao garantindo que energyFromGie nao transforma o replay em dados oficiais. |
| docs/REMOTE_DEVELOPMENT_HOSTINGER.md | Documenta opt-in, portas, isolamento, inicializacao e desligamento do replay. |

## Caminho dos dados e seguranca

Navegador local autenticado -> Nest local:3011 -> SELECT de autorizacao na
base oficial -> GET autenticado Python 127.0.0.1:8013 -> cenas locais do GIE ->
resposta marcada como simulacao -> somente controles da aba Inteligencia.

- MySQL oficial continua acessado com SELECT-only por tunel SSH restrito.
- Jobs, comandos fisicos e efeitos externos de pagamento continuam desabilitados.
- POSTs GIE e mutacoes Prisma continuam bloqueados; nao ha excecao para simulacao.
- Python nao recebe DATABASE_URL, JWT ou credenciais de integracao.
- Token local separado do JWT; nenhum segredo foi incluido neste documento.
- Resposta incorreta, antiga ou de outra instalacao deixa o teste offline.
- Cada consulta confirma autorizacao; consultas simultaneas compartilham somente o replay, nao permissoes.
- Sem alteracao no esquema SQL, migrations, usuarios, senhas, permissoes, associacoes, telemetria, sessoes ou tarifas.
- Sem alteracao nos calculos, modelos, perfis ou cenas originais do GIE.
- Sem mudanca no aplicativo movel, firmware, equipamentos ou VPS.

## Verificacao automatizada

| Verificacao | Resultado |
|---|---|
| Backend npm run build | Aprovado |
| Backend npm test | 87 testes: 79 aprovados, 8 integracoes MySQL ignoradas deliberadamente, 0 falhas |
| Frontend node --test tests/*.test.cjs | 118 aprovados, 0 falhas |
| GIE unittest discover -s tests/service | 11 aprovados, 0 falhas; inclui os 4 novos |
| Configuracao privada | Somente quatro novas linhas; demais configuracoes identicas por SHA-256 normalizado |

As integracoes MySQL que escrevem fixtures nao foram habilitadas sobre a base
oficial. Houve aviso de deprecacao Starlette/httpx nos testes existentes;
nao impediu a execucao. Dependencias nao foram atualizadas nesta solicitacao.

## Execucao e evidencia visual

O iniciador local foi reiniciado em previa otimizada; build Next aprovado.
Hostinger, Docker oficial e servicos de producao nao foram reiniciados.
Preflight confirmou emps_db/MySQL 8.0.46, identidade fixada, grants de leitura,
8 estacoes, 13 carregadores e NO_PRISMA_DIFF, com todas as protecoes ativas.
Essas contagens e a comparacao de esquema nao sao um checksum integral dos
registros; a garantia de nao escrita depende tambem dos bloqueios e grants.

Contrato HTTP real verificado: /state sem credencial = 401; autenticado = 200;
POST /state = 405. Retorno: instalacao 39, isolated=true, hardware_confirmed=false,
source=LOCAL_ISOLATED_GIE_DEMO, quatro virtual-evse sem session_id. Nenhuma URL
GIE operacional esta configurada. Credenciais nao foram exibidas.

A aba Inteligencia mostrou GIE - Teste local / Conectado / Simulacao isolada,
com os quatro slots virtuais. A interface avancou pelas cenas 7, 8, 9, 10 e 11,
mudando potencia e mensagem automaticamente. Dashboard permaneceu com dois
carregadores reais, zero em uso e campos de telemetria indisponiveis, sem
substituicao pelos valores do replay. A sessao existente foi preservada no
navegador durante esta reinicializacao; nao houve reset de senha ou novo usuario.

Capturas verificadas em viewport normal e 390 x 844; layout compacto manteve
os quatro slots e textos sem sobreposicao. O tamanho original foi restaurado.

- output/CR-2026-10-11-002/gie-teste-local.png
- output/CR-2026-10-11-002/gie-teste-local-mobile.png
- output/pdf/EMPS_GIE_TESTE_ISOLADO_2026-10-11.pdf
- output/CR-2026-10-11-002/change-manifest.json

Os logs locais de inicializacao foram armazenados no diretorio privado/ignorado
reports/hostinger; nao devem ser publicados. Um manifesto registra hashes antes
e depois somente dos arquivos desta solicitacao, sem conteudo da configuracao
privada. Saidas compiladas dist/ e .next-remote-preview sao artefatos gerados,
nao alteracoes manuais de codigo-fonte. Nenhuma dependencia foi modificada.

## Desligamento e integracao futura

Definir EMPS_LOCAL_GIE_DEMO=false em backend/.env.remote e reiniciar o iniciador
local. Nenhuma reversao SQL e necessaria. O comando stop-remote-dev.ps1 encerra
somente a arvore de processos do iniciador registrado.

Para GIE real, o grupo precisa aprovar o mapeamento dos equipamentos, fontes
de telemetria e acesso operacional. Online neste teste significa conexao com
software simulado, nao conexao fisica com o eletroposto.
