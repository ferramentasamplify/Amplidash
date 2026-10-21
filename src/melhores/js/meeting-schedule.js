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
 const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(schedule.target));
 const days=Math.floor(schedule.remaining/86400),hours=Math.floor(schedule.remaining/3600)%24,minutes=Math.floor(schedule.remaining/60)%60,seconds=schedule.remaining%60;
 const countdown=days>0?`${days} ${days===1?'dia':'dias'} e ${hours} ${hours===1?'hora':'horas'}`:hours>0?`${hours} ${hours===1?'hora':'horas'} e ${minutes} min`:minutes>0?`${minutes} min e ${seconds} s`:`${seconds} s`;
 return `<span>✨ Nosso próximo encontro será</span><strong class="meeting-date">Sexta-feira, às 17h15</strong><span class="meeting-calendar-date">📅 ${date}</span>${schedule.elapsed?'<small>⏰ Ainda não iniciamos. Aguarde o administrador abrir a sala.</small>':`<small class="meeting-countdown" role="timer">⏳ Faltam ${countdown}</small>`}<a class="meeting-meet-link" href="https://meet.google.com/xjb-mdaq-scn" target="_blank" rel="noopener noreferrer">📹 Entrar no Google Meet ↗</a>`;
}
