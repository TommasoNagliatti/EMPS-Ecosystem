# Repetição das cenas GIE — validação local

## Uso

Em Inteligência → Apresentação · cenas, selecionar **Loop: ligado** e **Iniciar apresentação** (ou **Retomar**). A cena 16 volta à cena 1, preservando o intervalo configurado. Pausar continua disponível; mudar o modo de operação encerra a reprodução. O loop não inicia automaticamente apenas por ser habilitado.

O botão reutiliza os controles e estilos existentes, sem alteração de CSS. Disponível nos perfis comerciais que suportam apresentação, inclusive Prédio Comercial e Shopping; não acrescenta cenas aos perfis Posto/Residência.

## Implementação

- Reutiliza `GIEControl.set_loop()` e o avanço nativo, já existentes. Nenhum algoritmo, modelo, cenário, cálculo ou firmware foi alterado por esta funcionalidade.
- Dashboard encaminha `{ "enabled": true/false }` ao endpoint autenticado `POST /stations/:stationId/gie/presentation/loop`.
- Backend preserva autorização por estação e permissões de apresentação, encaminhando a opção ao serviço V3 ou legado conforme o vínculo existente. Valores ausentes/não booleanos são rejeitados.
- Nenhum novo timer de apresentação, WebSocket ou sistema de sessões foi criado. Os controles e bloqueios elétricos anteriores continuam aplicáveis.

## Testes executados

- Backend: 8 testes aprovados (controle de loop, encaminhamento V3/legado, permissões, validação de entrada e regressão do ciclo comercial); build Nest aprovado.
- Frontend: 11 testes aprovados (estado do botão, indisponibilidade fora de apresentação/offline, perfis, polling e regressões); build completo Next.js otimizado aprovado.
- Python: 56 testes aprovados (16 cenas, repetição por 34 avanços, pausa ao mudar para Normal/Simulação/Manual, contrato HTTP estrito e autenticação). O cliente HTTP de testes travou no sandbox; a mesma suíte concluiu em aproximadamente 4 s com execução autorizada. Processos de teste restritos foram encerrados separadamente dos serviços.
- API integrada local do Prédio Comercial (13): cena 16 → 1 automaticamente após 10 s, ainda em reprodução e com loop ligado; mudança para Normal interrompeu o autoplay. Ao final, restaurados apresentação pausada, cena 16 e loop desligado.
- Site local atualizado e HTTP 200 em `http://192.168.15.5:3010/login`.
- ESP32 real manteve comunicação: três leituras subsequentes confirmaram snapshots válidos, ACK aceito e ambos os relés desligados. A troca temporária para Normal produziu indisponibilidade transitória esperada até uma nova decisão; a comunicação estabilizou após restaurar apresentação. Não foi realizado teste de carga ou gravação de firmware nesta etapa.

## Ambiente preservado

Atualizados somente serviços locais identificados. A ponte ESP32 e o serviço GIE V3 permaneceram ativos; backend, Site e GIE legado foram reiniciados de forma controlada. Mantidas a polaridade HIGH e a aprovação USB existente, sem renovar seu prazo. Nenhuma alteração em bancos, Hostinger, App/SubApp, merge ou deploy.

Evidência detalhada da API permanece fora do Git em `C:\goodwill_ai\EMPS_BACKUPS\presentation-loop-validation-20261024.json`, sem credenciais.
