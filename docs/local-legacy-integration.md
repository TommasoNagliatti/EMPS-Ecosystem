# Prévia local com o banco antigo do EMPS

Esta prévia usa somente a **cópia isolada** `emps-legacy-integration-mysql` em
`127.0.0.1:3308`, database `emps_integration_test` e volume persistente
`emps_legacy_integration_20261017`. Os bancos `emps-mysql` (3306) e
`emps-demo-visual-mysql` (3307) permanecem separados.
O contêiner está fixado na mesma imagem MySQL 8.0.46 auditada no banco antigo.

Antes de iniciar, a cópia precisa estar restaurada e receber os patches
0001–0003. O launcher verifica as 36 tabelas, a Shopping ID 39 e a
preservação mínima dos 10 usuários, oito estações e 13 carregadores antigos;
ele não cria usuários, não importa dados e não aplica SQL. Os históricos
demonstrativos e as duas novas instalações são preparados separadamente,
após iniciar o worker GIE. O arquivo privado
`C:\goodwill_ai\EMPS_BACKUPS\emps-legacy-integration.mysql.env` deve corresponder
ao contêiner. Mantenha esse arquivo fora do Git.

Na branch `feat/legacy-mysql-local-integration`, após compilar o Backend e
instalar as dependências do Frontend/GIE, execute no PowerShell 7:

```powershell
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\start-legacy-integration.ps1
```

Na primeira execução desta cópia já restaurada, prepare os vínculos das três
instalações, os históricos demonstrativos e a conta de revisão. O script valida
novamente a identidade do contêiner e pode ser repetido sem duplicar registros:

```powershell
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\setup-legacy-integration.ps1
```

Depois da preparação, reinicie apenas os serviços locais para que o Backend
carregue os vínculos novos. O contêiner e seu volume continuam intactos:

```powershell
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\stop-legacy-integration.ps1 -WhatIf
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\stop-legacy-integration.ps1
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\start-legacy-integration.ps1
```

Endereços: Site `http://127.0.0.1:3010/login`, comparativo
`http://127.0.0.1:3010/stations/overview`, API `http://127.0.0.1:3011`.
Use a senha que você já conhece para uma conta antiga ou a conta de teste
criada exclusivamente na cópia. As credenciais da conta local ficam no arquivo
privado `C:\goodwill_ai\EMPS_BACKUPS\emps-legacy-integration.runtime.json`;
o launcher cria esse arquivo uma vez, mas não cria a conta no MySQL. As senhas
antigas não são recuperáveis a
partir dos hashes do banco.

Depois que a conta de teste tiver sido criada na cópia, é possível consultar
somente os campos necessários para o login:

```powershell
$local = Get-Content -Raw C:\goodwill_ai\EMPS_BACKUPS\emps-legacy-integration.runtime.json | ConvertFrom-Json
[pscustomobject]@{ Email=$local.adminEmail; Senha=$local.adminPassword }
```

Para conferir o encerramento antes de executá-lo:

```powershell
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\stop-legacy-integration.ps1 -WhatIf
pwsh -File C:\goodwill_ai\EMPS_GITHUB\scripts\stop-legacy-integration.ps1
```

O encerramento verifica PID, horário de início, porta e linha de comando de
cada serviço registrado. Ele não para Docker e preserva os três bancos e os
dados do GIE. Depois de atualizar o código da branch, encerre os processos da
prévia antes de reiniciá-la. Logs e tokens locais ficam em
`C:\goodwill_ai\EMPS_BACKUPS`, fora do repositório.

O ambiente usa pagamento sandbox, OCPP sem gateway, comandos físicos e
efeitos externos de pagamento desabilitados. O Frontend inicia com
`NEXT_PUBLIC_EMPS_DEMO_MODE=false` e diretório de build separado, sem alterar
o Site demonstrativo da porta 3000.

Para reproduzir o build de produção do Frontend no Windows, use o Webpack
suportado pelo Next.js. Execute-o com os serviços locais ativos e sem usar o
diretório de build da prévia em execução:

```powershell
cd C:\goodwill_ai\EMPS_GITHUB\site\emps-site-main\frontend
$env:EMPS_LOCAL_PREVIEW = 'false'
$env:NEXT_PUBLIC_API_URL = 'http://127.0.0.1:3011'
$env:NEXT_PUBLIC_EMPS_DEMO_MODE = 'false'
npm run build -- --webpack
```
