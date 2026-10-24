# Execucao local

Este guia cria um ambiente de desenvolvimento no computador de quem clonou o
repositorio. Nao conecta ao banco oficial e nao publica nada na Hostinger.

## 1. Requisitos

- Git e Node.js 22+ com npm.
- Python 3.12 acessivel como `py -3.12` no Windows.
- PowerShell e Docker Desktop aberto.
- Portas livres: MySQL 3306, API 3001, site 3000, GIE 8510 e Expo 8081.

## 2. Instalar

Na raiz do repositorio:

```powershell
.\scripts\setup-local.ps1
```

O setup usa `npm ci` e os lockfiles dos tres componentes, gera o cliente Prisma,
compila a API, cria a .venv Python e instala os requisitos de testes/servico.
Nao executa seed ou migration. Preserva `.env` existentes.

## 3. Configurar

Revise `site/emps-site-main/backend/.env`,
`site/emps-site-main/frontend/.env` e `app/emps-charge/.env`.
O Compose local usa as credenciais demonstrativas dos exemplos, nunca as da VPS.
Gere dois valores aleatorios diferentes para `JWT_SECRET` e `GIE_SERVICE_TOKEN`.

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Mantenha `PAYMENT_PROVIDER=sandbox`. Chaves Stripe nao sao necessarias para esse
modo. Para testar Stripe use apenas chaves Sandbox proprias e leia o guia
especifico. Configure a API do app para seu computador; o iniciador usa o IP
da LAN no processo Expo.

## 4. Banco e primeiro usuario

```powershell
docker compose -f site/emps-site-main/docker-compose.yml up -d mysql
```

Um volume novo recebe o SQL estrutural automaticamente. Um volume ja existente
nao e apagado ou reinicializado. O projeto nao leva os usuarios do banco oficial.
Para criar seu administrador local, em outro terminal:

```powershell
cd site/emps-site-main/backend
$env:ADMIN_EMAIL='admin@example.invalid'
$env:ADMIN_NAME='Administrador local'
$env:ADMIN_PASSWORD='defina-uma-senha-local-forte'
npm run bootstrap:admin
```

Esse comando grava **no banco configurado no seu `.env`**. Confira primeiro que
o destino e o MySQL local. Nao o execute com acesso a producao. Nao e preciso
habilitar seed, migrations ou testes MySQL para iniciar o site.

## 5. Iniciar e parar

Volte a raiz e execute:

```powershell
.\scripts\start-local.ps1
# Sem aplicativo:
.\scripts\start-local.ps1 -NoApp
```

Abra http://localhost:3000/stations. A API responde em
http://localhost:3001/auth/health. GIE local: http://127.0.0.1:8510,
com autenticacao. Expo usa porta 8081; o QR deve ser lido no terminal.
O uso de recursos nativos pode exigir um development build compativel; a
validacao em iPhone/Android continua necessaria.

O GIE foi desenvolvido para uma instalacao por processo. `GIE_STATION_ID=1`
e apenas um exemplo: selecione uma instalacao existente e configure seus
vinculos/telemetria antes de esperar dados operacionais. A ausencia desses
vinculos nao deve ser ocultada com dados ficticios.

Mantenha o terminal aberto. Ctrl+C encerra somente os processos dessa execucao,
preservando MySQL e volume. `.\scripts\stop-local.ps1` e a alternativa segura.
Os wrappers `START_EMPS_V2.ps1` e `STOP_EMPS_V2.ps1` apontam para esses mesmos
iniciadores e nao dependem de uma pasta especifica de outro desenvolvedor.

## 6. Testar

```powershell
npm run test:structure
npm run check:publication
npm run check:web
npm run check:api
npm run check:app
npm run check:gie
```

`check:api` desativa os testes MySQL com escrita e usa um destino ficticio
nao conectavel. Os testes com banco exigem aprovacao e um banco descartavel
separado; nunca habilite `EMPS_V2_MYSQL_TEST` para o banco oficial.

## Modo remoto

O site local de leitura da VPS usa portas 3010/3011 e um tunel privado. Ele
nao e iniciado pelo setup local nem inclui acesso transferivel para colegas.
Consulte [o guia remoto](docs/REMOTE_DEVELOPMENT_HOSTINGER.md) para separar os
dois modos e solicitar o acesso correto.
