# EMPS Platform V2 — estado implementado

Atualizado em 01/10/2026. Fonte: monorepo `C:\goodwill_ai\EMPS_GITHUB`. Implementação local, sem commit/push. Evidências incrementais e limites estão em [WORK_STATE](implementation-v2/WORK_STATE.md).

## Responsabilidades

O Backend NestJS/MySQL é autoridade para identidade, associação por estação, elegibilidade, reservas, comandos, sessões, pagamentos e origem dos dados. Site Next.js, App Expo e Web Charge usam os mesmos serviços e registros. O GIE Python continua uma instância de controle para uma estação configurada; contratos multiestação preparados não significam execução multiestação.

| Camada | Responsabilidade |
| --- | --- |
| Site | Cadastro/login, estações, wizard, revisão, equipe, RFID, histórico/readiness e Web Charge |
| App | Cadastro/login, estações elegíveis, fotos, horários, recarga, recibos e agendamento |
| Backend | Autorização atual no banco, transações/locks, cobrança existente, exclusividade e auditoria |
| MySQL | Identidade e histórico persistentes, fontes e proveniência, reservas, ativos individuais |
| GIE existente | NORMAL, Manual Demo, Presentation e controle/modelos existentes preservados |

## Identidade e estações

Uma conta pode usar Site e App sem promoção automática a administrador global. Cadastro exige confirmação de senha e termos; sessão consulta conta ativa. Papéis por estação: OWNER, MANAGER, OPERATOR, COLLECTOR e VIEWER. READ aceita todos; OPERATE exclui VIEWER; MANAGE aceita OWNER/MANAGER; OWNER é exclusivo. Revisão da plataforma e ferramentas de apresentação exigem capabilities específicas persistidas.

Estações novas seguem draft, envio para revisão e decisão. Alteração técnica de estação aprovada preserva configuração ativa até nova aprovação. Equipe possui convites/revogação; notificações usam outbox local, sem alegar envio de e-mail. Acesso operacional e elegibilidade do motorista são distintos. Estação privada aparece apenas para proprietário, equipe ou credencial RFID ativa vinculada ao usuário. Estações legadas ativas com reviewState nulo têm compatibilidade explícita.

Ativos têm identidade própria. Baterias/solar podem ficar INACTIVE sem apagar histórico; solar é opcional. Armazenamento agregado soma capacidades e pondera SOC pela capacidade, somente entre ativos ativos; SOC desconhecido permanece nulo. Fotos privadas passam por autorização, e disponibilidade usa timezone IANA e janelas semanais estruturadas.

## Recarga e dinheiro

Web Charge reutiliza MobileService, SessionBillingService, PaymentIntent, ChargingSession e ChargingCommand. Conta usa clientId; visitante usa guestId explícito e clientId nulo. Token de visitante é opaco, salvo como hash, expira em 24 horas e fica vinculado ao carregador. Não há conta genérica compartilhada.

Pré-pago tem limite e monitor no servidor, inclusive quando a aba fecha. Disposição financeira distingue autorizado, consumido, capturado, liberado, a devolver e devolvido. Stripe atual foi preservado; captura parcial foi validada com Stripe Sandbox real. Pix e Wallet são Sandbox/Demo: nenhuma liquidação bancária é afirmada. Cancelamento de autorização não utilizada e chaves idempotentes evitam duplicação. Comprovante é demonstrativo, não nota fiscal.

RFID V1 usa HMAC do UID com domínio da estação, expiração, revogação e vínculo opcional a morador/unidade. Demo exige carregador auditado como Demo e não opera gateway físico. Sessão RFID entra no rateio mensal sem Payment individual; valor é referência, não cobrança liquidada.

Reservas usam lock da estação e ReadCommitted para impedir sobreposição. Preço/política são cotados pelo servidor, congelados e aceitos via termsHash. Taxa zero é válida; taxa paga nesta versão usa Demo. Estados: PENDING_PAYMENT, CONFIRMED, CANCELLED, EXPIRED, USED e NO_SHOW. Timer expira hold e ausência; START compartilhado por App/Web Charge/Admin/RFID aplica exclusividade. sessionId/USED impedem consumo duplo. Cancelamento pago registra análise manual de devolução, sem fingir reembolso. Recibo discrimina Reserva, Energia, Permanência e Total.

## Dados e GIE

Fontes mantêm MEASURED, CALCULATED, EXTERNAL, FORECAST, SIMULATED e IMPORTED separados. MEASURED exige fonte física verificada por revisor e evidência auditada. Cadastro de fonte ou configuração de SOC não constitui medição. Legado sem classificação continua sem classificação.

CSV/XLSX importa exclusivamente IMPORTED, com prévia, confirmação, hash/idempotência, limite de tamanho/linhas e validação temporal. Dataset exige estação e escolha explícita de origem física verificada ou importada; não promove previsão/simulação. Snapshots completos reutilizam GieIntervalSnapshot sem sobrescrever intervalo existente. Readiness é leitura de dados armazenados, sem treinamento, progresso artificial ou ativação.

Detalhes de features, contratos, retenção e trabalho futuro estão em [GIE_V2_HANDOFF](GIE_V2_HANDOFF.md). Contratos HTTP estão em [API_V2](API_V2.md).

## Banco, ambientes e evidências

Somente duas migrations foram aplicadas nesta implementação: `20260929_platform_v2` e `20260929_platform_v2_solar_status`, ambas com dump prévio; a segunda foi autorizada explicitamente. Não reaplicar. SQL oficial e Prisma foram alinhados sem recriar banco. Backups e hashes constam no WORK_STATE.

O launcher V2 consolidado usa Site 3000, Backend 3001, GIE 8510 e Expo 8081, preserva o MySQL existente e detecta a LAN sem versionar IP pessoal. Previews 3100/3101/8083 foram usados durante a implementação e depois encerrados. Ambientes de teste compartilharam o MySQL existente; nunca foram tratados como banco descartável.

Testes reais de MySQL/API/UI estão registrados por fase. Testes unitários existentes usam doubles para contratos locais; não são apresentados como prova de banco, hardware ou pagamentos externos. Android/iOS físicos, RFID/GoodWe físico, Pix/Wallet bancários e GIE multiestação continuam pendentes. Stripe Sandbox foi concluído posteriormente pela UI com captura e comprovante; os valores e limites estão documentados no WORK_STATE.
