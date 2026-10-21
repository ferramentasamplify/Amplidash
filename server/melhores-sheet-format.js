import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
const list=value=>value==null?[]:Array.isArray(value)?value:[value];
const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,trimValues:false});
const text=value=>typeof value==='object'&&value!==null?String(value['#text']??''):String(value??'');
const rich=value=>value?.t!==undefined?text(value.t):list(value?.r).map(r=>text(r.t)).join('');
function red(fill){
 const color=fill?.patternFill?.fgColor;
 let hex=color?.['@_rgb'];
 if(!hex&&['2','10'].includes(color?.['@_indexed']))hex='FF0000';
 if(!hex)return false;hex=hex.slice(-6);if(!/^[a-f0-9]{6}$/i.test(hex))return false;
 const [r,g,b]=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 return r>=.8&&r-g>=.1&&r-b>=.1;
}
// Google CSV omits moderation colors. The XLSX export retains per-cell fills.
export function formattedSheetRows(bytes){
 if(bytes.length>2000000)throw Error('Planilha acima do limite.');
 let expanded=0;
 const files=unzipSync(bytes,{filter:file=>{
  if(!/^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|styles\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/.test(file.name))return false;
  expanded+=file.originalSize;if(expanded>8000000)throw Error('Conteúdo da planilha acima do limite.');return true;
 }});
 const read=name=>{if(!files[name])return null;const xml=strFromU8(files[name]);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML de planilha inválido.');return parser.parse(xml);};
 const workbook=read('xl/workbook.xml');
 const sheets=list(workbook?.workbook?.sheets?.sheet);
 const sheet=sheets.find(s=>s['@_name']==='Respostas ao formulário 1')||sheets[0];
 const relations=list(read('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship);
 const target=relations.find(r=>r['@_Id']===sheet?.['@_id'])?.['@_Target'];
 if(!target)throw Error('Aba de respostas não encontrada.');
 const path=target.startsWith('/')?target.slice(1):'xl/'+target;
 const data=read(path);if(!data?.worksheet)throw Error('Aba de respostas indisponível.');
 const strings=list(read('xl/sharedStrings.xml')?.sst?.si).map(rich);
 const styles=read('xl/styles.xml')?.styleSheet;
 const fills=list(styles?.fills?.fill),formats=list(styles?.cellXfs?.xf);
 const rows=[];
 for(const row of list(data.worksheet.sheetData?.row)){
  if(rows.length>=2000)throw Error('Linhas acima do limite.');
  const values=Array(7).fill('');
  for(const cell of list(row.c)){
   const address=cell['@_r']||'',column=address.match(/^([A-Z]+)/)?.[1];
   if(!column||column.length!==1||column>'G')continue;
   const index=column.charCodeAt(0)-65,type=cell['@_t'];
   let value=type==='s'?strings[Number(cell.v)]||'':type==='inlineStr'?rich(cell.is):text(cell.v);
   if(index>=2&&(type==='e'||red(fills[Number(formats[Number(cell['@_s']||0)]?.['@_fillId']||0)])))value='';
   values[index]=value;
  }
  if(values.some(Boolean))rows.push(values);
 }
 return rows;
}
