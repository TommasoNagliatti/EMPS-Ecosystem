# CR-2026-10-12-002 | Organizacao e publicacao no GitHub

Data: 12/10/2026. Pedido: consolidar o ecossistema atual no repositorio
`matheus00M7/ecossistema-emps-fiap-test`, com estrutura e orientacao para a equipe.

[Relatorio em PDF](pdf/EMPS_ORGANIZACAO_GITHUB_2026-10-12.pdf).

## Escopo e metodo

Foi criada uma copia de publicacao a partir do working tree atual da versao
recebida de `TommasoNagliatti/EMPS-Ecosystem`. Isso inclui alteracoes locais
consolidadas posteriores ao clone, nao apenas o antigo HEAD do repositorio.
O repositorio destino ja continha README e LICENSE; sua historia e licenca
foram preservadas. Nao foi enviado o historico Git completo do checkout antigo.

O projeto em execucao permaneceu na copia original. Nenhum servico de producao
foi reiniciado; nenhuma tabela, usuario, senha, pagamento ou permissao foi
alterado. O GitHub recebe codigo, nao os registros do MySQL oficial.

## Organizacao

Os limites e caminhos dos componentes foram mantidos para nao quebrar imports,
lockfiles, contratos e iniciadores: `app/emps-charge`,
`site/emps-site-main/{frontend,backend,database}`, `gie/GIE`, `scripts` e `docs`.
Modelos, dados de referencia e evidencias congeladas do GIE foram preservados.
As evidencias selecionadas ja versionadas nao sao dados operacionais de clientes.

Nao foi aplicado workspace com hoisting. O site e o aplicativo precisam de
versoes/projetos independentes. Um `package.json` na raiz agora oferece
comandos de verificacao e inicio para cada componente, sem novas dependencias.

## Inventario completo das edicoes nesta publicacao

Arquivos alterados em relacao a copia fonte:

| Arquivo | Alteracao |
|---|---|
| `README.md` | Novo mapa do ecossistema, URL destino, limites e instrucoes |
| `STARTUP.md` | Execucao limpa por colega, MySQL local, usuario local e testes |
| `START_EMPS_V2.ps1` | Wrapper portavel para start-local; sem pasta fixa ou encerramento automatico de outros checkouts |
| `STOP_EMPS_V2.ps1` | Wrapper para parada por propriedade; InspectOnly usa WhatIf |
| `.gitignore` | Exclusao de artefatos locais, fotos operacionais e arquivos gerados |
| `.github/workflows/ci.yml` | Auditoria de publicacao, todos os testes frontend e API isolada; permissoes de leitura, sem deploy |
| `scripts/emps-v2-processes.ps1` | Raiz descoberta pelo script; removida a selecao do antigo checkout Desktop |
| `site/emps-site-main/README.md` | Componentes atuais, MySQL e caminho real do aplicativo |
| `site/emps-site-main/STARTUP.md` | Redirecionamento ao guia unico da raiz |
| `site/emps-site-main/backend/README.md` | Guia atual da API e avisos contra migrations indevidas |
| `site/emps-site-main/frontend/README.md` | Guia atual, sem senha padrao/PostgreSQL; testes completos |
| `site/emps-site-main/frontend/package.json` | Novo npm test para todos os testes frontend; sem mudar dependencias |
| `site/emps-site-main/database/README.md` | MySQL estrutural e politica de alteracao |
| `site/emps-site-main/database/patches/README.md` | Helper administrativo privado nao acompanha o clone |
| `app/emps-charge/README.md` | Expo 57, API compartilhada, limites do Expo Go e testes nativos |
| `docs/REMOTE_DEVELOPMENT_HOSTINGER.md` | Guia publico generico, sem inventario de acesso individual |
| `docs/DATABASE_CHANGE_POLICY.md` | Aviso explicito sobre helpers administrativos privados |
| `docs/EMPS_V2_ARCHITECTURE.md` | URL do repositorio destino |
| `docs/STRIPE_LOCAL_SETUP.md` | URL do repositorio destino |
| `docs/change-requests/CR-2026-10-07-001.md` | Caminhos de PC substituidos por referencia generica |
| `docs/change-requests/CR-2026-10-07-002.md` | Caminhos de PC substituidos por referencia generica |
| `docs/change-requests/CR-2026-10-07-003.md` | Caminhos de PC substituidos por referencia generica |
| `docs/change-requests/2026-10-09-weather-popups.md` | Caminhos de PC substituidos por referencia generica |
| `docs/change-requests/2026-10-09-overview-date-controls.md` | Local de capturas privado, sem caminho pessoal |
| `docs/change-requests/2026-10-09-settings-consolidation.md` | Local de capturas privado, sem caminho pessoal |

Arquivos novos:

- `.gitattributes`: textos portaveis e formatos binarios; regras exatas do GIE preservadas.
- `package.json`: comandos de manutencao da raiz, sem dependencias.
- `docs/README.md`: indice dos guias e separacao do historico.
- `scripts/check-component.cjs`: verificacoes API/GIE isoladas de credenciais operacionais.
- `scripts/check-publication.cjs`: caminhos proibidos, formatos conhecidos de segredo, SQL estrutural e arquivos obrigatorios.
- `scripts/tests/publication.test.cjs`: cinco testes dos gates de publicacao/estrutura.
- Este registro, o manifesto publico e o PDF desta operacao.

O manifesto `docs/publication-manifest-2026-10-12.json` lista arquivos publicados,
tamanhos, SHA256 e comparacao com a copia fonte. O proprio manifesto e o PDF
derivado ficam fora dos hashes para evitar referencias circulares. A licenca
inicial do destino e preservada e identificada separadamente no manifesto.

## O que nao foi levado

- `.env`, `.env.remote`, chaves SSH/privadas, tokens, configuracoes de conta.
- Dumps/volumes, backups SQL, fotos de clientes/instalacoes do storage operacional.
- Logs de backend, inventarios da Hostinger, estado de processos e caches.
- `node_modules`, ambientes Python, builds Next/Expo e temporarios.
- PDFs e capturas anteriores que podem mostrar dados de operacao real.
- Helpers administrativos personalizados: audit-hostinger.ps1/.sh,
  configure-remote-access.cjs, provision-hostinger-readonly.py,
  apply-approved-sql.py, prepare-approved-deploy.py e seus dois testes Python.
- Documentos locais de inventario/contas: SITE_DEVELOPER_GUIDE.md,
  DEPLOY_HOSTINGER.md, implementation-v2/WORK_STATE.md,
  CR-2026-10-11-001-local-account-access.md e CR-2026-10-10-003.md.
  O guia remoto individual foi substituido por versao publica generica.

Os originais continuam na copia local privada. A exclusao nao remove a
protecao runtime de leitura: seu codigo e testes estao no repositorio publico.

## Verificacoes locais

| Verificacao | Resultado |
|---|---|
| npm ci nos tres projetos Node | Lockfiles instalados sem alteracao |
| Next build + TypeScript | Aprovados |
| Frontend | 138 testes aprovados |
| API generate/build/test | 79 aprovados, 8 testes MySQL opt-in desativados |
| App lint + TypeScript | Aprovados |
| App | 31 testes aprovados |
| App export:web | Bundle exportado; 22 rotas estaticas |
| GIE HTTP | 11 testes aprovados; Python 3.12 do ambiente existente |
| Gates de publicacao/estrutura | 5 testes aprovados |
| PowerShell | 11 scripts sem erros de sintaxe; teste de UTC aprovado |
| Scanner de publicacao | Sem sinais bloqueantes nas regras implementadas |

Total: 264 testes aprovados. Nao foi feito teste de escrita no MySQL oficial.
A auditoria por padroes nao garante ausencia de toda vulnerabilidade; requer
revisao humana, particularmente antes de uso comercial.

## Limitacoes e publicacao

- CI remoto precisa ser conferido no GitHub apos o push; resultado local nao
  equivale a homologacao em Linux ou aparelho fisico.
- Alguns pacotes existentes avisam de depreciacao; nao foram atualizados nesta
  organizacao para nao introduzir uma migracao funcional nao solicitada.
- A licenca do GIE continua pendente conforme o aviso do autor. Marcas e
  ativos de terceiros nao recebem uma licenca nova por estarem no repositorio.
- GIE operacional/hardware, demo completa, mapas e pagamentos em iPhone/Android
  exigem validacao adicional; a publicacao nao resolve esses itens automaticamente.
- O acesso individual ao banco oficial nao e transferido ao colega por clone.
- O projeto original continua rodando nas portas 3010/3011 em somente leitura.

Destino solicitado: https://github.com/matheus00M7/ecossistema-emps-fiap-test.
Esta operacao publica uma consolidacao em main, sem force push ou deploy.
O commit exato deve ser consultado no historico do destino apos o envio.

## Reversao

A organizacao ocorreu em clone separado. Para desfaze-la localmente, use a
copia original preservada; nao restaure dumps ou reverta o banco. Depois da
publicacao, qualquer reversao compartilhada deve ser um novo commit revisado,
nao uma reescrita forcada do historico.
