# Stripe local — Sandbox

Use apenas `C:\goodwill_ai\EMPS_GITHUB`. Não há cobrança bancária real nos testes descritos aqui.

1. No Dashboard Stripe, selecione o Sandbox da conta e obtenha suas chaves de teste, da mesma conta: pública `pk_test_…` e secreta `sk_test_…`.
2. Backend: `site/emps-site-main/backend/.env.presentation` recebe `PAYMENT_PROVIDER=stripe` e `STRIPE_SECRET_KEY`. A chave pública pode ficar em `STRIPE_PUBLISHABLE_KEY` nesse arquivo. Na ausência dela, o launcher usa `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` de `app/emps-charge/.env`.
3. Execute `./START_EMPS_V2.ps1` em PowerShell 7. Ele inicia o listener existente e entrega o signing secret do listener ao Backend em memória. Também habilita Pix **Demo** local. Não inicie outro listener em paralelo.
4. Para operação manual, use Stripe CLI autenticado no mesmo Sandbox: `stripe listen --forward-to http://127.0.0.1:3001/payments/stripe/webhook`. O `whsec_…` dessa execução deve ser `STRIPE_WEBHOOK_SECRET` no processo Backend; reinicie somente esse processo com a configuração correta. O signing secret de um endpoint do Dashboard não substitui o secret desse listener local.
5. Abra o QR de um carregador Demo aprovado em `/charge/<token>`. Autorize R$12,50 no cartão Sandbox. Use `4242 4242 4242 4242`, validade futura e CVC de três dígitos. Para recusa, use `4000 0000 0000 0002`. Não use cartão real. [Cartões oficiais](https://docs.stripe.com/testing).
6. START só ocorre após autorização confirmada. Encerre após consumo de pelo menos R$0,50 para validar captura parcial de cartão; quantia abaixo do mínimo do provider fica pendente de acerto, sem aumentar artificialmente o total. O comprovante discrimina autorizado, capturado e liberado. Reabrir Web Charge recupera recarga com pagamento pendente para tentar concluir o mesmo intent.
7. Confira eventos do listener e respostas HTTP 2xx para `/payments/stripe/webhook`; no Dashboard confira o mesmo PaymentIntent, captura manual, valor recebido e saldo liberado. A confirmação também consulta o provider pelo Backend, sem confiar apenas na UI. Para testar idempotência, repetir STOP deve preservar intent, pagamento e captura.

Pix no projeto atual é **Demo/Sandbox**, incluindo devolução simulada. Não existe nesta configuração uma liquidação Pix bancária real.

Não versionar `.env`, `.env.presentation`, chaves, `whsec_…`, client secrets, tokens de sessão, dumps ou relatórios privados. O launcher falha com aviso se a chave pública de teste não estiver disponível. As chaves locais existentes foram suficientes; não é necessário criar outro Sandbox ou conta.
