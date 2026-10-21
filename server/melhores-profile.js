// Only the signed-in person's goals and achievements cross this boundary.
export function personalProfile(game,user){
 const id=user.participantId||user.id;
 const participant=(game.participants||[]).find(p=>p.id===id);
 const achievements=[];
 for(const entry of game.weeklyFactHistory||[]){
  for(const [kind,key] of [['best','best'],['worst','worst']]){
   const fact=entry[key];
   if(fact?.participantId!==id)continue;
   achievements.push({id:String(entry.id)+':'+kind,kind,date:entry.date||entry.timestamp||null,description:String(fact.description||'').trim()});
  }
 }
 achievements.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 const count=kind=>achievements.filter(a=>a.kind===kind).length;
 const bestWins=Math.max(count('best'),Number(participant?.scoreBreakdown?.melhorFato)||0);
 const worstWins=Math.max(count('worst'),Number(participant?.scoreBreakdown?.piorFato)||0);
 return {name:participant?.name||user.name,photoUrl:participant?.photoUrl||'',objectives:participant?.objectives||{},achievements,bestWins,worstWins,goalsActive:participant?.sheetEnrollment?.active===true,goalsFormUrl:process.env.MELHORES_GOALS_FORM_URL||'https://forms.gle/LdSj6Zk3Y43jctqM9'};
}
