import type { ChargingSession } from '../domain/models';

const escape = (value: unknown) => String(value ?? 'Não informado').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const currency = (value: string | null) => value === null ? 'Não discriminado no registro legado' : Number(value).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
const date = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'}) : 'Não informado';

export function receiptHtml(session: ChargingSession, station: string, charger: string, logo: string) {
  const paid = session.receipt;
  if (session.status !== 'completed' || !paid || paid.status !== 'approved') throw new Error('O comprovante está disponível após a confirmação do pagamento pelo servidor.');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new Error('Logo do comprovante indisponível.');
  const rows = receiptRows(session, station, charger);
  return receiptMarkup(session, logo, rows);
}
export function receiptRows(session: ChargingSession, station: string, charger: string) {
  const paid = session.receipt;
  if (session.status !== 'completed' || !paid || paid.status !== 'approved') throw new Error('Aguarde a confirmação do pagamento.');
  const method: Record<string,string> = {card:'Cartão',pix:'PIX',cash:'Dinheiro',wallet:'Carteira digital',simulated:'Simulado'};
  return [
    ['Transação', paid.transactionId], ['Pagamento', paid.paymentId], ['Sessão', session.id],
    ['Estação', station], ['Carregador', charger], ['Data e hora do pagamento', date(paid.paidAt)],
    ['Início da recarga', date(session.startedAt)], ['Fim da recarga', date(session.endedAt)],
    ['Energia consumida', Number(paid.energyKwh ?? session.billing?.energy_kwh ?? session.energyKwh).toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})+' kWh'],
    ['Valor de energia', currency(paid.energyAmount)], ['Taxa de permanência', currency(paid.overstayFee)],
    ...(paid.reservation?[['Reserva',currency(paid.reservation.fee)],['Período reservado',date(paid.reservation.startAt)+' — '+date(paid.reservation.endAt)],['Pagamento da reserva',paid.reservation.provider==='SANDBOX'?'Demo/Sandbox':paid.reservation.provider==='FREE'?'Sem taxa':paid.reservation.provider??'Não informado'],['Referência da reserva',paid.reservation.id],['Total · reserva + recarga',currency(paid.reservation.totalWithCharging)]]:[]),
    ['Versão tarifária', paid.tariffVersion ?? session.tariffVersion ?? 'Legada'],
    ['Tarifa efetiva / kWh', currency(paid.effectiveRate ?? null)],
    ['Taxa fixa registrada', currency(paid.fixedFee ?? null)],
    ['Duração da carga', paid.durationSeconds == null ? 'Não informado' : String(paid.durationSeconds) + ' segundos'],
    ['Desconexão', date(session.disconnectedAt)],
    ['Referência do provedor', paid.providerReference && /^pi_[a-zA-Z0-9]+$/.test(paid.providerReference) ? paid.providerReference : 'Não disponível'],
    ...(paid.disposition?[['Valor autorizado',currency(paid.disposition.authorizedAmount)],['Valor efetivamente usado',currency(paid.disposition.consumedAmount)],['Valor capturado',currency(paid.disposition.capturedAmount)],['Valor liberado',currency(paid.disposition.releasedAmount)],['Valor a devolver',currency(paid.disposition.refundDueAmount)],['Valor devolvido'+(paid.disposition.refundStatus==='SIMULATED'?' (Demo/Sandbox)':''),currency(paid.disposition.refundedAmount)],['Destino da devolução','Mesmo meio de pagamento']]:[]),
    ['Método', method[paid.method] ?? paid.method], ['Status', 'Aprovado'],
  ];
}
function receiptMarkup(session: ChargingSession, logo: string, rows: (string | null | undefined)[][]) {
  const paid = session.receipt!;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#202734;margin:0;font-size:12px}header{border-bottom:3px solid #d9212e;padding-bottom:20px}img{width:150px;height:auto}h1{font-size:24px;margin:18px 0 6px}.note{color:#586273;line-height:1.5}table{width:100%;border-collapse:collapse;margin:24px 0}td{padding:9px 4px;border-bottom:1px solid #e5e8ed;vertical-align:top;overflow-wrap:anywhere}td:first-child{width:39%;color:#586273}td:last-child{text-align:right}.total{padding:20px;background:#f2f4f7;border-radius:10px;display:flex;justify-content:space-between;font-size:22px;font-weight:bold}footer{margin-top:24px;font-size:10px;line-height:1.6;color:#586273}
  </style></head><body><header><img alt="EMPS" src="${logo}"><h1>Comprovante de pagamento</h1><div class="note">EMPS Charge · ${paid.provider === 'stripe' || paid.provider === 'sandbox' || paid.provider === 'zero_amount' ? 'Ambiente de testes / demonstração' : 'Pagamento registrado'}</div></header><table>${rows.map(([label,value])=>`<tr><td>${escape(label)}</td><td>${escape(value)}</td></tr>`).join('')}</table><div class="total"><span>Total pago</span><span>${escape(currency(paid.amountPaid))}</span></div><footer>Valores registrados pelo backend EMPS. Horários de Brasília.<br>Este comprovante não substitui documento fiscal.</footer></body></html>`;
}
