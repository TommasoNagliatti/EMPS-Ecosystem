# Prévia Hostinger com ESP32 — 24/10/2026

## Endereços e versão

- Site: https://preview.emps-charge.tech/login
- Prédio Comercial: https://preview.emps-charge.tech/stations/13/dashboard
- API: https://preview.emps-charge.tech/api
- Imagens Backend/Frontend/GIE legado: `838f2f8`. GIE V3 continua na imagem anterior, com os mesmos workers e modelos, pois seu código matemático não mudou.
- Domínio oficial `emps-charge.tech`, checkout oficial e MySQL oficial preservados.
- Ambiente local preservado em `http://192.168.15.5:3010`; Expo local na porta 8081. Segundo Expo na porta 8082 aponta à API HTTPS da prévia.

## Comunicação e contingência

`ESP32 → WebSocket LAN na ponte do PC → HTTPS autenticado → Backend da prévia → GIE`

A ponte mantém autenticação por IP/dispositivo/estação e o contrato original. Somente o domínio aprovado `preview.emps-charge.tech/api`, com HTTPS e opt-in explícito, pode ser escolhido como origem remota. Sem redirecionamentos e sem fallback automático entre autoridades. A credencial LAN nunca sai do computador: a conexão HTTPS usa outra credencial gerada na VPS, guardada em arquivos privados. Rotas legadas de RFID/comandos não são encaminhadas à origem remota.

O firmware, a pinagem e os cálculos não foram alterados nesta etapa. Não é necessário regravar a placa. O PC e a ponte precisam continuar ligados e na mesma rede do ESP32. Existe uma única origem de comando selecionada por vez; o Site local continua acessível quando a maquete usa a prévia.

Troca controlada no PowerShell 7:

```powershell
./scripts/switch-maquete-source.ps1 -Source Local
./scripts/switch-maquete-source.ps1 -Source HostingerPreview
```

O script exige configurações privadas existentes em `EMPS_BACKUPS`, valida IP/MAC, vínculo e GIE, recusa recargas ativas e encerra somente a ponte com identidade conferida pelo launcher existente. Aguarda o watchdog antes de conectar à outra origem. No retorno local durante indisponibilidade remota, não transfere sessões. Não altera APIs, GIEs, Expo ou bancos. Atalhos `.cmd` para as duas opções foram preparados na pasta privada local.

## Dados, permissões e aprovações

- Base da prévia isolada e sanitizada: uma conta exclusiva, quatro instalações e oito carregadores; preservados 13.285 sessões demonstrativas, 7.961 pagamentos sintéticos e 104.832 leituras. Sessões/pagamentos operacionais continuam vazios.
- Backup completo da base da prévia, gzip verificado e SHA-256 registrado, criado antes das alterações; aproximadamente 11,4 MB comprimidos. Sem migration ou importação no banco oficial.
- Criado somente o vínculo ausente `maquete-01` → estação operacional 46, mantendo origem energética 13. Códigos EV1/EV2 resolvidos na cópia remota para carregadores 51/49, ambos na estação 13.
- O usuário autorizou especificamente configurar na VPS as mesmas chaves Stripe **de teste** e a aprovação USB existente. Pagamentos operacionais, OCPP e comandos comerciais permanecem bloqueados; nenhuma chave live foi configurada.
- HIGH=ON / LOW=OFF e escopo USB de 5 V preservados. Prazo original da aprovação: **24/10/2026 10:21:58 UTC (07:21:58 em São Paulo)**, sem renovação. Ao vencer, os relés voltam a ficar bloqueados; LEDs/LCD podem continuar indicando os cenários.
- Após autorização específica do usuário, somente o cadastro sanitizado do Prédio Comercial passou de PRIVATE para PUBLIC pela API administrativa, permitindo QR/WebCharge de visitantes. Dashboard permanece autenticado. Posto e Residência continuam PRIVATE, sem liberação operacional física.
- Leitor QR do App passou a reconhecer os domínios HTTPS oficiais e da prévia. Domínios parecidos, HTTP público e URLs com credenciais são rejeitados. Nenhuma alteração visual do App ou do Site.
- Conta exclusiva da prévia: `preview@emps.invalid`. Credenciais e chaves não estão neste documento nem no Git; acesso salvo em arquivo privado local.

## Testes executados

1. Oito testes da ponte aprovados: compatibilidade local, autorização por estação/dispositivo, autenticação distinta HTTPS, origem restrita, snapshots/ACK, heartbeat, falha de origem e ausência de fallback automático. Sintaxe PowerShell validada.
2. Nove testes de QR do App aprovados, incluindo links da prévia, domínios falsos, HTTP e compatibilidade local.
3. Builds Docker de Backend, Frontend e GIE concluídos. Login público HTTPS, cookie Secure/HttpOnly, recusa anônima e quatro dashboards/GIEs responderam corretamente.
4. Histórico/analytics das quatro instalações e comparativo de rede passaram. Dois START SANDBOX de caixa e STOP independentes passaram antes da conexão física; nenhuma cobrança externa ou sessão operacional foi criada.
5. Simulador pela ponte HTTPS: 30 snapshots em aproximadamente 31 s, três cenários, ACK aceito, sem desconexão. Validade estimada mínima 3.982 ms dos 4.000 ms, usando o relógio autenticado do welcome, como o firmware. Relógios do PC/VPS diferem; não foram alterados nem usados para fabricar datas históricas.
6. ESP32 real: oito amostras válidas com ACK aceito na prévia inicialmente SERIAL_ONLY. Após autorização específica e configuração USB, seis amostras válidas em USB_RELAY_TEST, polaridade HIGH coincidente e ambos os relés desligados em Apresentação. Nenhum START físico foi emitido pela automação.
7. Retorno real para a API local confirmou snapshot atual e ACK do ESP32; depois, a ponte voltou à prévia. Site/API/GIEs/Expo locais permaneceram ativos.
8. QR mobile resolveu EV1/carregador 51, visitante permitido, Stripe selecionado e chave publicável de teste correspondente. `physicalGateway=false` mantido. Bundle iOS do segundo Expo compilou e contém a API HTTPS correta; Expo local 8081 permaneceu disponível.

## Limites e retorno

A atuação física de START/STOP a partir da prévia e o checkout Stripe no celular precisam da conferência manual do usuário; foram verificados contrato/ACK, configuração e QR, sem efetuar pagamento nem ligar cargas pela automação. Não foi feita validação visual automatizada do navegador/celular.

Apenas serviços de homologação Backend/Frontend/GIE legado foram recriados. Os contêineres oficiais, MySQL da prévia, workers V3 e proxy oficial foram preservados. Imagens/configurações anteriores e backup permanecem na VPS. Não houve merge nem promoção para o domínio/banco oficiais. A aprovação USB temporária não deve ser ampliada para contornar uma falha de conexão.
