"use strict";
document.addEventListener("DOMContentLoaded",()=>{
 const signupForm=document.getElementById("signup-form");
 if(!signupForm)return;
 const message=document.getElementById("signup-message");
 signupForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const firstName=document.getElementById("signup-first").value.trim(),lastName=document.getElementById("signup-last").value.trim(),email=document.getElementById("signup-email").value.trim(),phone=document.getElementById("signup-phone").value.trim(),password=document.getElementById("signup-password").value,confirm=document.getElementById("signup-confirm").value;
  if(password!==confirm){message.textContent="Passwords do not match.";return;}
  message.textContent="Creating your passenger account in Oracle...";
  try{
   const r=await fetch("/api/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({firstName,lastName,email,phone,password})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||`Registration failed (HTTP ${r.status}).`);
   window.SmartMoveDemo?.begin({firstName,lastName,email,phone,userId:d.user?.userId||d.user?.USER_ID||""});
   message.style.color="#208b45";message.textContent="Account created successfully. Opening your passenger dashboard...";
   const params=new URLSearchParams(location.search),next=params.get("next");
   setTimeout(()=>location.replace(next==="index.html"?"../index.html":"index.html"),300);
  }catch(err){message.style.color="#b04444";message.textContent=err.message;}
 });
 document.getElementById("preview-signup")?.addEventListener("click",()=>{message.textContent="Use Create Account to save a real passenger account in Oracle. No demo account is created by this button.";});
});
