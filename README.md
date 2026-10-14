# EMPS | Ecossistema FIAP

Site de operacao, aplicativo de recarga, API e gerenciamento inteligente de
energia em um unico repositorio. Esta copia inclui o trabalho consolidado ate
13/10/2026. O projeto ainda e um prototipo: publicacao de codigo nao equivale a
deploy, homologacao de equipamentos ou integracao oficial com a GoodWe.

## Estrutura

```text
app/emps-charge/                    Aplicativo React Native / Expo
site/emps-site-main/
  frontend/                        Site Next.js / React
  backend/                         API NestJS / Prisma
  database/                        Estrutura MySQL 8 e politica de patches
gie/GIE/
  service/                         Servico HTTP e replay isolado
  src/                             Previsao, MPC e distribuicao de energia
  models/                          Modelos congelados usados pelo prototipo
  data/                            Dados de referencia da simulacao
  outputs/                         Evidencias versionadas do prototipo
  tests/                           Testes do GIE
scripts/                           Instalacao, inicio, parada e auditoria
docs/                              Guias, arquitetura e historico de alteracoes
.github/workflows/                  Verificacoes automaticas, sem deploy
```

Os caminhos dos componentes foram preservados para manter os contratos entre
site, API, app e GIE. As dependencias continuam separadas: nao ha hoisting que
misture as versoes de React do aplicativo com as do site.

## Comecar em outro computador

Requisitos: Git, Node.js 22+, npm, Python 3.12, PowerShell e Docker Desktop
para o banco local. Consulte [Execucao local](STARTUP.md) antes de iniciar.

```powershell
git clone https://github.com/TommasoNagliatti/EMPS-Ecosystem.git
cd EMPS-Ecosystem
.\scripts\setup-local.ps1
```

Configure os arquivos `.env` criados pelo setup, gerando segredos proprios.
Nenhuma senha de usuario, chave privada ou credencial de producao e distribuida.
Para o primeiro acesso, crie um administrador **no seu banco local**, seguindo
o guia. Depois:

```powershell
.\scripts\start-local.ps1
```

| Componente local | Endereco |
|---|---|
| Site | http://localhost:3000/stations |
| Saude da API | http://localhost:3001/auth/health |
| GIE | http://127.0.0.1:8510 (autenticado) |
| Expo / Metro | Porta 8081; QR no terminal |

O banco desse modo e **local**, nao o banco oficial da VPS. O acesso ao banco
oficial exige autorizacao individual e configuracao privada independente.
Leia [Modo remoto somente leitura](docs/REMOTE_DEVELOPMENT_HOSTINGER.md).

## Comandos na raiz

```powershell
npm run check:publication  # Estrutura e sinais de arquivos privados
npm run check:web          # Build e todos os testes do site
npm run check:api          # Prisma generate, build e testes sem MySQL opt-in
npm run check:app          # Lint, tipos e testes do aplicativo
npm run check:gie          # Testes HTTP do GIE na .venv local
```

Os pacotes sao instalados dentro de cada componente, usando seus lockfiles.
Nao e necessario executar `npm install` na raiz.

## Documentacao

- [Indice dos guias](docs/README.md)
- [Arquitetura](ARCHITECTURE.md)
- [API V2](docs/API_V2.md)
- [Contribuicao e revisao do grupo](CONTRIBUTING.md)
- [Seguranca](SECURITY.md)
- [Registro desta publicacao](docs/change-requests/CR-2026-10-12-002-github-publication.md)
- [Codigo e relatorio complementar de 13/10, para revisao](docs/change-requests/CR-2026-10-13-005-github-publication.md)
- [Relatorio complementar publico em PDF](docs/change-requests/pdf/EMPS_RELATORIO_COMPLEMENTAR_PUBLICO_2026-10-13.pdf)
- [Integracao compativel com o repositorio do Tommaso](docs/change-requests/CR-2026-10-13-006-compatibility-integration.md)
- [Checklist de homologacao e release](docs/COMPATIBILITY_RELEASE.md)

## Estado das atualizacoes de 13/10

- Navegacao, dashboard e paineis possuem melhorias documentadas nas CRs.
- O replay GIE isolado e os exemplos do painel foram desativados no perfil
  usado neste PC; seu codigo/testes continuam preservados para auditoria.
- O hotfix de encerramento pre-pago foi publicado separadamente na API oficial.
- Limite pre-pago, saldo a devolver e 10 minutos para retirar o conector foram
  implementados/testados no codigo, mas ainda nao ativados na hospedagem.
  Novas sessoes usam o comportamento original, salvo ativacao explicita por
  instalacao em `PREPAID_LIFECYCLE_STATION_IDS`. Registros V2 existentes continuam
  reconhecidos mesmo se a ativacao for removida.
- Permanencia excedente conta tempo separado; tarifa monetaria nao definida.
- A ponte de Caixa e um perfil local opt-in limitado, nao acesso geral de escrita.

Esta branch destina-se a revisao do grupo. Codigo enviado ao GitHub nao
significa backend/site oficial atualizado ou equipamento real homologado.

## Limites e seguranca

- Dados ficticios e replay nao comprovam conexao com equipamentos reais.
- O replay GIE isolado permanece separado da telemetria oficial e desativado
  no perfil atual. Nao usar suas cenas como medicao real.
- Stripe, quando configurado, e somente Sandbox; a configuracao local padrao
  utiliza o provider `sandbox`.
- O schema SQL nao contem registros de usuarios, pagamentos ou sessoes reais.
- Nao executar migrations, seeds ou testes com escrita no banco oficial.
- Logos e referencias a GoodWe/SEMS+ nao indicam parceria ou integracao aprovada.
- A [licenca do GIE](gie/GIE/LICENSE_NOTICE.md) ainda exige definicao pelo autor.
  As licencas dos componentes e de terceiros foram preservadas; esta publicacao
  nao concede direitos novos sobre marcas, imagens ou componentes de terceiros.
