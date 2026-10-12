"use strict";
(function(){
 const $=id=>document.getElementById(id);
 async function load(){try{const r=await fetch("/api/admin/profile");const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);["first-name","last-name","email","phone"].forEach(k=>{const el=$("settings-"+k);if(el)el.value=d[k.toUpperCase()]||d[k.toLowerCase()]||"";});if($("settings-display-name"))$("settings-display-name").textContent=`${d.FIRST_NAME||d.first_name||""} ${d.LAST_NAME||d.last_name||""}`.trim();if($("settings-security-role"))$("settings-security-role").textContent=d.ROLE||d.role||"Administrator";}catch(e){console.error(e);show(e.message,true);}}
 function show(t,error=false){const el=$("settings-message");if(el){el.textContent=t;el.classList.toggle("error",error);}}
 async function save(e){e.preventDefault();const body={firstName:$("settings-first-name").value.trim(),lastName:$("settings-last-name").value.trim(),email:$("settings-email").value.trim(),phone:$("settings-phone").value.trim()};try{const r=await fetch("/api/admin/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);show("Profile saved successfully.");load();}catch(e){show(e.message,true);}}
 function setup(){if(!$("settings-page"))return;$("settings-profile-form")?.addEventListener("submit",save);load();}
 window.renderSettingsManagement=load;document.addEventListener("DOMContentLoaded",setup);
})();