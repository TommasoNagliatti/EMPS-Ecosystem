# EMPS — Motor de Tarifação (Protótipo V1)

## Regra comercial

Área inicial: `SP_ENEL`.

- Base: **R$ 1,99/kWh**
- Suporte da rede para a recarga EV: **+R$ 0,20/kWh**
- Alta demanda: **+R$ 0,10/kWh**
- Teto: **R$ 2,29/kWh**

Quatro estados:

| Estado | Tarifa |
|---|---:|
| Normal | R$ 1,99/kWh |
| Alta demanda | R$ 2,09/kWh |
| Suporte da rede | R$ 2,19/kWh |
| Rede + alta demanda | R$ 2,29/kWh |

A fórmula por intervalo é:

`tarifa = min(teto, base + adicional_rede + adicional_demanda)`

`valor_intervalo = energia_kWh × tarifa`

`valor_energia = soma(valor_intervalo)`

## Taxa de permanência

Quando a recarga termina, começa uma carência de **15 minutos**.

Depois da carência:

- **R$ 0,25 por minuto iniciado**
- teto de **R$ 20,00 por sessão**

Fórmula:

`valor_total = valor_energia + taxa_permanencia`

No código e na API use `overstay_fee` / **taxa de permanência**, e não "multa". Antes de produção real, essa regra deve ser validada juridicamente e constar claramente nos termos e na interface do cliente.

## Origem dos dados

O motor não calcula telemetria nem previsão. O backend entrega fatos já classificados:

- `energy_kwh`: energia efetivamente entregue/aceita para cobrança;
- `grid_support_for_ev`: booleano informando se aquele intervalo de recarga depende de suporte da rede;
- `high_demand`: booleano indicando faixa normal/alta.

O frontend NÃO deve calcular tarifa.

## Transparência ao cliente

Antes de iniciar a sessão, mostrar:

- tarifa atual;
- tarifa mínima;
- tarifa máxima;
- carência;
- taxa de permanência;
- teto da taxa de permanência.

No recibo, separar energia, permanência e total.

## Divisão interna da receita

Protótipo:

- referência do proprietário: **R$ 0,20/kWh**
- referência da plataforma/GoodWe: **R$ 0,10/kWh**
- taxa de permanência: atribuída ao proprietário

Esses valores NÃO são somados novamente ao cliente. São referências internas retiradas da receita energética já cobrada.

O `residual_operating_pool` não é lucro: ainda pode conter custo da energia, impostos, adquirência, manutenção, depreciação e infraestrutura.

## Precisão

O módulo usa `Decimal` para dinheiro.

- dinheiro: 2 casas;
- energia: 4 casas.

Evite `float` em contratos financeiros.

## Versionamento

Versão atual: `SP_ENEL_PROTO_V1`.

Persistir `tariff_version` em cada sessão/fatura.

Uma sessão histórica não deve ser recalculada com uma regra futura.

## Integração

Se o backend oficial for NestJS/TypeScript, há duas opções:

1. manter este motor Python como serviço interno;
2. reimplementar futuramente em TypeScript com testes de paridade.

Não espalhar a fórmula em frontend, app e backend.

A fonte de verdade da tarifação deve ser única.

## Responsabilidade do backend

O backend deve:

- manter `session_id` único;
- persistir intervalos de cobrança;
- impedir cobrança dupla do mesmo intervalo;
- finalizar pagamento de forma idempotente;
- salvar `tariff_version`;
- salvar o breakdown retornado;
- proteger endpoints administrativos;
- expor quote e recibo ao site/app.

## Não pertence a este módulo

Não implementa:

- autenticação;
- banco;
- Stripe;
- QR;
- previsão;
- GIE;
- hardware;
- impostos;
- nota fiscal;
- autorização de usuário.

Ele recebe fatos e devolve preço.
