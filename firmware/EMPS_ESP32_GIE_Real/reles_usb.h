#pragma once
// All permissions are independent. Neither an LED nor allocated kW is a session.
constexpr bool releUsbPermitido(bool local, bool transporte, bool snapshot,
    bool hardware, bool eletrica, bool aprovacaoVigente, bool cenas,
    bool gie, bool sessao, bool operacional, bool sessaoVigente, bool comando) {
  return local && transporte && snapshot && hardware && eletrica && aprovacaoVigente &&
    !cenas && gie && sessao && operacional && sessaoVigente && comando;
}
static_assert(!releUsbPermitido(true,true,true,true,true,true,true,true,true,true,true,true), "Cenas nunca ligam reles");
static_assert(!releUsbPermitido(true,true,false,true,true,true,false,true,true,true,true,true), "Timeout desliga");
static_assert(!releUsbPermitido(true,false,true,true,true,true,false,true,true,true,true,true), "Desconexao desliga");
static_assert(!releUsbPermitido(true,true,true,false,true,true,false,true,true,true,true,true), "Hardware obrigatorio");
static_assert(!releUsbPermitido(true,true,true,true,false,true,false,true,true,true,true,true), "Protecao obrigatoria");
static_assert(!releUsbPermitido(true,true,true,true,true,true,false,true,false,true,true,true), "Sem sessao nao liga");
static_assert(!releUsbPermitido(true,true,true,true,true,true,false,true,true,true,false,true), "Sessao vencida desliga");
static_assert(!releUsbPermitido(true,true,true,true,true,false,false,true,true,true,true,true), "Aprovacao vencida desliga");
static_assert(!releUsbPermitido(true,true,true,true,true,true,false,false,true,true,true,true), "GIE invalido desliga");
static_assert(!releUsbPermitido(false,true,true,true,true,true,false,true,true,true,true,true), "Bloqueio local obrigatorio");
static_assert(!releUsbPermitido(true,true,true,true,true,true,false,true,true,false,true,true), "Autorizacao operacional obrigatoria");
static_assert(!releUsbPermitido(true,true,true,true,true,true,false,true,true,true,true,false), "Sem comando nao liga");
static_assert(releUsbPermitido(true,true,true,true,true,true,false,true,true,true,true,true), "Sessao autorizada pode ligar");
