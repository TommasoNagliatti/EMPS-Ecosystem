import {Draft} from './station-types';
import styles from './platform.module.css';
const days=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const labels:Record<string,string>={CONFIGURED:'Configurado',ACTIVE:'Ativo',INACTIVE:'Inativo',FAULTED:'Com falha',PENDING:'Pendente',ENABLED:'Habilitado',DISABLED:'Desabilitado',MAINTENANCE:'Manutenção'};
export function StationSummary({draft}:{draft:Draft}){
 const batteries=draft.batteries.filter(b=>b.status!=='INACTIVE');
 const total=batteries.reduce((n,b)=>n+Number(b.capacityKwh||0),0);
 const known=batteries.every(b=>b.socPercent!==undefined&&b.socPercent!==null);
 const soc=known&&total?batteries.reduce((n,b)=>n+Number(b.capacityKwh)*Number(b.socPercent)/100,0)/total*100:null;
 return <><div className={styles.summary}>
  <section><h3>{draft.name||'Estação sem nome'}</h3><p>{String(draft.street||'Rua a preencher')}, {String(draft.addressNumber||'s/n')}<br/>{String(draft.city||'Cidade')}/{String(draft.state||'UF')} · {String(draft.countryCode||'BR')}</p><small>{String(draft.timezone||'America/Sao_Paulo')}</small></section>
  <section><h3>Disponibilidade</h3><p>{draft.visibility==='PUBLIC'?'Pública':'Privada'} · {draft.availability.alwaysOpen?'24 horas':draft.availability.windows.length+' janelas semanais'}</p>{!draft.availability.alwaysOpen&&draft.availability.windows.map((w,i)=><p key={i}>{days[w.day]} · {w.start}–{w.end}{w.start>=w.end?' (dia seguinte)':''}</p>)}<small>{draft.guestAllowed?'Permite visitante nas estações públicas elegíveis':'Conta EMPS necessária'}</small></section>
  <section><h3>Energia</h3><p>Limite da rede: {String(draft.powerLimitKw??'a preencher')} kW<br/>{draft.solarAssets.filter(a=>a.status!=='INACTIVE').length} conjuntos solares<br/>{batteries.length} baterias · {total.toLocaleString('pt-BR')} kWh</p><small>SOC ponderado: {soc===null?'sem leitura':soc.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</small></section>
  <section><h3>Carregadores e comodidades</h3><p>{draft.chargers.filter(c=>c.administrativeStatus!=='DISABLED').length} carregadores</p><small>{draft.chargers.map(c=>c.name+' · '+c.powerKw+' kW').join(', ')||'Nenhum adicionado'}</small><p>{draft.amenities.join(' · ')||'Sem comodidades selecionadas'}</p></section>
 </div><details className={styles.equipment}><summary>Configuração individual dos equipamentos</summary><div className={styles.summary}>
 {draft.batteries.map((b,i)=><section key={String(b.id??'b'+i)}><h3>{b.name}</h3><p>{b.capacityKwh} kWh · {labels[String(b.status)]??b.status}<br/>Carga: {b.maxChargeKw} kW · Descarga: {b.maxDischargeKw} kW<br/>SOC: {b.socPercent??'sem leitura'}{b.socPercent!==undefined?'%':''} · limites: {b.minSocPercent}–{b.maxSocPercent}%<br/>Eficiência: {Number(b.efficiency)*100}%</p><small>{[b.manufacturer,b.model,b.integrationRef].filter(Boolean).join(' · ')}</small></section>)}
 {draft.solarAssets.map((a,i)=><section key={String(a.id??'s'+i)}><h3>{a.name}</h3><p>{a.installedKwp} kWp · {labels[String(a.status)]??a.status}<br/>Potência AC: {a.acPowerKw??'não informada'} kW</p><small>{[a.inverter,a.manufacturer,a.model,a.integrationRef].filter(Boolean).join(' · ')}</small></section>)}
 {draft.chargers.map((c,i)=><section key={String(c.id??'c'+i)}><h3>{c.name}</h3><p>{c.powerKw} kW · {c.connectorType}<br/>{labels[String(c.administrativeStatus)]??c.administrativeStatus}<br/>Tarifa base: {c.pricePerKwh===undefined?'não configurada':Number(c.pricePerKwh).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+'/kWh'}</p><small>{[c.manufacturer,c.model,c.serialNumber,c.ocppIdentity].filter(Boolean).join(' · ')}</small></section>)}
 </div></details></>;
}
