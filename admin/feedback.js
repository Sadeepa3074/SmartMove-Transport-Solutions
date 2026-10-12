"use strict";
(function(){
 let rows=[];
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 const stars=n=>{const r=Math.max(0,Math.min(5,Number(n)||0));return "★".repeat(r)+"☆".repeat(5-r);};
 function filtered(){const q=($('feedback-search')?.value||'').trim().toLowerCase(),status=($('feedback-status-filter')?.value||'all').toUpperCase();return rows.filter(f=>{const text=[f.FIRST_NAME,f.LAST_NAME,f.EMAIL,f.ROUTE_NAME,f.FEEDBACK_COMMENT,f.FEEDBACK_RESPONSE].join(' ').toLowerCase();return (!q||text.includes(q))&&(status==='ALL'||String(f.FEEDBACK_STATUS||'').toUpperCase()===status);});}
 function render(){
  const list=$('feedback-list'); if(!list)return; const data=filtered(); list.replaceChildren();
  const total=rows.length,avg=total?rows.reduce((s,f)=>s+Number(f.RATING||0),0)/total:0,newCount=rows.filter(f=>String(f.FEEDBACK_STATUS||'NEW').toUpperCase()==='NEW').length,pub=rows.filter(f=>String(f.FEEDBACK_STATUS||'').toUpperCase()==='PUBLISHED').length;
  if($('feedback-total'))$('feedback-total').textContent=total; if($('feedback-average'))$('feedback-average').textContent=total?avg.toFixed(1)+"/5":"—"; if($('feedback-new'))$('feedback-new').textContent=newCount; if($('feedback-published'))$('feedback-published').textContent=pub; if($('feedback-result-count'))$('feedback-result-count').textContent=`${data.length} review${data.length===1?'':'s'}`;
  if(!data.length){list.append(Object.assign(document.createElement('p'),{className:'feedback-empty',textContent:rows.length?'No feedback matches the current filter.':'No passenger feedback records found.'}));return;}
  data.forEach(f=>{
   const c=document.createElement('article');c.className='feedback-review';
   const status=String(f.FEEDBACK_STATUS||'NEW').toUpperCase(), cls=status==='PUBLISHED'?'feedback-status-resolved':status==='VERIFIED'?'feedback-status-responded':'feedback-status-new';
   const name=esc(`${f.FIRST_NAME||'Passenger'} ${f.LAST_NAME||''}`.trim()), route=esc(f.ROUTE_NAME||'General feedback'), vehicle=esc(f.REGISTRATION_NUMBER||'No vehicle linked');
   c.innerHTML=`<div class="feedback-review-top"><div><h4>${name}</h4><p class="feedback-review-meta">${esc(f.EMAIL||'')} · ${route} · ${vehicle}</p></div><span class="feedback-status ${cls}">${esc(status)}</span></div><div class="feedback-stars" aria-label="${Number(f.RATING||0)} out of 5">${stars(f.RATING)}</div><p class="feedback-comment">${esc(f.FEEDBACK_COMMENT||f.COMMENT||'')}</p>${f.FEEDBACK_RESPONSE?`<div class="feedback-admin-reply"><strong>Administrator response</strong><p>${esc(f.FEEDBACK_RESPONSE)}</p></div>`:''}<div class="feedback-review-bottom"><small>${f.FEEDBACK_DATE?new Date(f.FEEDBACK_DATE).toLocaleString('en-LK'):''}</small><div class="feedback-actions"></div></div>`;
   const actions=c.querySelector('.feedback-actions'); if(status!=='PUBLISHED')actions.append(button('Publish','feedback-action-btn',()=>update(f.FEEDBACK_ID,'PUBLISHED'))); if(status==='NEW')actions.append(button('Verify','feedback-action-btn',()=>update(f.FEEDBACK_ID,'VERIFIED'))); if(status!=='REJECTED')actions.append(button('Reject','feedback-action-btn feedback-reject',()=>update(f.FEEDBACK_ID,'REJECTED'))); list.append(c);
  });
 }
 function button(t,cl,fn){const b=document.createElement('button');b.type='button';b.className=cl;b.textContent=t;b.onclick=fn;return b;}
 async function load(){try{const r=await fetch('/api/feedback');const d=await r.json().catch(()=>[]);if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);rows=Array.isArray(d)?d:[];}catch(e){console.error('Feedback management:',e);rows=[];}render();}
 async function update(id,status){const response=prompt(status==='REJECTED'?'Optional reason:':'Optional administrator response:','');const r=await fetch(`/api/feedback/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,response})}),d=await r.json().catch(()=>({}));if(!r.ok)return alert(d.error||`HTTP ${r.status}`);await load();}
 function setup(){if($('feedback-page')){$('feedback-search')?.addEventListener('input',render);$('feedback-status-filter')?.addEventListener('change',render);load();}}
 window.renderFeedbackManagement=load;document.addEventListener('DOMContentLoaded',setup);
})();
