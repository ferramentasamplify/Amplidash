import {update} from './melhores-auth.js';

export async function archiveRoomChat(store,room){
  if(!room||!['completed','closed'].includes(room.phase))return;
  if(await store.get('chat-reports/'+room.id,{type:'json'}))return;
  const endedAt=room.completedAt||room.closedAt||new Date().toISOString();
  const messages=await store.get('room-chat/'+room.id,{type:'json'})||[];
  // Keep original messages private; terminal sessions never return them to participants.
  await store.setJSON('chat-reports/'+room.id,{id:room.id,endedAt,testMode:!!room.testMode,phase:room.phase,messages});
  await update(store,'chat-report-index',old=>{
    if((old||[]).some(entry=>entry.id===room.id))return old;
    return [{id:room.id,endedAt,testMode:!!room.testMode,count:messages.length},...(old||[])];
  });
}
