# RFID V1 e GoodWe — limite da entrega

01/10/2026. RFID V1 da Platform V2 está implementado e validado em Demo, por estação. Não existe alegação de comunicação física com leitor/cartão/carregador GoodWe.

## O que já funciona

Cadastro de credencial com nome, vínculo opcional ao usuário, unidade, veículo, organização e validade. UID é normalizado e protegido por HMAC com domínio da estação; use RFID_HASH_SECRET estável (fallback atual JWT_SECRET). Trocar esse segredo sem plano invalida lookup de credenciais existentes. Não expor hash/UID em relatório.

Autorização exige credencial habilitada e não expirada da estação. MANAGE cadastra/revoga; OPERATE autoriza e opera Demo. Revogação conserva histórico e bloqueia novo START. Demo exige estação aprovada/ativa, carregador auditado, horários, reserva e escopo de preview; gateway físico/produção não é acionado.

Sessão usa o fluxo administrativo compartilhado, guarda credencial/unidade/morador e proveniência SIMULATED. Não cria pagamento individual. Rateio mensal agrega kWh e valor de referência por unidade/identidade, no fuso da estação; não emite cobrança bancária, boleto ou nota fiscal. Reserva gratuita de condomínio mantém exclusividade sem eliminar o rateio de energia.

Evidência: autorização/expiração/revogação/isolamento e sessão sem Payment no MySQL com rollback; UI real da estação 24 criou a sessão Demo 109, 0,049 kWh, R$0,10 referência, unidade DEMO-101. Após revogação novo START foi bloqueado, histórico preservado.

## Integração física ainda necessária

Obter protocolo/documentação oficial do modelo efetivo, firmware, OCPP/API/Modbus disponíveis, identificador do leitor/conector e requisitos de autenticação. Não presumir que GoodWe oferece o mesmo protocolo em todos os produtos.

Criar adaptador autenticado e vinculado à estação que converta eventos do leitor em autorização do Backend. Não confiar em station_id ou UID de cliente não autenticado. Definir nonce/idempotência, timestamps, replay, expiração e política offline; acesso offline não deve ignorar revogação/reserva sem política aprovada.

START autorizado precisa de ack real, sessão/conector associados e tratamento de timeout/falha. Energia deve vir de medidor físico com origem MEASURED verificada; nada de estimativa Demo registrada como medição. STOP/desconexão/fault/reconciliação devem preservar histórico e saldo do rateio. O GIE recebe demanda/estado, não decide vínculo de morador nem cobrança.

Antes de disponibilizar: bancada com cartão correto/errado/expirado/revogado, outra estação, outra reserva, simultaneidade, perda de rede, reinício, ack duplicado, medição real e relatório reconciliado. Segredos de dispositivo e fontes devem ter rotação planejada. Android/iOS e leitura física não foram validados nesta entrega.
