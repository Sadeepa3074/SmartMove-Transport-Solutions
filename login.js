"use strict";
document.addEventListener("DOMContentLoaded",()=>{
 const form=document.getElementById("unified-login-form"),msg=document.getElementById("unified-login-message");
 const params=new URLSearchParams(location.search); const next=params.get("next");
 const safeCustomerNext=new Set(["index.html","customer/index.html","customer/my-bookings.html","../index.html"]);
 form?.addEventListener("submit",async e=>{
  e.preventDefault(); msg.textContent="Checking your account...";
  const email=document.getElementById("unified-email").value.trim(),password=document.getElementById("unified-password").value;
  try{
   const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
   const d=await r.json().catch(()=>({})); if(!r.ok)throw Error(d.error||`Login failed (HTTP ${r.status}).`);
   const role=String(d.role||"").toUpperCase();
   if(role==="ADMIN"){
    if(!d.adminToken)throw Error("Administrator session could not be created.");
    sessionStorage.setItem("smartmove-admin-token-v1",d.adminToken);
    msg.style.color="#208b45";msg.textContent="Administrator verified. Opening dashboard...";
    location.replace("admin/index.html"); return;
   }
   if(role==="PASSENGER"){
    window.SmartMoveDemo?.begin({firstName:d.user?.FIRST_NAME,lastName:d.user?.LAST_NAME,email:d.user?.EMAIL||email,userId:d.user?.USER_ID,phone:d.user?.PHONE});
    msg.style.color="#208b45";msg.textContent="Passenger verified. Opening dashboard...";
    const destination=safeCustomerNext.has(next||"")?next:(next==="../index.html"?"index.html":"customer/index.html");
    location.replace(destination); return;
   }
   throw Error("This account is not configured for SmartMove access.");
  }catch(err){msg.style.color="#b3261e";msg.textContent=err.message;}
 });
});
