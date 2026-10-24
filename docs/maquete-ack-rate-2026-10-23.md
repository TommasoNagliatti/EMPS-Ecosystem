# Queda de indicadores por limite de reports — 23/10/2026

Na cópia local 3308, foi observado HTTP 429 e Retry-After de 51 segundos em `POST /devices/maquete-01/energy/report`. Uma única requisição diagnóstica autenticada com canal inexistente confirmou o bloqueio sem registrar heartbeat válido ou emitir comandos.

O bridge produz até 60 notificações `sent`, 60 ACKs e 30 heartbeats por minuto no mesmo handler. O limite geral de 120/min era inferior ao tráfego normal de aproximadamente 150/min. A recusa do ACK faz a ponte encerrar o canal; o watchdog da placa apaga indicadores e mantém a parada segura. Isso não é um temporizador de dez minutos da apresentação.

Correção: limite específico de 300 reports/min, mantendo autenticação do dispositivo, identidade da estação, quotas dos outros endpoints, limite de mensagens da ponte, TTL de quatro segundos, aprovação USB temporária e bloqueios elétricos. O excesso continua retornando 429. Não se desativou a proteção de frequência.

Adicionado diagnóstico com códigos fixos de desconexão/HTTP na ponte, sem payloads ou tokens. Apenas backend e ponte locais foram reiniciados; Site, workers GIE e bancos foram preservados. Nenhuma alteração no firmware nesta correção, sem necessidade de regravar.

Teste HTTP real em Nest/Throttler e porta temporária: ausência de token retorna 401, 180 reports normais passam, e o 301º acesso retorna 429. Mais 15 testes de energia/USB e 4 testes de WebSocket passaram; build NestJS aprovado. Não há acesso à placa ou banco no teste de carga.

A observação da placa real foi feita pelo JSON autenticado da estação 13; o relatório privado `C:\goodwill_ai\EMPS_BACKUPS\esp32-continuity-20261023.json` registra canal, sequência, ACK e idade dos frames, sem credenciais. Confirmação de GPIO continua sem equivaler a medição física.

Resultado observado: 132 segundos, 66 leituras atuais com ACK, mesmo canal, nenhum erro HTTP, sequência 143→270 e idade máxima dos frames 1.055 ms. É observação da comunicação real por pouco mais de dois minutos, não ensaio físico de dez minutos das luzes/relés.

Observação separada: após mudança para NORMAL no worker, uma decisão pode estar ausente até novo ciclo. Na observação CHARGER_DEMO havia energia ilustrativa e ACK `accepted=false` relativo à decisão GIE ausente. Isso não significa perda do transporte: a ilustração possui validade própria para LEDs/LCD. Os relés continuam bloqueados quando a decisão GIE é inválida. Um `/cycle` vazio comercial pode ser recusado como replay pelo worker; não foi alterado o modelo, o relógio dos datasets ou o balanço para mascarar isso.
