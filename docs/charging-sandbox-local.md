# Recarga SANDBOX do Posto 24h — cópia local 3308

Esta etapa deriva da PR #8. O escopo é a estação local 46 e os carregadores
existentes 76 (`EVSE_01`) e 77 (`EVSE_02`). A estação permanece `DRAFT`,
`PRIVATE` e demonstrativa; os carregadores continuam `PENDING` e sem conexão
física. A disponibilidade indicada como **SANDBOX** é somente a do simulador
de sessão. O Backend mantém comandos físicos e efeitos externos de pagamento
desabilitados.

Nos cartões, **Iniciando** e **Finalizando** indicam somente a requisição
local em andamento. **Carregando** e **Finalizado** vêm da sessão sandbox
persistida; nenhum desses rótulos torna o equipamento físico disponível.

## Preparação da cópia

O preparo só aceita o contêiner auditado `emps-legacy-integration-mysql`,
publicado em `127.0.0.1:3308`, com volume e imagem esperados, na branch
`feat/charging-sandbox-esp32-integration`. Antes da primeira alteração, cria e
lê de volta um dump completo da cópia. O patch 0005 cria três tabelas
`lab_charge_*`, separadas dos registros operacionais e dos históricos GIE.
O patch 0006 acrescenta o prazo de encerramento da recarga pré-paga e recibos
de caixa confirmados pelo operador, também fora das tabelas operacionais.
O preparo também adiciona, **somente na cópia**, duas tarifas com nome
`SANDBOX - Posto 24h` a R$ 2,00/kWh e taxa fixa R$ 0,00 e dois vínculos QR
aleatórios. O QR permanece restrito ao fluxo sandbox autenticado; o acesso
público à estação privada continua bloqueado. Rodar o preparo novamente não
duplica tabelas, tarifas nem QR.

```powershell
python scripts/setup-charging-sandbox.py
```

Backup verificado antes do patch, fora do Git:

`C:\goodwill_ai\EMPS_BACKUPS\emps_integration_pre_charging_sandbox_20261018T155628Z_ddf822da.sql.gz`

SHA-256:
`E986E8B38AFD2E9329330F4632C62AEC45AF3B3502A32BC6B841E65019674E0A`

Backup verificado antes do patch 0006, fora do Git:

`C:\goodwill_ai\EMPS_BACKUPS\emps_integration_pre_cashier_prepaid_20261019T021711Z_a21f7c54.sql.gz`

SHA-256:
`6598C21D2D83BE8B535BE42A479DA54832B1AADC582007677EDCAF0CA1E2E946`

Depois do preparo, os IDs locais de tarifa são 53/54 e os de vínculo QR são
69/70. Nenhum token QR ou segredo é registrado neste documento.

## Teste sem ESP32

Inicie o conjunto local com `scripts/start-legacy-integration.ps1` após o
build. Abra `http://127.0.0.1:3010/login`, use sua conta administrativa antiga
e entre no Posto 24h. Os cartões dos dois EVSE devem mostrar estado e controle
de **recarga sandbox**, com o estado físico separado. O painel da maquete é
somente diagnóstico de conexão, heartbeat, versão e falhas. Para o atendimento
no caixa, escolha **Dinheiro** ou **Maquininha externa**, informe o valor já
recebido e confirme o recebimento antes de iniciar EV1 ou EV2. O Site mostra a
energia estimada pelo valor/tarifa, o prazo de encerramento, o valor consumido
e o saldo não utilizado. O Backend encerra a sessão no limite mesmo sem o
navegador aberto. Se houver parada antecipada, o saldo fica marcado como
**pendente de acerto no caixa**; nenhum estorno real é efetuado. A confirmação
do operador não comprova uma transação na maquininha. O software
não depende do ESP32, de gateway OCPP, de medidor ou de credenciais da
Hostinger. O histórico demonstrativo GIE mantém seus próprios dados e datas.

O teste automatizado usa uma conta criada apenas na cópia, sem imprimir a
senha:

```powershell
node scripts/test-charging-sandbox-stage1.mjs
node scripts/test-charging-sandbox-contracts.mjs
node scripts/test-charging-sandbox-cashier.mjs
node scripts/test-charging-sandbox-deadline.mjs
```

O segundo teste usa as rotas existentes de Mobile e Web Charge com QR
autenticado, intenção sandbox, início, leitura da sessão, cobrança de teste e
parada. A rota pública de QR deve continuar recusando a estação privada.
O App Expo atual bloqueia na própria interface um carregador fisicamente
offline; a API devolve `sandboxAvailable` separadamente, sem falsificar o
status físico. A equipe do App precisará consumir esse campo para apresentar
a recarga sandbox no aplicativo. Nenhum arquivo do App ou do SubApp é alterado
nesta branch.

O terceiro teste usa a rota exclusiva de caixa do Site. Exige confirmação
explícita do valor recebido, confere dinheiro e maquininha externa, rejeita
Pix nessa rota, cobre idempotência, parada antecipada, saldo pendente e o ESP32
desconectado. Os métodos Pix/cartão/carteira das rotas Mobile e Web Charge
continuam registrados somente como pagamento `sandbox`, sem chamada externa.
O quarto aguarda o prazo de uma recarga de R$ 1 sem consultar a API durante a
espera; requer cerca de dois minutos.

Depois dele, confira novamente 65 sessões, 61 pagamentos e 45 intenções
operacionais na cópia 3308. As novas sessões e cobranças devem estar apenas
nas quatro tabelas `lab_charge_*`, com fonte `SANDBOX_ESTIMATE` e provedor
`sandbox`. O dinheiro e a maquininha são recibos confirmados pelo operador,
sem criar linhas em `payments` ou `payment_intents`. kWh e valores são uma
projeção de teste limitada pelo teto
autorizado, nunca medição de carregador nem receita operacional.

## Ponte e ESP32

Após validar o teste sem ESP32, `scripts/test-maquete-simulator.mjs` testa a
mesma sessão sandbox e a entrega de comandos à ponte, com origem identificada
como **Simulador local**. O simulador não prova comportamento elétrico.

O sketch com `EMPS_USAR_WIFI=0` responde apenas ao Monitor Serial e não recebe
ações do Site. Para testar comunicação real sem montagem, mantenha
`EMPS_HABILITAR_RELES=0`, configure Wi-Fi e o endereço LAN privado da ponte,
grave o sketch e observe as mensagens de comando no Monitor Serial. A ponte
aceita somente o IP específico configurado para a placa e seu token local.
START deve ser **recusado localmente** com relés bloqueados; STOP deve manter
as saídas desligadas. Um ACK do firmware confirma apenas o estado lógico
reportado, não contato ou energia física. Nenhum teste de hardware está
registrado nesta etapa.

Os bancos 3306/3307, Hostinger, MySQL oficial, App Expo e Web Charge/SubApp
permanecem fora do escopo de escrita. Não há merge ou deploy automático.

## Evidências locais em 18/10/2026

- `test-charging-sandbox-stage1.mjs`: EV1 Pix, EV2 cartão e EV1 carteira;
  início, idempotência, encerramento e estimativas positivos. Nenhum ESP32 foi
  necessário.
- `test-charging-sandbox-contracts.mjs`: QR privado recusado sem autenticação;
  QR autenticado, intenção, sessão, parada e cobrança sandbox passaram nas
  rotas Mobile e Web Charge. O carregador físico continuou `offline` na API.
- `test-maquete-simulator.mjs`: EV1/EV2 receberam START e STOP originados das
  sessões sandbox; ACK duplicado foi idempotente e START atrasado foi recusado.
  A origem foi `SIMULATOR`, sem GPIO físico.
- `test-charging-sandbox-cashier.mjs`: R$ 20 em dinheiro no EV1 e R$ 20 por
  maquininha externa no EV2 criaram dois recibos e sessões independentes;
  ambas terminaram antecipadamente com R$ 0,03 de consumo estimado e R$ 19,97
  de saldo pendente. Quatro solicitações sem autorização ou com parâmetros
  inválidos foram recusadas. O ESP32 permaneceu desconectado.
- `test-charging-sandbox-deadline.mjs`: a recarga de R$ 1 encerrou em segundo
  plano após 106 segundos, com 0,5 kWh estimado, R$ 1 consumido e saldo zero,
  sem depender da página aberta. O teste de autorização confirma que um ACK
  tardio ou heartbeat não preserva START de uma sessão já concluída.
- Na cópia 3308, as contagens operacionais seguem
  **65 sessões, 61 pagamentos e 45 intenções**; o histórico demonstrativo
  segue com **13.285 sessões e 104.832 leituras**. EVSE 76/77 seguem
  `PENDING`; nenhuma sessão sandbox ficou ativa no último teste. As intenções
  sem sessão expiram pelo prazo do contrato. Os números de registros sandbox
  acumulados variam com a execução dos testes; confira-os por consulta local.
- Frontend: 231 testes, TypeScript e build Next.js com 18 páginas passaram.
  Backend: 186 testes passaram e oito ficaram marcados como `SKIP`; o teste
  WebSocket encontrou bloqueio de transporte no executor restrito e a suíte
  completa passou com loopback autorizado. O build NestJS passou.
- Sketch ESP32: compilação de Wi-Fi habilitado e relés bloqueados passou com
  ESP32 core 3.3.12 (82% de flash, 15% de RAM global). Com relés bloqueados,
  o LCD indica `RELE BLOQ.` e o LED verde não anuncia disponibilidade física.
  O modo Wi-Fi desligado
  também compila; habilitar relés junto de Wi-Fi desligado falha na compilação
  por proteção. Nenhum teste físico ou de Wi-Fi da placa foi realizado.
- O serviço local foi reiniciado em `127.0.0.1:3010` com API `:3011`, ponte
  `:3012` e três perfis GIE V3 mais o GIE comercial legado. A política de
  automação do navegador bloqueou a observação da página local; a confirmação
  visual humana do novo atendimento em dinheiro/maquininha permanece pendente.
