import {BadRequestException} from '@nestjs/common';
import {parse} from 'csv-parse/sync';
import {Workbook} from 'exceljs';
import {createHash} from 'node:crypto';
import {telemetryFields,intervalFields,validateReading,type TelemetryInput} from './telemetry-domain';
export async function parseHistory(file:{buffer:Buffer;originalname:string},timezone:string){
 try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format()}catch{throw new BadRequestException('Timezone IANA obrigatório')}
 if(!timezone||file.buffer.length>8*1024*1024)throw new BadRequestException('Arquivo excede 8 MB ou timezone ausente');
 let matrix:unknown[][];
 try{
  if(file.originalname.toLowerCase().endsWith('.csv'))matrix=parse(file.buffer,{bom:true,skip_empty_lines:true,max_record_size:65536});
  else if(file.originalname.toLowerCase().endsWith('.xlsx')){
   const book=new Workbook();await book.xlsx.load(file.buffer as any);
   if(book.worksheets.length!==1)throw new Error('Use uma única planilha');
   const sheet=book.worksheets[0];if(sheet.rowCount>10001||sheet.columnCount>20)throw new Error('Limite de linhas/colunas excedido');
   matrix=[];sheet.eachRow(row=>{const values=(row.values as unknown[]).slice(1);if(values.some(v=>v!==null&&typeof v==='object'))throw new Error('Use valores simples e timestamp como texto ISO; fórmulas não são aceitas');matrix.push(values)});
  }else throw new Error('Use CSV ou XLSX');
 }catch(e){const message=e instanceof Error?e.message:'';throw new BadRequestException('Arquivo inválido: '+(/^(Use |Limite )/.test(message)?message:'não foi possível ler a estrutura. Salve novamente como CSV ou XLSX e confira as colunas.'))}
 if(matrix.length<2||matrix.length>10001)throw new BadRequestException('Importe entre 1 e 10000 linhas');
 const headers=matrix[0].map(String);if(new Set(headers).size!==headers.length||headers.some(h=>h!=='timestamp'&&!Object.hasOwn(telemetryFields,h)&&!Object.hasOwn(intervalFields,h)))throw new BadRequestException('Colunas duplicadas ou desconhecidas');
 for(const key of ['timestamp','building_power_kw','outside_temperature_c','relative_humidity_percent'])if(!headers.includes(key))throw new BadRequestException('Coluna obrigatória: '+key);
 const rows:TelemetryInput[]=[];let previous:number|undefined;
 for(let i=1;i<matrix.length;i++){
  const values=matrix[i];if(values.length!==headers.length)throw new BadRequestException('Número de colunas incorreto na linha '+(i+1));
  const row=Object.fromEntries(headers.map((h,j)=>[h,values[j]])) as TelemetryInput;
  for(const key of ['building_power_kw','outside_temperature_c','relative_humidity_percent'])if(row[key]===null||row[key]===undefined||String(row[key]).trim()==='')throw new BadRequestException('Valor ausente na linha '+(i+1));
  const validated=validateReading(row,'IMPORTED'),time=validated.measuredAt.getTime();
  if(time%900000!==0||(previous!==undefined&&time-previous!==900000))throw new BadRequestException('Histórico deve estar ordenado, sem duplicatas/lacunas e em intervalos de 15 minutos; linha '+(i+1));
  previous=time;rows.push(row);
 }
 return {rows,timezone,sha256:createHash('sha256').update(file.buffer).digest('hex'),first:rows[0].timestamp,last:rows.at(-1)!.timestamp,provenance:'IMPORTED' as const,intervalMinutes:15};
}
