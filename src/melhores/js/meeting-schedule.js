// The weekly meeting follows Brasilia time, independent of the device timezone.
export function meetingSchedule(now=Date.now()) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const {year,month,day}=parts;const date=Date.UTC(+year,+month-1,+day);const weekday=new Date(date).getUTCDay();
 const friday=weekday===5;const target=date+((5-weekday+7)%7)*86400000+(17*60+15+180)*60000;
 const remaining=Math.max(0,Math.ceil((target-now)/1000));
 return {friday,remaining,elapsed:friday&&now>=target,target};
}
export function meetingNotice(now=Date.now()) {
 const schedule=meetingSchedule(now);
 if(!schedule.friday)return '<span>📅 Nosso próximo encontro é sexta-feira às <strong>17h15</strong>.</span><small>Horário de Brasília</small>';
 if(schedule.elapsed)return '<span>⏰ Já deu 17h15! Ainda não iniciamos.</span><small>Aguarde o administrador abrir a sala.</small>';
 const h=String(Math.floor(schedule.remaining/3600)).padStart(2,'0'),m=String(Math.floor(schedule.remaining/60)%60).padStart(2,'0'),s=String(schedule.remaining%60).padStart(2,'0');
 return `<span>✨ Nosso encontro é daqui a</span><strong class="meeting-countdown" role="timer" aria-label="${h} horas, ${m} minutos e ${s} segundos">${h}h ${m}m ${s}s</strong><small>Hoje, às 17h15 · horário de Brasília</small>`;
}
