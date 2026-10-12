"use strict";
(function(){
 const $=id=>document.getElementById(id), u=()=>window.SmartMoveDemo?.current?.()||null; let bookings=[],feedback=[]; let rating=0;
 const money=n=>"Rs. "+Number(n||0).toLocaleString("en-LK",{minimumFractionDigits:2});
 function msg(id,v,error=false){if($(id)){ $(id).textContent=v; $(id).classList.toggle("error",error); }}
 async function load(){
  let user=u();if(!user)return;
  try{
    if(!user.userId){const pr=await fetch(`/api/customer/profile?email=${encodeURIComponent(user.email)}`);if(pr.ok){const pd=await pr.json();window.SmartMoveDemo.update({userId:pd.USER_ID||pd.user_id});user=u();}}
    const [b,f,t]=await Promise.all([
      fetch(`/api/customer-bookings?email=${encodeURIComponent(user.email)}`),
      fetch(`/api/feedback?userId=${encodeURIComponent(user.userId||"")}`),
      fetch(`/api/feedback-options?userId=${encodeURIComponent(user.userId||"")}`)
    ]);
    bookings=b.ok?await b.json():[];
    feedback=f.ok?await f.json():[];
    const tripOptions=t.ok?await t.json():[];
    window.__smartMoveFeedbackTrips=Array.isArray(tripOptions)?tripOptions:[];
  }catch(e){console.error(e);window.__smartMoveFeedbackTrips=[];}
  render();
 }
 function render(){
  const user=u();if(!user)return;
  $("account-avatar").textContent=((user.firstName?.[0]||"")+(user.lastName?.[0]||"")).toUpperCase();
  $("account-name").textContent=`${user.firstName} ${user.lastName}`;$("account-email").textContent=user.email;
  $("profile-first").value=user.firstName;$("profile-last").value=user.lastName;$("profile-email").value=user.email;$("profile-phone").value=user.phone||"";
  $("account-completed").textContent=bookings.filter(b=>{const d=b.DEPARTURE_TIME?new Date(b.DEPARTURE_TIME).getTime():NaN;return String(b.BOOKING_STATUS||"").toUpperCase()==="COMPLETED"||Number.isFinite(d)&&d<Date.now();}).length;
  const list=$("account-upcoming-list"),hist=$("account-history-list"),fb=$("account-feedback-list"),preview=$("account-feedback-preview"),sel=$("account-inline-trip");
  [list,hist,fb,preview].forEach(x=>x?.replaceChildren());
  if(sel){
    sel.innerHTML='<option value="">General feedback (no trip selected)</option>';
    (window.__smartMoveFeedbackTrips||[]).forEach(t=>{
      const o=document.createElement("option");o.value=t.TRIP_ID;
      const when=t.DEPARTURE_TIME?new Date(t.DEPARTURE_TIME).toLocaleString():"";
      const reviewStatus=String(t.REVIEW_STATUS||"BOOKED").toUpperCase();
      const available=reviewStatus==='AVAILABLE';
      o.textContent=`${t.TRIP_ID} — ${t.ROUTE_NAME||`${t.START_LOC||""} → ${t.END_LOC||""}`} — ${when}${available?'':' — booked trip'}`;
      o.disabled=false;o.dataset.vehicle=t.VEHICLE_ID||"";o.dataset.reviewStatus=reviewStatus;sel.append(o);
    });
  }
  const now=Date.now();
  bookings.forEach(b=>{
    const status=String(b.BOOKING_STATUS||"").toUpperCase(), departure=b.DEPARTURE_TIME?new Date(b.DEPARTURE_TIME).getTime():NaN, past=Number.isFinite(departure)&&departure<now, completed=status==="COMPLETED"||past||status==="CANCELLED";
    const card=document.createElement("article");card.className="account-record";
    card.innerHTML=`<div class="account-record-head"><div><span class="booking-number">${b.BOOKING_ID}</span><h3>${b.ROUTE_NAME||`${b.START_LOC} → ${b.END_LOC}`}</h3><p>${b.DEPARTURE_TIME?new Date(b.DEPARTURE_TIME).toLocaleString():""} · Seats: ${b.SEAT_NUMBER||""} · ${money(b.TOT_AMOUNT)}</p></div><span class="account-state ${status.toLowerCase()}">${b.BOOKING_STATUS}</span></div>`; if(!completed && status!=="CANCELLED"){const x=document.createElement("button");x.className="account-outline";x.textContent="Cancel Booking";x.onclick=async()=>{if(!confirm("Cancel this booking? The payment will be marked refunded and the seats returned."))return;const r=await fetch(`/api/bookings/${encodeURIComponent(b.BOOKING_ID)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"CANCELLED",email:u().email})}),d=await r.json().catch(()=>({}));if(!r.ok)return alert(d.error||"Cancellation failed.");await load()};card.append(x)}
    if(completed)hist?.append(card);else list?.append(card);
  });
  if(!list?.children.length)list?.append(Object.assign(document.createElement("p"),{className:"account-empty",textContent:"No upcoming bookings found."}));
  if(!hist?.children.length)hist?.append(Object.assign(document.createElement("p"),{className:"account-empty",textContent:"No past or cancelled journeys yet."}));
  feedback.forEach(f=>{const c=document.createElement("article");c.className="account-record";c.innerHTML=`<h3>${f.RATING}/5 · ${f.FEEDBACK_STATUS||"NEW"}${f.ROUTE_NAME?` · ${f.ROUTE_NAME}`:""}</h3><p>${f.FEEDBACK_COMMENT||f.COMMENT||""}</p><small>${f.FEEDBACK_RESPONSE||f.RESPONSE||"Awaiting administrator response."}</small>`;fb?.append(c);preview?.append(c.cloneNode(true));});
  if(!feedback.length)fb?.append(Object.assign(document.createElement("p"),{className:"account-empty",textContent:"No feedback submitted yet."}));
 }
 function tabs(name){["upcoming","history","feedback","profile"].forEach(t=>{const b=document.querySelector(`.account-tab[data-tab="${t}"]`),s=$("account-"+t);b?.classList.toggle("active",t===name);if(s)s.hidden=t!==name;});}
 async function saveProfile(e){e.preventDefault();const user=u();try{const r=await fetch("/api/customer/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:user.email,firstName:$("profile-first").value.trim(),lastName:$("profile-last").value.trim(),phone:$("profile-phone").value.trim()})});const d=await r.json().catch(()=>({}));if(!r.ok)return msg("profile-result",d.error||"Profile update failed.",true);window.SmartMoveDemo.update({firstName:$("profile-first").value,lastName:$("profile-last").value,phone:$("profile-phone").value});msg("profile-result","Profile saved successfully.");render();}catch(e){msg("profile-result","Cannot connect to server.",true);}}
 async function submitFeedback(e){e.preventDefault();const user=u(),trip=$("account-inline-trip")?.value;if(!rating)return msg("account-inline-message","Choose a rating.",true);const tripRecord=trip?(window.__smartMoveFeedbackTrips||[]).find(t=>t.TRIP_ID===trip):null;try{const r=await fetch("/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:user.userId,tripId:trip||null,vehicleId:tripRecord?.VEHICLE_ID||null,rating,comment:$("account-inline-comment").value.trim()})});const d=await r.json().catch(()=>({}));if(!r.ok)return msg("account-inline-message",d.error||"Feedback failed.",true);msg("account-inline-message","Feedback submitted successfully.");$("account-inline-comment").value="";rating=0;document.querySelectorAll(".inline-star-picker button").forEach(b=>b.textContent="☆");await load();}catch(e){msg("account-inline-message","Cannot connect to server.",true);}}
 document.addEventListener("DOMContentLoaded",async()=>{if(!u()){location.replace("../login.html?next=customer/my-bookings.html");return;}$("account-page").hidden=false;document.querySelectorAll(".account-tab").forEach(b=>b.addEventListener("click",()=>tabs(b.dataset.tab)));$("account-profile-form")?.addEventListener("submit",saveProfile);$("account-inline-feedback-form")?.addEventListener("submit",submitFeedback);document.querySelectorAll(".inline-star-picker button").forEach(b=>b.addEventListener("click",()=>{rating=Number(b.dataset.rating);document.querySelectorAll(".inline-star-picker button").forEach(x=>x.textContent=Number(x.dataset.rating)<=rating?"★":"☆");}));tabs(new URLSearchParams(location.search).get("tab")||"upcoming");await load();});
})();
