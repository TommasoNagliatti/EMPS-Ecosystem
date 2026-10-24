# Cartão de teste e pendências — implementação em andamento

## Atualização: WebCharge e troca de rede

- Configuração do cartão passou a informar `cardPaymentProvider` e a chave publicável de teste, sem mudar o provedor sandbox dos outros métodos.
- Campos Stripe separados (número, validade, CVC), estados de carregamento/erro e bloqueio de envio duplo; CSS restrito ao WebCharge com campos e botões adaptados a telas estreitas.
- Navegador validou formulário, autorização com cartão oficial 4242 e início/parada simulados. A captura de R$ 0,63 aconteceu, mas o CHECK antigo de `lab_charge_payments` recusou o provedor `stripe_test`.
- Backup verificado antes do patch 0010: `emps_integration_pre_charging_sandbox_20261021T183235Z_b21aca17.sql.gz`, SHA256 `BA3F17FB52DB2ACA427BD7F75C4A5DC761878DD10FFDA714EE91BADE2B0245B3`.
- Patch 0010 aplicado somente na cópia 3308. Recibo de R$ 0,63 recuperado consultando a captura confirmada, sem nova autorização/captura.
- `scripts/test-lab-stripe-cycle.mjs`: PASS no fluxo WebCharge autenticado completo, cartão `pm_card_visa`, captura de teste R$ 0,50, recibo persistido, repetição sem duplicar pagamento. Sessão `ea2144be-a759-463e-b9bc-003f7bf5cf76`.
- Registros operacionais preservados: 65 sessões / 61 pagamentos / 45 intenções.
- IP atual: `10.249.171.253`. Site/API responderam nesse endereço; conjunto GIE reiniciado com decisões simuladas disponíveis.
- Automação do navegador bloqueada ao retomar a aba antiga após troca de rede; verificação visual final no IP novo não concluída. A disponibilidade HTTP e o ciclo completo por API foram verificados.
- Esta correção não conclui o recurso de dívidas por ociosidade descrito abaixo.

## Regras confirmadas

- Stripe somente para cartão; Pix/carteira continuam no sandbox local.
- Carência de 10 minutos após parada confirmada; R$ 2,50/minuto, sem teto.
- Frações calculadas proporcionalmente por segundo, arredondadas em centavos.
- Próxima autorização deve mostrar orçamento de energia + dívida = total. A dívida não reduz o orçamento de energia.
- Somente cópia `emps_integration_test`, loopback 3308. Não habilitar pagamentos operacionais, comandos físicos ou acesso aos bancos 3306/3307.

## Validado nesta etapa

- Patch 0009 aplicado exclusivamente na cópia após verificação de identidade do contêiner e SHA256 do backup já preparado.
- Contagens operacionais preservadas: 65 sessões, 61 pagamentos, 45 intenções.
- Backend compilado; oito testes focados aprovados (sandbox, cálculo de ociosidade, orçamento e gateway).
- API autenticada criou autorização Stripe de teste para cartão; repetição idempotente preservou a autorização; consulta retornou `requires_action`; cancelamento confirmado.
- Nenhum cartão confirmado, nenhuma captura externa executada pelo teste de API.
- Gateway rejeita chave live, origem incompatível, autorização divergente, saldo insuficiente e replay com valor diferente. Captura exige confirmação e valor exato retornados pelo Stripe.
- Histórico não infere pagamento aprovado simplesmente porque a sessão terminou. Recibo identifica o provedor persistido.
- Launcher aceita `-EnableStripeTest` e mantém o gateway operacional desativado. Chave dedicada é lida do arquivo privado local, nunca registrada nos logs.
- Expo reiniciado com chave publicável de teste, conta `tommaso_nagliatti`, API local e modo demonstrativo do Frontend desativado.

## Pendências — não considerar a entrega concluída

- `idle-debt-policy.ts` é apenas cálculo testado: ainda NÃO cria débitos, NÃO cobra ociosidade nem modifica tarifas antigas.
- Implementar eventos confirmados de retirada para novas sessões sandbox. Não inferir permanência física de falta de telemetria; manter origem simulada explícita.
- Persistir débito e alocações idempotentes por usuário/sessão, com transações que impeçam cobrança duplicada e separação absoluta do financeiro operacional.
- Integrar cotação com versão e confirmação explícita do total; exigir nova confirmação quando o saldo mudar.
- Ícone com saldo real, listagem e quitação independente ainda não implementados.
- Somar débitos à próxima autorização e liquidá-los apenas após confirmação do provedor ainda não implementado.
- Validar PaymentSheet no Expo Go, cancelamento, recusa, autenticação adicional e captura de teste ponta a ponta. Teste de API não equivale a validação visual.
- Valor de captura abaixo do mínimo de R$ 0,50 permanece pendente sem cobrança artificial; recuperação/baixa ainda requer fluxo específico.
- Não publicar como funcionalidade financeira concluída. Sem deploy, merge ou alterações em produção.

## Retomada local

Usar `scripts/start-legacy-integration.ps1 -PreviewBindIp 10.249.171.253 -EnableStripeTest`.
Se o Backend já estiver ativo com modo diferente, o launcher exige parada identificada pelo script; não encerra processos desconhecidos.
Site: `http://10.249.171.253:3010/login`; Expo: `exp://10.249.171.253:8081`.

Teste sem cobrança: `node scripts/test-lab-stripe-authorization.mjs`.

## Residência — caixa local do Site

- Carregador auditado 78, estação 47, 7 kW, identidade SIMULATED_DEMO_CASA_001_EVSE_01. Mantidos PRIVATE/DRAFT/PENDING, sem comandos físicos.
- Incluído nos escopos do caixa SANDBOX, cartões do Site, histórico recente, encerramento automático e fluxo energético.
- Tarifa local idempotente `SANDBOX - Residencia - visitante`: R$ 2,00/kWh, sem taxa fixa, para cenário de visitante pago. Não modifica o cenário histórico de uso próprio gratuito.
- Backup: emps_integration_pre_charging_sandbox_20261021T233248Z_a78accd4.sql.gz, SHA256 AC5B3DB6D995DE711AC7935CB187949CB95822EC5FC92AF0E29AAECFD9BD3170. Tarifa registrada no patch 0011.
- Teste scripts/test-residence-cashier.cjs: início/stop/replay/persistência aprovados; fluxo 5,74 kW durante recarga, zero após parada; zero comandos físicos; preservados 65/61/45 registros operacionais.
- Build Backend e TypeScript Frontend passaram; teste do cartão residencial confirma botão SANDBOX sem controles físicos.
- Escopo desta alteração: caixa no Site. Não habilita acesso público/visitante via QR para a Residência privada.
