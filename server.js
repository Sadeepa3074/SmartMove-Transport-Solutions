"use strict";
require("dotenv").config();
const express = require("express");
const oracledb = require("oracledb");
const { MongoClient } = require("mongodb");
const crypto = require("node:crypto");

const app = express();
const port = Number(process.env.PORT || 3000);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const oracleConfig = { user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD, connectionString: process.env.ORACLE_CONNECTION_STRING };
const adminSessions = new Map();
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
let mongoClient;
let mongoDb;

function makeId(prefix) { return prefix + crypto.randomBytes(5).toString("hex").toUpperCase(); }
function required(body, fields) { return fields.filter(k => body[k] === undefined || body[k] === null || String(body[k]).trim() === ""); }
function sendError(res, error, context) {
  console.error(`${context}:`, error);
  if (error.errorNum === 1) return res.status(409).json({ error: "A record with that unique value already exists." });
  if (error.errorNum === 2291) return res.status(400).json({ error: "A referenced record does not exist. Check the selected ID." });
  if (error.errorNum === 2292) return res.status(409).json({ error: "This record is still used by another record. Remove or update the related records first." });
  if (error.errorNum === 1400) return res.status(400).json({ error: "A required database value is missing." });
  if (error.errorNum === 12899) return res.status(400).json({ error: "One of the entered values is longer than the database field allows." });
  if (error.errorNum === 1722) return res.status(400).json({ error: "One of the numeric values is invalid." });
  if (error.errorNum === 2290) return res.status(400).json({ error: "One or more values violate a database rule." });
  return res.status(500).json({ error: `${context} failed. ${error.message || "Check the server log and database connection."}` });
}
async function withOracle(work) { const c = await oracledb.getConnection(oracleConfig); try { return await work(c); } finally { await c.close(); } }
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) { return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(`${salt}:${key.toString("hex")}`))); }
async function verifyPassword(password, stored) { if (!stored || !stored.includes(":")) return false; const [salt, keyHex] = stored.split(":"); const actual = await hashPassword(password, salt); const a = Buffer.from(actual.split(":")[1], "hex"), b = Buffer.from(keyHex, "hex"); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function normalizeStatus(v, fallback) { return String(v || fallback).trim(); }
function issueAdminSession(user) { const token = crypto.randomBytes(32).toString('hex'); adminSessions.set(token, { userId: user.USER_ID, email: user.EMAIL, expiresAt: Date.now() + ADMIN_SESSION_MS }); return token; }
function getAdminSession(req) { const token = String(req.get('x-admin-token') || '').trim(); const session = token ? adminSessions.get(token) : null; if (!session) return null; if (session.expiresAt <= Date.now()) { adminSessions.delete(token); return null; } return session; }
function requireAdmin(req, res, next) { const session = getAdminSession(req); if (!session) return res.status(401).json({ error: 'Administrator login is required.' }); req.adminSession = session; next(); }
function hasAdminSession(req) { return !!getAdminSession(req); }
function seatLabels(capacity) { const n = Math.max(0, Number(capacity) || 0); return Array.from({ length: n }, (_, i) => `${String.fromCharCode(65 + Math.floor(i / 10))}${(i % 10) + 1}`); }

app.get("/api/health", async (req, res) => { let oracle = "disconnected"; try { await withOracle(c => c.execute("SELECT 1 FROM DUAL")); oracle = "connected"; } catch (e) { console.error("Oracle health check:", e.message); } res.status(oracle === "connected" ? 200 : 503).json({ status: oracle === "connected" ? "UP" : "DEGRADED", oracle, mongodb: mongoDb ? "connected" : "disconnected", timestamp: new Date().toISOString() }); });

// Administrator authentication
app.post("/api/admin/auth/login", async (req,res)=>{
  const email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||"");
  if(!email||!password)return res.status(400).json({error:"Administrator email and password are required."});
  try{
    const r=await withOracle(c=>c.execute('SELECT u.user_id,u.first_name,u.last_name,u.email,u.phone,u.password_hash,a.role FROM Admin a JOIN "User" u ON u.user_id=a.user_id WHERE LOWER(u.email)=:email',{email},{outFormat:oracledb.OUT_FORMAT_OBJECT}));
    const admin=r.rows[0];
    if(!admin || !(await verifyPassword(password,admin.PASSWORD_HASH))) return res.status(401).json({error:"Administrator email or password is incorrect."});
    const token=issueAdminSession(admin);
    await withOracle(c=>c.execute('UPDATE Admin SET last_login=SYSTIMESTAMP WHERE user_id=:id',{id:admin.USER_ID},{autoCommit:true}));
    res.json({message:"Administrator login successful.",token,admin:{userId:admin.USER_ID,firstName:admin.FIRST_NAME,lastName:admin.LAST_NAME,email:admin.EMAIL,role:admin.ROLE}});
  }catch(e){sendError(res,e,"Administrator login");}
});
app.get("/api/admin/auth/session",requireAdmin,async(req,res)=>{
  try{const r=await withOracle(c=>c.execute('SELECT u.user_id,u.first_name,u.last_name,u.email,u.phone,a.role FROM Admin a JOIN "User" u ON u.user_id=a.user_id WHERE u.user_id=:id',{id:req.adminSession.userId},{outFormat:oracledb.OUT_FORMAT_OBJECT})); if(!r.rows.length)return res.status(401).json({error:"Administrator account no longer exists."}); res.json(r.rows[0]);}catch(e){sendError(res,e,"Check administrator session");}
});
app.post("/api/admin/auth/logout",(req,res)=>{const token=String(req.get('x-admin-token')||'').trim();if(token)adminSessions.delete(token);res.json({message:"Administrator logged out."});});

// Authentication / customer profile
app.post("/api/auth/signup", async (req, res) => {
  const missing = required(req.body || {}, ["firstName", "lastName", "email", "password"]); if (missing.length) return res.status(400).json({ error: `Required fields: ${missing.join(", ")}` });
  const firstName = String(req.body.firstName).trim(), lastName = String(req.body.lastName).trim(), email = String(req.body.email).trim().toLowerCase(), phone = String(req.body.phone || "").trim(), password = String(req.body.password);
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Password must contain at least 8 characters." });
  let c;
  try { c = await oracledb.getConnection(oracleConfig); const exists = await c.execute('SELECT user_id FROM "User" WHERE LOWER(email)=:email', { email }, { outFormat: oracledb.OUT_FORMAT_OBJECT }); if (exists.rows.length) return res.status(409).json({ error: "Email already registered. Please sign in." }); const userId = makeId("U"), passengerNo = makeId("PAS"), passwordHash = await hashPassword(password); await c.execute('INSERT INTO "User" (user_id,first_name,last_name,email,phone,password_hash) VALUES (:id,:first,:last,:email,:phone,:hash)', { id:userId, first:firstName, last:lastName, email, phone:phone||null, hash:passwordHash }); await c.execute("INSERT INTO Passenger (user_id,passenger_no,registration_date,passenger_status) VALUES (:id,:no,SYSDATE,'ACTIVE')", { id:userId, no:passengerNo }); await c.commit(); res.status(201).json({ message:"Registration successful.", user:{userId,firstName,lastName,email,phone} }); }
  catch(e) { if(c) try{await c.rollback()}catch(_){} sendError(res,e,"Signup"); } finally { if(c) try{await c.close()}catch(_){} }
});
app.post("/api/auth/login", async (req,res) => {
  const email=String(req.body.email||"").trim().toLowerCase(), password=String(req.body.password||"");
  if(!email||!password)return res.status(400).json({error:"Email and password are required."});
  try{
    const r=await withOracle(c=>c.execute(`SELECT u.user_id,u.first_name,u.last_name,u.email,u.phone,u.password_hash,
      p.passenger_status,a.role AS admin_role,
      CASE WHEN a.user_id IS NOT NULL THEN 'ADMIN' WHEN p.user_id IS NOT NULL THEN 'PASSENGER' ELSE 'USER' END AS account_role
      FROM "User" u LEFT JOIN Passenger p ON p.user_id=u.user_id LEFT JOIN Admin a ON a.user_id=u.user_id
      WHERE LOWER(u.email)=:email`,{email},{outFormat:oracledb.OUT_FORMAT_OBJECT}));
    const u=r.rows[0];
    if(!u||!(await verifyPassword(password,u.PASSWORD_HASH)))return res.status(401).json({error:"Email or password is incorrect."});
    const role=String(u.ACCOUNT_ROLE||"").toUpperCase();
    if(role==="USER") return res.status(403).json({error:"This account has no application role. Contact a SmartMove administrator."});
    let adminToken=null;
    if(role==="ADMIN"){
      adminToken=issueAdminSession(u);
      await withOracle(c=>c.execute('UPDATE Admin SET last_login=SYSTIMESTAMP WHERE user_id=:id',{id:u.USER_ID},{autoCommit:true}));
    }
    res.json({message:"Login successful.",role,user:{USER_ID:u.USER_ID,FIRST_NAME:u.FIRST_NAME,LAST_NAME:u.LAST_NAME,EMAIL:u.EMAIL,PHONE:u.PHONE,STATUS:u.PASSENGER_STATUS,ROLE:u.ADMIN_ROLE||role},adminToken});
  }catch(e){sendError(res,e,"Login");}
});
app.get("/api/customer/profile", async(req,res)=>{const email=String(req.query.email||"").trim().toLowerCase();if(!email)return res.status(400).json({error:"Email is required."});try{const r=await withOracle(c=>c.execute('SELECT u.user_id,u.first_name,u.last_name,u.email,u.phone,p.passenger_no,p.registration_date,p.passenger_status FROM "User" u JOIN Passenger p ON p.user_id=u.user_id WHERE LOWER(u.email)=:email',{email},{outFormat:oracledb.OUT_FORMAT_OBJECT}));if(!r.rows.length)return res.status(404).json({error:"Customer profile not found."});res.json(r.rows[0]);}catch(e){sendError(res,e,"Load customer profile");}});
app.put("/api/customer/profile", async(req,res)=>{const b=req.body||{}, email=String(b.email||"").trim().toLowerCase();if(!email||!b.firstName||!b.lastName)return res.status(400).json({error:"First name, last name and email are required."});try{const r=await withOracle(c=>c.execute('UPDATE "User" SET first_name=:first,last_name=:last,phone=:phone WHERE LOWER(email)=:email',{first:String(b.firstName).trim(),last:String(b.lastName).trim(),phone:String(b.phone||"").trim()||null,email},{autoCommit:true}));if(!r.rowsAffected)return res.status(404).json({error:"Customer profile not found."});res.json({message:"Profile updated successfully."});}catch(e){sendError(res,e,"Update customer profile");}});

// Vehicles CRUD
async function vehicleSelect(c, id) { const sql=`SELECT v.*,CASE WHEN b.vehicle_id IS NOT NULL THEN 'Bus' WHEN va.vehicle_id IS NOT NULL THEN 'Van' WHEN ov.vehicle_id IS NOT NULL THEN 'Other' ELSE 'Unclassified' END vehicle_type,b.bus_type,b.number_of_decks,va.van_type,va.passenger_capacity,ov.description,ov.category FROM Vehicle v LEFT JOIN Bus b ON b.vehicle_id=v.vehicle_id LEFT JOIN Van va ON va.vehicle_id=v.vehicle_id LEFT JOIN Other_Vehicle ov ON ov.vehicle_id=v.vehicle_id ${id?'WHERE v.vehicle_id=:id':''} ORDER BY v.vehicle_id`; return (await c.execute(sql,id?{id}:[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows; }
app.get("/api/vehicles",async(req,res)=>{try{res.json(await withOracle(c=>vehicleSelect(c)))}catch(e){sendError(res,e,"List vehicles");}});
app.post("/api/vehicles",requireAdmin,async(req,res)=>{const b=req.body||{},m=required(b,["registrationNumber","make","model","manufacturingYear","vehicleType","seatCapacity"]);if(m.length)return res.status(400).json({error:`Required fields: ${m.join(", ")}`});const year=Number(b.manufacturingYear),seats=Number(b.seatCapacity),type=String(b.vehicleType).toLowerCase();if(!Number.isInteger(year)||year<1950||year>new Date().getFullYear()+1||!Number.isInteger(seats)||seats<1||seats>999)return res.status(400).json({error:"Check manufacturing year and seat capacity."});if(!["bus","van","other"].includes(type))return res.status(400).json({error:"Vehicle type must be Bus, Van or Other."});let c;try{c=await oracledb.getConnection(oracleConfig);const id=b.vehicleId||makeId("V");await c.execute(`INSERT INTO Vehicle(vehicle_id,registration_number,make,model,manufacturing_year,seat_capacity,fuel_type,vehicle_status) VALUES(:id,:reg,:make,:model,:year,:seats,:fuel,:status)`,{id,reg:String(b.registrationNumber).trim().toUpperCase(),make:String(b.make).trim(),model:String(b.model).trim(),year,seats,fuel:b.fuelType||null,status:normalizeStatus(b.vehicleStatus,"Active")});if(type==="bus")await c.execute("INSERT INTO Bus(vehicle_id,bus_type,number_of_decks) VALUES(:id,:type,:decks)",{id,type:b.busType||"Standard",decks:Number(b.numberOfDecks||1)});if(type==="van")await c.execute("INSERT INTO Van(vehicle_id,van_type,passenger_capacity) VALUES(:id,:type,:cap)",{id,type:b.vanType||"Passenger",cap:seats});if(type==="other")await c.execute("INSERT INTO Other_Vehicle(vehicle_id,description,category) VALUES(:id,:description,:category)",{id,description:b.description||"Other vehicle",category:b.category||"Other"});await c.commit();res.status(201).json({message:"Vehicle created.",vehicleId:id});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Create vehicle");}finally{if(c)try{await c.close()}catch(_){}}});
app.put("/api/vehicles/:id",requireAdmin,async(req,res)=>{const b=req.body||{},id=req.params.id;const m=required(b,["registrationNumber","make","model","manufacturingYear","vehicleType","seatCapacity"]);if(m.length)return res.status(400).json({error:`Required fields: ${m.join(", ")}`});let c;try{c=await oracledb.getConnection(oracleConfig);const old=await vehicleSelect(c,id);if(!old.length)return res.status(404).json({error:"Vehicle not found."});await c.execute(`UPDATE Vehicle SET registration_number=:reg,make=:make,model=:model,manufacturing_year=:year,seat_capacity=:seats,fuel_type=:fuel,vehicle_status=:status WHERE vehicle_id=:id`,{id,reg:String(b.registrationNumber).trim().toUpperCase(),make:String(b.make).trim(),model:String(b.model).trim(),year:Number(b.manufacturingYear),seats:Number(b.seatCapacity),fuel:b.fuelType||null,status:normalizeStatus(b.vehicleStatus,"Active")});await c.execute("DELETE FROM Bus WHERE vehicle_id=:id",{id});await c.execute("DELETE FROM Van WHERE vehicle_id=:id",{id});await c.execute("DELETE FROM Other_Vehicle WHERE vehicle_id=:id",{id});const type=String(b.vehicleType).toLowerCase();if(type==="bus")await c.execute("INSERT INTO Bus(vehicle_id,bus_type,number_of_decks) VALUES(:id,:type,:decks)",{id,type:b.busType||"Standard",decks:Number(b.numberOfDecks||1)});else if(type==="van")await c.execute("INSERT INTO Van(vehicle_id,van_type,passenger_capacity) VALUES(:id,:type,:cap)",{id,type:b.vanType||"Passenger",cap:Number(b.seatCapacity)});else await c.execute("INSERT INTO Other_Vehicle(vehicle_id,description,category) VALUES(:id,:description,:category)",{id,description:b.description||"Other vehicle",category:b.category||"Other"});await c.commit();res.json({message:"Vehicle updated."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Update vehicle");}finally{if(c)try{await c.close()}catch(_){} }});
app.delete("/api/vehicles/:id",requireAdmin,async(req,res)=>{let c;try{c=await oracledb.getConnection(oracleConfig);const used=await c.execute("SELECT COUNT(*) N FROM Trip WHERE vehicle_id=:id UNION ALL SELECT COUNT(*) FROM Maintenance WHERE vehicle_id=:id",{id:req.params.id},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(used.rows.some(r=>Number(r.N)>0))return res.status(409).json({error:"Vehicle is used by trips or maintenance records. Set its status to Idle/Maintenance instead of deleting it."});await c.execute("DELETE FROM Bus WHERE vehicle_id=:id",{id:req.params.id});await c.execute("DELETE FROM Van WHERE vehicle_id=:id",{id:req.params.id});await c.execute("DELETE FROM Other_Vehicle WHERE vehicle_id=:id",{id:req.params.id});const r=await c.execute("DELETE FROM Vehicle WHERE vehicle_id=:id",{id:req.params.id});if(!r.rowsAffected)return res.status(404).json({error:"Vehicle not found."});await c.commit();res.json({message:"Vehicle deleted."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Delete vehicle");}finally{if(c)try{await c.close()}catch(_){} }});

// Drivers CRUD
app.get("/api/drivers",async(req,res)=>{try{const r=await withOracle(c=>c.execute(`SELECT u.user_id,u.first_name,u.last_name,u.email,u.phone,d.license_number,d.license_expiry,d.employment_status,d.employment_status availability FROM Driver d JOIN "User" u ON u.user_id=d.user_id ORDER BY u.last_name,u.first_name`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT}));res.json(r.rows)}catch(e){sendError(res,e,"List drivers");}});
app.post("/api/drivers",requireAdmin,async(req,res)=>{const b=req.body||{},m=required(b,["firstName","lastName","email","licenseNumber","licenseExpiry"]);if(m.length)return res.status(400).json({error:`Required fields: ${m.join(", ")}`});let c;try{c=await oracledb.getConnection(oracleConfig);const id=b.userId||makeId("D"),email=String(b.email).trim().toLowerCase();await c.execute('INSERT INTO "User"(user_id,first_name,last_name,email,phone) VALUES(:id,:first,:last,:email,:phone)',{id,first:String(b.firstName).trim(),last:String(b.lastName).trim(),email,phone:b.phone||null});await c.execute("INSERT INTO Driver(user_id,employment_status,license_number,license_expiry,hire_date) VALUES(:id,:status,:license,TO_DATE(:expiry,'YYYY-MM-DD'),SYSDATE)",{id,status:b.employmentStatus||"Active",license:String(b.licenseNumber).trim(),expiry:b.licenseExpiry});await c.commit();res.status(201).json({message:"Driver created.",userId:id});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Create driver");}finally{if(c)try{await c.close()}catch(_){} }});
app.put("/api/drivers/:id",requireAdmin,async(req,res)=>{const b=req.body||{},id=req.params.id,m=required(b,["firstName","lastName","email","licenseNumber","licenseExpiry"]);if(m.length)return res.status(400).json({error:`Required fields: ${m.join(", ")}`});let c;try{c=await oracledb.getConnection(oracleConfig);const r=await c.execute('UPDATE "User" SET first_name=:first,last_name=:last,email=:email,phone=:phone WHERE user_id=:id',{id,first:String(b.firstName).trim(),last:String(b.lastName).trim(),email:String(b.email).trim().toLowerCase(),phone:b.phone||null});if(!r.rowsAffected)return res.status(404).json({error:"Driver not found."});await c.execute("UPDATE Driver SET employment_status=:status,license_number=:license,license_expiry=TO_DATE(:expiry,'YYYY-MM-DD') WHERE user_id=:id",{id,status:b.employmentStatus||"Active",license:String(b.licenseNumber).trim(),expiry:b.licenseExpiry});await c.commit();res.json({message:"Driver updated."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Update driver");}finally{if(c)try{await c.close()}catch(_){} }});
app.delete("/api/drivers/:id",requireAdmin,async(req,res)=>{let c;try{c=await oracledb.getConnection(oracleConfig);const assigned=await c.execute("SELECT COUNT(*) N FROM Trip_Driver WHERE user_id=:id",{id:req.params.id},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(Number(assigned.rows[0].N)>0)return res.status(409).json({error:"Driver is assigned to a trip. Remove the trip assignment before deleting the driver."});await c.execute("DELETE FROM Driver WHERE user_id=:id",{id:req.params.id});const r=await c.execute('DELETE FROM "User" WHERE user_id=:id',{id:req.params.id});if(!r.rowsAffected)return res.status(404).json({error:"Driver not found."});await c.commit();res.json({message:"Driver deleted."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Delete driver");}finally{if(c)try{await c.close()}catch(_){} }});

// Routes CRUD
app.get("/api/routes",async(req,res)=>{try{res.json((await withOracle(c=>c.execute("SELECT * FROM Route ORDER BY route_name",[],{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows)}catch(e){sendError(res,e,"List routes");}});
app.post("/api/routes",requireAdmin,async(req,res)=>{
  const b=req.body||{},m=required(b,["routeId","routeName","startLoc","endLoc","distance","fare"]);
  if(m.length)return res.status(400).json({error:`Required fields: ${m.join(", ")}`});
  const id=String(b.routeId).trim().toUpperCase(),name=String(b.routeName).trim(),start=String(b.startLoc).trim(),end=String(b.endLoc).trim(),duration=String(b.duration??"").trim(),distance=Number(b.distance),fare=Number(b.fare),status=normalizeStatus(b.status,"Active").toUpperCase();
  if(!/^[-A-Z0-9_]+$/i.test(id)||id.length>20)return res.status(400).json({error:"Route ID must be 1-20 characters using letters, numbers, hyphens or underscores."});
  if(!name||name.length>100)return res.status(400).json({error:"Route name is required and must be 100 characters or fewer."});
  if(!start||start.length>100||!end||end.length>100)return res.status(400).json({error:"Start and destination must each be 100 characters or fewer."});
  if(duration.length>30)return res.status(400).json({error:"Duration must be 30 characters or fewer."});
  if(!Number.isFinite(distance)||distance<=0||distance>9999.99)return res.status(400).json({error:"Distance must be positive and within the database range."});
  if(!Number.isFinite(fare)||fare<0||fare>999999.99)return res.status(400).json({error:"Fare must be between 0 and 999999.99."});
  if(!["ACTIVE","INACTIVE"].includes(status))return res.status(400).json({error:"Route status must be Active or Inactive."});
  try{
    await withOracle(c=>c.execute(`INSERT INTO Route(route_id,route_name,start_loc,end_loc,distance,estimated_duration,fare,status) VALUES(:rid,:rname,:sloc,:eloc,:dist,:dur,:rfare,:rstatus)`,{rid:id,rname:name,sloc:start,eloc:end,dist:distance,dur:duration||"Not specified",rfare:fare,rstatus:status},{autoCommit:true}));
    res.status(201).json({message:"Route created and saved to Oracle.",routeId:id});
  }catch(e){sendError(res,e,"Create route");}
});
app.put("/api/routes/:id",requireAdmin,async(req,res)=>{
  const b=req.body||{},id=String(req.params.id||"").trim().toUpperCase(),name=String(b.routeName||"").trim(),start=String(b.startLoc||"").trim(),end=String(b.endLoc||"").trim(),duration=String(b.duration??"").trim(),distance=Number(b.distance),fare=Number(b.fare),status=normalizeStatus(b.status,"Active").toUpperCase();
  if(!id||!name||!start||!end)return res.status(400).json({error:"Route ID, name, start location and destination are required."});
  if(id.length>20||name.length>100||start.length>100||end.length>100||duration.length>30)return res.status(400).json({error:"One or more route fields exceed the database limits."});
  if(!Number.isFinite(distance)||distance<=0||distance>9999.99||!Number.isFinite(fare)||fare<0||fare>999999.99)return res.status(400).json({error:"Check the route distance and fare values."});
  if(!["ACTIVE","INACTIVE"].includes(status))return res.status(400).json({error:"Route status must be Active or Inactive."});
  try{const r=await withOracle(c=>c.execute(`UPDATE Route SET route_name=:rname,start_loc=:sloc,end_loc=:eloc,distance=:dist,estimated_duration=:dur,fare=:rfare,status=:rstatus WHERE route_id=:rid`,{rid:id,rname:name,sloc:start,eloc:end,dist:distance,dur:duration||"Not specified",rfare:fare,rstatus:status},{autoCommit:true}));if(!r.rowsAffected)return res.status(404).json({error:"Route not found."});res.json({message:"Route updated and saved to Oracle."});}catch(e){sendError(res,e,"Update route");}
});
app.delete("/api/routes/:id",requireAdmin,async(req,res)=>{try{const r=await withOracle(c=>c.execute("DELETE FROM Route WHERE route_id=:id",{id:req.params.id},{autoCommit:true}));if(!r.rowsAffected)return res.status(404).json({error:"Route not found."});res.json({message:"Route deleted."});}catch(e){sendError(res,e,"Delete route");}});

// Passenger management
app.get("/api/passengers",requireAdmin,async(req,res)=>{try{const q=String(req.query.q||"").trim().toLowerCase();const rows=(await withOracle(c=>c.execute(`SELECT p.user_id,p.passenger_no,p.passenger_status,p.passenger_type,p.registration_date,u.first_name,u.last_name,u.email,u.phone,u.address FROM Passenger p JOIN "User" u ON u.user_id=p.user_id ORDER BY u.first_name,u.last_name`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows;res.json(q?rows.filter(x=>`${x.PASSENGER_NO} ${x.FIRST_NAME} ${x.LAST_NAME} ${x.EMAIL} ${x.PHONE||""}`.toLowerCase().includes(q)):rows);}catch(e){sendError(res,e,"List passengers");}});
app.post("/api/passengers",requireAdmin,async(req,res)=>{const b=req.body||{};if(!b.firstName||!b.lastName||!b.email||!b.passengerNo)return res.status(400).json({error:"First name, last name, email and passenger number are required."});let c;try{c=await oracledb.getConnection(oracleConfig);const uid=b.userId||makeId("U");await c.execute(`INSERT INTO "User"(user_id,first_name,last_name,email,phone,address) VALUES(:uid,:fn,:ln,:email,:phone,:address)`,{uid,fn:String(b.firstName).trim(),ln:String(b.lastName).trim(),email:String(b.email).trim().toLowerCase(),phone:b.phone||null,address:b.address||null});await c.execute(`INSERT INTO Passenger(user_id,passenger_no,registration_date,passenger_status,passenger_type) VALUES(:uid,:pno,SYSDATE,:status,:ptype)`,{uid,pno:String(b.passengerNo).trim().toUpperCase(),status:String(b.status||"ACTIVE").toUpperCase(),ptype:String(b.passengerType||"daily commuter").trim()});await c.commit();res.status(201).json({message:"Passenger created.",userId:uid});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Create passenger");}finally{if(c)try{await c.close()}catch(_){} }});
app.put("/api/passengers/:id",requireAdmin,async(req,res)=>{const b=req.body||{};let c;try{c=await oracledb.getConnection(oracleConfig);const r=await c.execute(`UPDATE "User" SET first_name=:fn,last_name=:ln,email=:email,phone=:phone,address=:address WHERE user_id=:id`,{id:req.params.id,fn:String(b.firstName||"").trim(),ln:String(b.lastName||"").trim(),email:String(b.email||"").trim().toLowerCase(),phone:b.phone||null,address:b.address||null});if(!r.rowsAffected)return res.status(404).json({error:"Passenger not found."});await c.execute(`UPDATE Passenger SET passenger_no=:pno,passenger_status=:status,passenger_type=:ptype WHERE user_id=:id`,{id:req.params.id,pno:String(b.passengerNo||"").trim().toUpperCase(),status:String(b.status||"ACTIVE").toUpperCase(),ptype:String(b.passengerType||"daily commuter").trim()});await c.commit();res.json({message:"Passenger updated."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Update passenger");}finally{if(c)try{await c.close()}catch(_){} }});
app.patch("/api/passengers/:id/status",requireAdmin,async(req,res)=>{try{const status=String(req.body?.status||"").toUpperCase();if(!["ACTIVE","INACTIVE"].includes(status))return res.status(400).json({error:"Status must be ACTIVE or INACTIVE."});const r=await withOracle(c=>c.execute(`UPDATE Passenger SET passenger_status=:status WHERE user_id=:id`,{id:req.params.id,status},{autoCommit:true}));if(!r.rowsAffected)return res.status(404).json({error:"Passenger not found."});res.json({message:"Passenger status updated."});}catch(e){sendError(res,e,"Update passenger status");}});


// Administrator profile
app.get("/api/admin/profile", requireAdmin, async (req,res)=>{
  try{
    const r=await withOracle(c=>c.execute(`SELECT u.user_id,u.first_name,u.last_name,u.email,u.phone,a.role FROM Admin a JOIN "User" u ON u.user_id=a.user_id WHERE u.user_id=:id`,{id:req.adminSession.userId},{outFormat:oracledb.OUT_FORMAT_OBJECT}));
    if(!r.rows.length)return res.status(404).json({error:"Administrator profile not found."});
    res.json(r.rows[0]);
  }catch(e){sendError(res,e,"Load administrator profile");}
});
app.put("/api/admin/profile", requireAdmin, async(req,res)=>{
  const b=req.body||{};
  if(!b.firstName||!b.lastName||!b.email)return res.status(400).json({error:"First name, last name and email are required."});
  try{
    const r=await withOracle(c=>c.execute(`UPDATE "User" SET first_name=:first,last_name=:last,email=:email,phone=:phone WHERE user_id=:id`,{
      id:req.adminSession.userId,first:String(b.firstName).trim(),last:String(b.lastName).trim(),email:String(b.email).trim().toLowerCase(),phone:String(b.phone||"").trim()||null
    },{autoCommit:true}));
    if(!r.rowsAffected)return res.status(404).json({error:"Administrator profile not found."});
    req.adminSession.email=String(b.email).trim().toLowerCase();
    res.json({message:"Administrator profile saved successfully."});
  }catch(e){sendError(res,e,"Update administrator profile");}
});

// Maintenance management
app.get("/api/maintenance", requireAdmin, async(req,res)=>{
  try{
    const rows=(await withOracle(c=>c.execute(`SELECT m.maintenance_id,m.vehicle_id,m.service_date,m.type,m.description,m.cost,m.next_due_date,m.status,v.registration_number,v.make,v.model,v.vehicle_status FROM Maintenance m JOIN Vehicle v ON v.vehicle_id=m.vehicle_id ORDER BY m.next_due_date,m.service_date DESC`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows;
    res.json(rows);
  }catch(e){sendError(res,e,"List maintenance");}
});
app.post("/api/maintenance", requireAdmin, async(req,res)=>{
  const b=req.body||{};
  if(!b.vehicleId||!b.type||b.cost===undefined||b.cost===null||!b.nextDueDate)return res.status(400).json({error:"Vehicle, type, cost and next due date are required."});
  const cost=Number(b.cost); if(!Number.isFinite(cost)||cost<0)return res.status(400).json({error:"Maintenance cost must be a valid non-negative number."});
  const status=String(b.status||"PENDING").toUpperCase(); if(!["PENDING","SCHEDULED","COMPLETED"].includes(status))return res.status(400).json({error:"Invalid maintenance status."});
  let c;
  try{
    c=await oracledb.getConnection(oracleConfig);
    const v=await c.execute("SELECT vehicle_id,vehicle_status FROM Vehicle WHERE vehicle_id=:id",{id:String(b.vehicleId).trim()},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    if(!v.rows.length)return res.status(400).json({error:"Selected vehicle does not exist."});
    const id=b.maintenanceId||makeId("M");
    await c.execute(`INSERT INTO Maintenance(maintenance_id,service_date,vehicle_id,type,description,cost,next_due_date,status) VALUES(:id,SYSDATE,:vehicle,:type,:description,:cost,TO_DATE(:due,'YYYY-MM-DD'),:status)`,{id,vehicle:String(b.vehicleId).trim(),type:String(b.type).trim(),description:String(b.description||"").trim()||null,cost,due:String(b.nextDueDate).trim(),status});
    await c.commit();res.status(201).json({message:"Maintenance record saved to Oracle.",maintenanceId:id});
  }catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Create maintenance");}
  finally{if(c)try{await c.close()}catch(_){} }
});
app.put("/api/maintenance/:id", requireAdmin, async(req,res)=>{
  const b=req.body||{}, id=String(req.params.id).trim();
  if(!b.vehicleId||!b.type||b.cost===undefined||b.cost===null||!b.nextDueDate)return res.status(400).json({error:"Vehicle, type, cost and next due date are required."});
  const cost=Number(b.cost), status=String(b.status||"PENDING").toUpperCase();
  if(!Number.isFinite(cost)||cost<0)return res.status(400).json({error:"Maintenance cost must be a valid non-negative number."});
  if(!["PENDING","SCHEDULED","COMPLETED"].includes(status))return res.status(400).json({error:"Invalid maintenance status."});
  try{
    const r=await withOracle(c=>c.execute(`UPDATE Maintenance SET vehicle_id=:vehicle,type=:type,description=:description,cost=:cost,next_due_date=TO_DATE(:due,'YYYY-MM-DD'),status=:status WHERE maintenance_id=:id`,{id,vehicle:String(b.vehicleId).trim(),type:String(b.type).trim(),description:String(b.description||"").trim()||null,cost,due:String(b.nextDueDate).trim(),status},{autoCommit:true}));
    if(!r.rowsAffected)return res.status(404).json({error:"Maintenance record not found."});
    res.json({message:"Maintenance record updated."});
  }catch(e){sendError(res,e,"Update maintenance");}
});
app.delete("/api/maintenance/:id", requireAdmin, async(req,res)=>{
  try{
    const r=await withOracle(c=>c.execute("DELETE FROM Maintenance WHERE maintenance_id=:id",{id:req.params.id},{autoCommit:true}));
    if(!r.rowsAffected)return res.status(404).json({error:"Maintenance record not found."});
    res.json({message:"Maintenance record deleted."});
  }catch(e){sendError(res,e,"Delete maintenance");}
});

// Oracle feedback management. A selected trip must be an active booking owned by the passenger.
app.get("/api/feedback", async(req,res)=>{
  const userId=String(req.query.userId||"").trim();
  try{
    const sql=`SELECT f.feedback_id,f.user_id,f.trip_id,f.vehicle_id,f.rating,f.feedback_text feedback_comment,f.feedback_date,f.feedback_status,f.response feedback_response,
      u.first_name,u.last_name,u.email,t.departure_time,r.route_name,r.start_loc,r.end_loc,v.registration_number
      FROM Feedback f JOIN "User" u ON u.user_id=f.user_id
      LEFT JOIN Trip t ON t.trip_id=f.trip_id LEFT JOIN Route r ON r.route_id=t.route_id LEFT JOIN Vehicle v ON v.vehicle_id=f.vehicle_id
      ${userId?'WHERE f.user_id=:p_feedback_user_id':''} ORDER BY f.feedback_date DESC`;
    const binds=userId?{p_feedback_user_id:userId}:{};
    const rows=(await withOracle(c=>c.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows;
    res.json(rows);
  }catch(e){sendError(res,e,"List feedback");}
});
app.get("/api/feedback-options", async(req,res)=>{
  const userId=String(req.query.userId||"").trim();
  if(!userId)return res.json([]);
  try{
    const rows=(await withOracle(c=>c.execute(`SELECT DISTINCT t.trip_id,t.vehicle_id,t.departure_time,t.expected_arrival,t.trip_status,r.route_name,r.start_loc,r.end_loc,
        CASE WHEN UPPER(t.trip_status)='COMPLETED' OR t.expected_arrival<=SYSTIMESTAMP THEN 'AVAILABLE' ELSE 'BOOKED' END review_status
      FROM Booking b JOIN Trip t ON t.trip_id=b.trip_id JOIN Route r ON r.route_id=t.route_id
      WHERE b.user_id=:p_options_user_id
        AND UPPER(b.booking_status) IN ('CONFIRMED','PENDING','COMPLETED')
        AND UPPER(t.trip_status)<>'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM Feedback f WHERE f.user_id=b.user_id AND f.trip_id=b.trip_id)
      ORDER BY t.departure_time DESC`,{p_options_user_id:userId},{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows;
    res.json(rows);
  }catch(e){sendError(res,e,"Load feedback trip options");}
});
app.post("/api/feedback", async(req,res)=>{
  const b=req.body||{},userId=String(b.userId||"").trim(),tripId=String(b.tripId||"").trim()||null,rating=Number(b.rating),comment=String(b.comment||"").trim();
  if(!userId||!Number.isInteger(rating)||rating<1||rating>5||!comment)return res.status(400).json({error:"Passenger, rating (1-5) and comment are required."});
  let c;
  try{
    c=await oracledb.getConnection(oracleConfig);
    const p=await c.execute(`SELECT p.passenger_no,u.first_name||' '||u.last_name passenger_name,u.email FROM Passenger p JOIN "User" u ON u.user_id=p.user_id WHERE p.user_id=:p_feedback_user_id`,{p_feedback_user_id:userId},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    if(!p.rows.length)return res.status(400).json({error:"This account is not registered as a passenger."});
    let vehicleId=null,routeId=null,bookingId=null,driverId=null;
    if(tripId){
      const q=await c.execute(`SELECT b.booking_id,t.vehicle_id,t.route_id,t.driver_id FROM Booking b JOIN Trip t ON t.trip_id=b.trip_id WHERE b.user_id=:p_booking_user_id AND b.trip_id=:p_booking_trip_id AND UPPER(b.booking_status) IN ('CONFIRMED','PENDING','COMPLETED')`,{p_booking_user_id:userId,p_booking_trip_id:tripId},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      if(!q.rows.length)return res.status(400).json({error:"You can only review a trip that you currently have booked or have travelled on."});
      vehicleId=q.rows[0].VEHICLE_ID;routeId=q.rows[0].ROUTE_ID;bookingId=q.rows[0].BOOKING_ID;driverId=q.rows[0].DRIVER_ID;
      const dup=await c.execute(`SELECT COUNT(*) feedback_count FROM Feedback WHERE user_id=:p_duplicate_user_id AND trip_id=:p_duplicate_trip_id`,{p_duplicate_user_id:userId,p_duplicate_trip_id:tripId},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      if(Number(dup.rows[0].FEEDBACK_COUNT)>0)return res.status(409).json({error:"You have already submitted feedback for this trip."});
    }
    const fid=makeId("FB");
    await c.execute(`INSERT INTO Feedback(feedback_id,user_id,trip_id,vehicle_id,rating,feedback_text,feedback_date,feedback_status) VALUES(:p_feedback_id,:p_feedback_user_id,:p_feedback_trip_id,:p_feedback_vehicle_id,:p_feedback_rating,:p_feedback_text,SYSTIMESTAMP,'NEW')`,{p_feedback_id:fid,p_feedback_user_id:userId,p_feedback_trip_id:tripId,p_feedback_vehicle_id:vehicleId,p_feedback_rating:rating,p_feedback_text:comment});
    await c.commit();
    if(mongoDb){try{await mongoDb.collection("passenger_reviews").insertOne({review_id:fid,booking_id:bookingId,route_id:routeId,trip_id:tripId,passenger_id:userId,passenger_no:p.rows[0].PASSENGER_NO,passenger_name:p.rows[0].PASSENGER_NAME,email:p.rows[0].EMAIL,driver_id:driverId,vehicle_id:vehicleId,rating,comment,timestamp:new Date()});}catch(me){console.warn("MongoDB review sync failed:",me.message);}}
    res.status(201).json({message:"Feedback saved to Oracle and MongoDB.",feedbackId:fid});
  }catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Create feedback");}
  finally{if(c)try{await c.close()}catch(_){} }
});
app.patch("/api/feedback/:id", requireAdmin, async(req,res)=>{
  const status=String(req.body?.status||"").toUpperCase(), response=String(req.body?.response||"").trim()||null;
  if(!["NEW","VERIFIED","PUBLISHED","REJECTED"].includes(status))return res.status(400).json({error:"Invalid feedback status."});
  try{const r=await withOracle(c=>c.execute(`UPDATE Feedback SET feedback_status=:p_feedback_status,response=:p_feedback_response WHERE feedback_id=:p_feedback_id`,{p_feedback_id:req.params.id,p_feedback_status:status,p_feedback_response:response},{autoCommit:true}));if(!r.rowsAffected)return res.status(404).json({error:"Feedback record not found."});res.json({message:"Feedback updated."});}catch(e){sendError(res,e,"Update feedback");}
});

// Trips CRUD + customer search
async function getTrips() { return withOracle(async c=>{const r=await c.execute(`SELECT t.*,r.route_name,r.start_loc,r.end_loc,r.fare,v.registration_number,v.seat_capacity FROM Trip t JOIN Route r ON r.route_id=t.route_id LEFT JOIN Vehicle v ON v.vehicle_id=t.vehicle_id ORDER BY t.departure_time`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT});const bookings=(await c.execute("SELECT trip_id,seat_number,booking_status FROM Booking WHERE booking_status IN ('PENDING','CONFIRMED')",[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;const assignments=(await c.execute(`SELECT td.trip_id,td.user_id,u.first_name,u.last_name,td.assignment_role FROM Trip_Driver td JOIN Driver d ON d.user_id=td.user_id JOIN "User" u ON u.user_id=d.user_id ORDER BY td.trip_driver_id`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;const seatMap={},driverMap={};for(const b of bookings){if(!seatMap[b.TRIP_ID])seatMap[b.TRIP_ID]=[];seatMap[b.TRIP_ID].push(...String(b.SEAT_NUMBER||"").split(",").map(s=>s.trim()).filter(Boolean));}for(const a of assignments){if(!driverMap[a.TRIP_ID])driverMap[a.TRIP_ID]=[];driverMap[a.TRIP_ID].push(a);}return r.rows.map(t=>({...t,occupiedSeats:[...new Set(seatMap[t.TRIP_ID]||[])],seatLabels:seatLabels(t.SEAT_CAPACITY),driverAssignments:driverMap[t.TRIP_ID]||[],driverUserId:(driverMap[t.TRIP_ID]||[])[0]?.USER_ID||null,driverName:(driverMap[t.TRIP_ID]||[])[0]?`${driverMap[t.TRIP_ID][0].FIRST_NAME} ${driverMap[t.TRIP_ID][0].LAST_NAME}`:""}));}); }
async function syncTripDriver(c, tripId, driverId, dep, arr) { await c.execute("DELETE FROM Trip_Driver WHERE trip_id=:td_trip_id",{td_trip_id:tripId}); const did=String(driverId||"").trim(); if(!did){await c.execute(`UPDATE Trip SET driver_id=NULL WHERE trip_id=:tid`,{tid:tripId});return;} const dr=await c.execute("SELECT user_id FROM Driver WHERE user_id=:td_user_id",{td_user_id:did}); if(!dr.rows.length){const e=new Error("Selected driver does not exist.");e.errorNum=2291;throw e;} await c.execute(`INSERT INTO Trip_Driver(trip_driver_id,trip_id,user_id,assignment_role,assignment_start_time,assignment_end_time) VALUES(:td_id,:td_trip_id,:td_user_id,'Primary Driver',TO_TIMESTAMP(:td_dep,'YYYY-MM-DD"T"HH24:MI'),TO_TIMESTAMP(:td_arr,'YYYY-MM-DD"T"HH24:MI'))`,{td_id:makeId("TD"),td_trip_id:tripId,td_user_id:did,td_dep:dep,td_arr:arr}); await c.execute(`UPDATE Trip SET driver_id=:did WHERE trip_id=:tid`,{did,tid:tripId}); }
app.get("/api/trips",async(req,res)=>{try{let rows=await getTrips();const q=req.query;const from=String(q.from||"").trim().toLowerCase(),to=String(q.to||"").trim().toLowerCase(),date=String(q.date||"").trim();if(from)rows=rows.filter(t=>String(t.START_LOC||"").toLowerCase().includes(from));if(to)rows=rows.filter(t=>String(t.END_LOC||"").toLowerCase().includes(to));if(date)rows=rows.filter(t=>{const d=new Date(t.DEPARTURE_TIME);return !Number.isNaN(+d)&&`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`===date;});const needed=Number(q.passengers||0);if(needed)rows=rows.filter(t=>Number(t.AVAILABLE_SEATS||0)>=needed&&String(t.TRIP_STATUS||"").toUpperCase()==="SCHEDULED");res.json(rows);}catch(e){sendError(res,e,"List/search trips");}});
app.post("/api/trips",requireAdmin,async(req,res)=>{const b=req.body||{},m=required(b,["tripId","routeId","vehicleId","departureTime","expectedArrival"]);if(m.length)return res.status(400).json({error:`Required fields: ${m.join(", ")}`});const dep=String(b.departureTime).trim(),arr=String(b.expectedArrival).trim(),depDate=new Date(dep),arrDate=new Date(arr);if(Number.isNaN(+depDate)||Number.isNaN(+arrDate)||arrDate<=depDate)return res.status(400).json({error:"Arrival must be later than departure."});let c;try{c=await oracledb.getConnection(oracleConfig);const route=await c.execute("SELECT fare,status FROM Route WHERE route_id=:id",{id:String(b.routeId).trim()},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(!route.rows.length)return res.status(400).json({error:`Route ${b.routeId} was not found in the database.`});if(String(route.rows[0].STATUS||"").toUpperCase()!=="ACTIVE")return res.status(400).json({error:`Route ${b.routeId} is not active.`});const v=await c.execute("SELECT seat_capacity,vehicle_status FROM Vehicle WHERE vehicle_id=:id",{id:String(b.vehicleId).trim()},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(!v.rows.length)return res.status(400).json({error:`Vehicle ${b.vehicleId} was not found in the database.`});if(String(v.rows[0].VEHICLE_STATUS||"").toUpperCase()!=="ACTIVE")return res.status(400).json({error:`Vehicle ${b.vehicleId} is not active.`});const overlap=await c.execute(`SELECT COUNT(*) N FROM Trip WHERE vehicle_id=:id AND trip_status NOT IN ('CANCELLED','COMPLETED') AND departure_time < TO_TIMESTAMP(:arr,'YYYY-MM-DD"T"HH24:MI') AND expected_arrival > TO_TIMESTAMP(:dep,'YYYY-MM-DD"T"HH24:MI')`,{id:String(b.vehicleId).trim(),arr,dep},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(Number(overlap.rows[0].N)>0)return res.status(409).json({error:"Vehicle already has an overlapping trip."});const tripId=String(b.tripId).trim();await c.execute(`INSERT INTO Trip(trip_id,route_id,vehicle_id,driver_id,departure_time,expected_arrival,available_seats,trip_status) VALUES(:id,:route,:vehicle,:driver,TO_TIMESTAMP(:dep,'YYYY-MM-DD"T"HH24:MI'),TO_TIMESTAMP(:arr,'YYYY-MM-DD"T"HH24:MI'),:seats,:status)`,{id:tripId,route:String(b.routeId).trim(),vehicle:String(b.vehicleId).trim(),dep,arr,seats:Number(v.rows[0].SEAT_CAPACITY),driver:b.driverId||null,status:normalizeStatus(b.status,"Scheduled")});await syncTripDriver(c,tripId,b.driverId,dep,arr);await c.commit();res.status(201).json({message:"Trip scheduled.",tripId:String(b.tripId).trim()});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Create trip");}finally{if(c)try{await c.close()}catch(_){} }});
app.put("/api/trips/:id",requireAdmin,async(req,res)=>{const b=req.body||{},depDate=new Date(b.departureTime),arrDate=new Date(b.expectedArrival),dep=String(b.departureTime||"").trim(),arr=String(b.expectedArrival||"").trim();if(!b.routeId||!b.vehicleId||Number.isNaN(+depDate)||Number.isNaN(+arrDate)||arrDate<=depDate)return res.status(400).json({error:"Route, vehicle and valid departure/arrival times are required."});let c;try{c=await oracledb.getConnection(oracleConfig);const r=await c.execute(`UPDATE Trip SET route_id=:route,vehicle_id=:vehicle,departure_time=TO_TIMESTAMP(:dep,'YYYY-MM-DD"T"HH24:MI'),expected_arrival=TO_TIMESTAMP(:arr,'YYYY-MM-DD"T"HH24:MI'),trip_status=:status WHERE trip_id=:id`,{id:req.params.id,route:b.routeId,vehicle:b.vehicleId,dep,arr,status:normalizeStatus(b.status,"Scheduled")});if(!r.rowsAffected){await c.rollback();return res.status(404).json({error:"Trip not found."});}await syncTripDriver(c,req.params.id,b.driverId,dep,arr);await c.commit();res.json({message:"Trip and driver assignment updated."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Update trip");}finally{if(c)try{await c.close()}catch(_){} }});
app.delete("/api/trips/:id",requireAdmin,async(req,res)=>{try{const r=await withOracle(c=>c.execute("DELETE FROM Trip WHERE trip_id=:id",{id:req.params.id},{autoCommit:true}));if(!r.rowsAffected)return res.status(404).json({error:"Trip not found."});res.json({message:"Trip deleted."});}catch(e){sendError(res,e,"Delete trip");}});

// Booking management
app.get("/api/bookings/:id/tickets",async(req,res)=>{try{const rows=await withOracle(c=>c.execute(`SELECT ticket_id,booking_id,seat_number,fare,issue_date,ticket_status FROM Ticket WHERE booking_id=:id ORDER BY seat_number`,{id:req.params.id},{outFormat:oracledb.OUT_FORMAT_OBJECT}));res.json(rows.rows);}catch(e){sendError(res,e,"List tickets");}});
app.get("/api/customer-bookings",async(req,res)=>{try{const email=String(req.query.email||"").trim().toLowerCase();if(!email&&!hasAdminSession(req))return res.status(401).json({error:"Administrator login is required to view all bookings."});const sql=`SELECT b.booking_id,b.trip_id,b.user_id,b.booking_date,b.seat_number,b.ticket_fare,b.booking_status,b.tot_amount,u.first_name,u.last_name,u.email,r.route_name,r.start_loc,r.end_loc,t.departure_time,t.expected_arrival,t.vehicle_id,v.registration_number,p.payment_status FROM Booking b JOIN "User" u ON u.user_id=b.user_id JOIN Passenger pa ON pa.user_id=b.user_id JOIN Trip t ON t.trip_id=b.trip_id JOIN Route r ON r.route_id=t.route_id LEFT JOIN Vehicle v ON v.vehicle_id=t.vehicle_id LEFT JOIN Payment p ON p.booking_id=b.booking_id ${email?'WHERE LOWER(u.email)=:email':''} ORDER BY b.booking_date DESC`;res.json((await withOracle(c=>c.execute(sql,email?{email}:[],{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows);}catch(e){sendError(res,e,"List bookings");}});
app.post("/api/bookings",async(req,res)=>{
  const b=req.body||{},seats=Array.isArray(b.seats)?b.seats.map(s=>String(s).trim().toUpperCase()).filter(Boolean):String(b.seats||"").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean),email=String(b.email||"").trim().toLowerCase();
  if(!b.tripId||!email||!seats.length)return res.status(400).json({error:"Trip, passenger email and at least one seat are required."});
  if(new Set(seats).size!==seats.length)return res.status(400).json({error:"The same seat was selected more than once."});
  const seatText=seats.join(",");
  if(seatText.length>100)return res.status(400).json({error:"Too many selected seats for one booking record."});
  let c;
  try{
    c=await oracledb.getConnection(oracleConfig);
    const tr=await c.execute("SELECT trip_id,route_id,vehicle_id,available_seats,trip_status FROM Trip WHERE trip_id=:id FOR UPDATE",{id:String(b.tripId).trim()},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    if(!tr.rows.length)return res.status(404).json({error:"Trip not found."});
    const t=tr.rows[0],tripStatus=String(t.TRIP_STATUS||"").toUpperCase();
    if(!["SCHEDULED","ACTIVE"].includes(tripStatus))return res.status(400).json({error:"This trip is not open for booking."});
    const v=await c.execute("SELECT seat_capacity,vehicle_status FROM Vehicle WHERE vehicle_id=:id",{id:t.VEHICLE_ID},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    if(!v.rows.length)return res.status(400).json({error:"The vehicle assigned to this trip no longer exists."});
    const valid=new Set(seatLabels(v.rows[0].SEAT_CAPACITY)),bad=seats.find(s=>!valid.has(s));
    if(bad)return res.status(400).json({error:`Seat ${bad} is not valid for this vehicle.`});
    if(Number(t.AVAILABLE_SEATS)<seats.length)return res.status(409).json({error:"Not enough seats are available."});
    const existing=await c.execute("SELECT seat_number FROM Booking WHERE trip_id=:id AND booking_status IN ('PENDING','CONFIRMED')",{id:b.tripId},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    const occupied=new Set(existing.rows.flatMap(r=>String(r.SEAT_NUMBER||"").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean))),conflict=seats.find(s=>occupied.has(s));
    if(conflict)return res.status(409).json({error:`Seat ${conflict} is already booked. Please choose another seat.`});
    const u=await c.execute('SELECT user_id FROM "User" WHERE LOWER(email)=:email',{email},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    if(!u.rows.length)return res.status(400).json({error:"Please register and log in before booking."});
    const userId=u.rows[0].USER_ID,p=await c.execute("SELECT user_id FROM Passenger WHERE user_id=:id",{id:userId});
    if(!p.rows.length)return res.status(400).json({error:"This account is not registered as a passenger."});
    const fare=await c.execute("SELECT fare FROM Route WHERE route_id=:id",{id:t.ROUTE_ID},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    if(!fare.rows.length)return res.status(400).json({error:"The route assigned to this trip no longer exists."});
    const farePerSeat=Number(fare.rows[0].FARE||0),amount=Math.round(farePerSeat*seats.length*100)/100;
    if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"The route has no valid fare configured."});
    const bookingId=makeId("BK"),paymentId=makeId("PAY"),transactionReference=makeId("SIM");
    await c.execute("INSERT INTO Booking(booking_id,trip_id,user_id,seat_number,ticket_fare,booking_status,tot_amount) VALUES(:bk_id,:bk_trip_id,:bk_user_id,:bk_seats,:bk_fare,'CONFIRMED',:bk_amount)",{bk_id:bookingId,bk_trip_id:b.tripId,bk_user_id:userId,bk_seats:seatText,bk_fare:farePerSeat,bk_amount:amount});
    for(const seat of seats){ await c.execute("INSERT INTO Ticket(ticket_id,booking_id,seat_number,fare,ticket_status) VALUES(:tk,:bk,:seat,:fare,'ISSUED')",{tk:makeId("TK"),bk:bookingId,seat,fare:farePerSeat}); }
    await c.execute("INSERT INTO Payment(payment_id,booking_id,amount,payment_method,payment_status,transaction_reference) VALUES(:pay_id,:pay_booking_id,:pay_amount,:pay_method,'COMPLETED',:pay_ref)",{pay_id:paymentId,pay_booking_id:bookingId,pay_amount:amount,pay_method:String(b.paymentMethod||"COURSEWORK_SIMULATION").slice(0,30),pay_ref:transactionReference});
    await c.commit();
    res.status(201).json({message:"Booking confirmed and payment record saved to Oracle.",bookingId,paymentId,status:"CONFIRMED",amount});
  }catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Create booking/payment");}finally{if(c)try{await c.close()}catch(_){} }
});
app.patch("/api/bookings/:id",async(req,res)=>{const status=String(req.body?.status||"").toUpperCase();if(!["CONFIRMED","PENDING","CANCELLED"].includes(status))return res.status(400).json({error:"Booking status must be CONFIRMED, PENDING or CANCELLED."});let c;try{c=await oracledb.getConnection(oracleConfig);const b=await c.execute(`SELECT booking_id,trip_id,user_id,seat_number,booking_status FROM Booking WHERE booking_id=:id FOR UPDATE`,{id:req.params.id},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(!b.rows.length)return res.status(404).json({error:"Booking not found."});const old=b.rows[0];if(status!=="CANCELLED"||String(old.BOOKING_STATUS).toUpperCase()==="CANCELLED"){if(!hasAdminSession(req)){const u=await c.execute(`SELECT email FROM "User" WHERE user_id=:id`,{id:old.USER_ID},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(!u.rows.length||String(req.body.email||"").toLowerCase()!==String(u.rows[0].EMAIL).toLowerCase())return res.status(403).json({error:"You can only cancel your own booking."});}await c.execute(`UPDATE Booking SET booking_status=:status WHERE booking_id=:id`,{status,id:req.params.id});await c.commit();return res.json({message:"Booking status updated."});}if(!hasAdminSession(req)){const u=await c.execute(`SELECT email FROM "User" WHERE user_id=:id`,{id:old.USER_ID},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(!u.rows.length||String(req.body.email||"").toLowerCase()!==String(u.rows[0].EMAIL).toLowerCase())return res.status(403).json({error:"You can only cancel your own booking."});}await c.execute(`UPDATE Booking SET booking_status='CANCELLED' WHERE booking_id=:id`,{id:req.params.id});await c.execute(`UPDATE Ticket SET ticket_status='CANCELLED' WHERE booking_id=:id`,{id:req.params.id});await c.execute(`UPDATE Payment SET payment_status='REFUNDED' WHERE booking_id=:id AND UPPER(payment_status) IN ('COMPLETED','PAID')`,{id:req.params.id});await c.commit();res.json({message:"Booking cancelled. Seats returned, tickets cancelled and payment marked REFUNDED."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Update booking");}finally{if(c)try{await c.close()}catch(_){} }});
app.delete("/api/bookings/:id",requireAdmin,async(req,res)=>{let c;try{c=await oracledb.getConnection(oracleConfig);const b=await c.execute(`SELECT booking_id FROM Booking WHERE booking_id=:id FOR UPDATE`,{id:req.params.id},{outFormat:oracledb.OUT_FORMAT_OBJECT});if(!b.rows.length)return res.status(404).json({error:"Booking not found."});await c.execute(`UPDATE Ticket SET ticket_status='CANCELLED' WHERE booking_id=:id AND UPPER(ticket_status)='ISSUED'`,{id:req.params.id});await c.execute(`UPDATE Booking SET booking_status='CANCELLED' WHERE booking_id=:id`,{id:req.params.id});await c.execute(`UPDATE Payment SET payment_status='REFUNDED' WHERE booking_id=:id AND UPPER(payment_status) IN ('COMPLETED','PAID')`,{id:req.params.id});await c.commit();res.json({message:"Booking cancelled; tickets cancelled and payment refunded."});}catch(e){if(c)try{await c.rollback()}catch(_){}sendError(res,e,"Cancel booking");}finally{if(c)try{await c.close()}catch(_){} }});

// Payments
app.get("/api/payments",async(req,res)=>{try{res.json((await withOracle(c=>c.execute(`SELECT p.*,b.booking_date,u.first_name,u.last_name FROM Payment p JOIN Booking b ON b.booking_id=p.booking_id JOIN "User" u ON u.user_id=b.user_id ORDER BY b.booking_date DESC`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows)}catch(e){sendError(res,e,"List payments");}});
app.post("/api/payments",requireAdmin,async(req,res)=>{const b=req.body||{};if(!b.bookingId||!Number.isFinite(Number(b.amount))||Number(b.amount)<=0)return res.status(400).json({error:"Valid bookingId and positive amount are required."});try{const id=b.paymentId||makeId("PAY");await withOracle(c=>c.execute("INSERT INTO Payment(payment_id,booking_id,amount,payment_method,payment_status,transaction_reference) VALUES(:pay_id,:pay_booking_id,:pay_amount,:pay_method,:pay_status,:pay_ref)",{pay_id:id,pay_booking_id:b.bookingId,pay_amount:Number(b.amount),pay_method:b.paymentMethod||"COURSEWORK_SIMULATION",pay_status:b.paymentStatus||"COMPLETED",pay_ref:b.transactionReference||makeId("SIM")},{autoCommit:true}));res.status(201).json({message:"Payment created.",paymentId:id});}catch(e){sendError(res,e,"Create payment");}});

// MongoDB optional coursework features

// PL/SQL business reports exposed to the Admin Reports page.
async function reportPackageAvailable(c){const r=await c.execute(`SELECT COUNT(*) AS package_count FROM user_objects WHERE object_name='SMARTMOVE_REPORTS_PKG' AND object_type IN ('PACKAGE','PACKAGE BODY') AND status='VALID'`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT});return Number(r.rows[0]?.PACKAGE_COUNT||0)>=2;}
app.get("/api/homepage",async(req,res)=>{
  try{
    const data=await withOracle(async c=>{
      const stats=(await c.execute(`SELECT
        (SELECT COUNT(*) FROM Vehicle) total_vehicles,
        (SELECT COUNT(*) FROM Route WHERE UPPER(status)='ACTIVE') active_routes,
        (SELECT COUNT(*) FROM Trip WHERE TRUNC(CAST(departure_time AS DATE))=TRUNC(SYSDATE) AND UPPER(trip_status) NOT IN ('CANCELLED','COMPLETED')) today_trips,
        (SELECT COUNT(*) FROM Feedback) feedback_count FROM dual`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0]||{};
      const routes=(await c.execute(`SELECT r.route_id,r.route_name,r.start_loc,r.end_loc,r.distance,r.estimated_duration,r.fare,
        NVL((SELECT COUNT(*) FROM Booking b JOIN Trip t2 ON t2.trip_id=b.trip_id WHERE t2.route_id=r.route_id AND TRUNC(CAST(t2.departure_time AS DATE))=TRUNC(SYSDATE) AND UPPER(b.booking_status) IN ('CONFIRMED','PENDING')),0) booking_count
        FROM Route r WHERE UPPER(r.status)='ACTIVE' ORDER BY booking_count DESC,r.route_name FETCH FIRST 6 ROWS ONLY`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
      const feedback=(await c.execute(`SELECT * FROM (SELECT f.feedback_id,f.rating,f.feedback_text AS feedback_comment,f.feedback_date,
        u.first_name,u.last_name,r.route_name FROM Feedback f JOIN "User" u ON u.user_id=f.user_id
        LEFT JOIN Trip t ON t.trip_id=f.trip_id LEFT JOIN Route r ON r.route_id=t.route_id
        WHERE UPPER(f.feedback_status) IN ('PUBLISHED','VERIFIED') ORDER BY f.feedback_date DESC) WHERE ROWNUM<=6`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
      return {stats,routes,feedback};
    });
    let announcements=[];
    if(mongoDb){
      announcements=await mongoDb.collection('travel_announcements').find({}).sort({publish_date:-1}).limit(6).toArray();
    }
    res.json({...data,announcements});
  }catch(e){sendError(res,e,'Load homepage live data');}
});
app.get("/api/report-options",requireAdmin,async(req,res)=>{try{const data=await withOracle(async c=>({passengers:(await c.execute(`SELECT p.passenger_no,u.user_id,u.first_name||' '||u.last_name passenger_name,u.email FROM Passenger p JOIN "User" u ON u.user_id=p.user_id ORDER BY u.first_name,u.last_name`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows,drivers:(await c.execute(`SELECT d.user_id,u.first_name||' '||u.last_name driver_name,d.license_number FROM Driver d JOIN "User" u ON u.user_id=d.user_id ORDER BY u.first_name,u.last_name`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows,vehicles:(await c.execute(`SELECT vehicle_id,registration_number,make,model,seat_capacity,vehicle_status FROM Vehicle ORDER BY registration_number`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows,trips:(await c.execute(`SELECT t.trip_id,r.route_name,t.departure_time,t.trip_status,t.vehicle_id FROM Trip t JOIN Route r ON r.route_id=t.route_id ORDER BY t.departure_time DESC`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows}));res.json(data);}catch(e){sendError(res,e,"Load report options");}});
async function cursorRows(c,sql,bind){const x=await c.execute(sql,bind,{outFormat:oracledb.OUT_FORMAT_OBJECT});return x.rows;}
app.get("/api/reports/revenue-summary",requireAdmin,async(req,res)=>{try{const a=String(req.query.start||""),b=String(req.query.end||"");const rows=await withOracle(c=>cursorRows(c,`SELECT NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' THEN p.amount ELSE 0 END),0) total_paid,COUNT(CASE WHEN UPPER(p.payment_status)='COMPLETED' THEN 1 END) payment_count,NVL(SUM(CASE WHEN UPPER(p.payment_status)='REFUNDED' THEN p.amount ELSE 0 END),0) total_refunds,NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' THEN p.amount ELSE -p.amount END),0) net_revenue,NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' AND UPPER(p.payment_method)='CARD' THEN p.amount ELSE 0 END),0) card_revenue,NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' AND UPPER(p.payment_method)='ONLINE' THEN p.amount ELSE 0 END),0) online_revenue FROM Payment p WHERE p.payment_date>=TO_DATE(:a,'YYYY-MM-DD') AND p.payment_date<TO_DATE(:b,'YYYY-MM-DD')+1`,{a,b}));res.json(rows[0]||{});}catch(e){sendError(res,e,"Revenue summary report");}});
app.get("/api/reports/driver-schedule",requireAdmin,async(req,res)=>{try{const a=String(req.query.start||""),b=String(req.query.end||""),driver=String(req.query.driver||"");const rows=await withOracle(c=>cursorRows(c,`SELECT d.user_id driver_id,u.first_name||' '||u.last_name driver_name,t.trip_id,r.route_name,r.start_loc||' → '||r.end_loc route,v.registration_number,t.departure_time,t.expected_arrival,t.trip_status,ROUND((CAST(t.expected_arrival AS DATE)-CAST(t.departure_time AS DATE))*24,2) hours FROM Driver d JOIN "User" u ON u.user_id=d.user_id JOIN Trip t ON t.driver_id=d.user_id JOIN Route r ON r.route_id=t.route_id JOIN Vehicle v ON v.vehicle_id=t.vehicle_id WHERE t.departure_time>=TO_TIMESTAMP(:a,'YYYY-MM-DD') AND t.departure_time<TO_TIMESTAMP(:b,'YYYY-MM-DD')+INTERVAL '1' DAY AND (:driver IS NULL OR d.user_id=:driver) ORDER BY u.last_name,t.departure_time`,{a,b,driver:driver||null}));res.json(rows);}catch(e){sendError(res,e,"Driver schedule report");}});
app.get("/api/reports/monthly-operations",requireAdmin,async(req,res)=>{try{const m=Number(req.query.month),y=Number(req.query.year);if(!Number.isInteger(m)||m<1||m>12||!Number.isInteger(y))return res.status(400).json({error:"Valid month and year are required."});const rows=await withOracle(c=>cursorRows(c,`SELECT (SELECT COUNT(*) FROM Booking WHERE booking_date>=TO_DATE(:d,'YYYY-MM-DD') AND booking_date<ADD_MONTHS(TO_DATE(:d,'YYYY-MM-DD'),1)) bookings,(SELECT COUNT(*) FROM Ticket WHERE issue_date>=TO_TIMESTAMP(:d,'YYYY-MM-DD') AND issue_date<ADD_MONTHS(TO_TIMESTAMP(:d,'YYYY-MM-DD'),1) AND UPPER(ticket_status)='ISSUED') tickets_issued,(SELECT COUNT(DISTINCT user_id) FROM Booking WHERE booking_date>=TO_DATE(:d,'YYYY-MM-DD') AND booking_date<ADD_MONTHS(TO_DATE(:d,'YYYY-MM-DD'),1) AND UPPER(booking_status)='CONFIRMED') passengers_travelled,(SELECT COUNT(*) FROM Trip WHERE departure_time>=TO_TIMESTAMP(:d,'YYYY-MM-DD') AND departure_time<ADD_MONTHS(TO_TIMESTAMP(:d,'YYYY-MM-DD'),1) AND UPPER(trip_status)<>'CANCELLED') trips_run,(SELECT COUNT(*) FROM Trip WHERE departure_time>=TO_TIMESTAMP(:d,'YYYY-MM-DD') AND departure_time<ADD_MONTHS(TO_TIMESTAMP(:d,'YYYY-MM-DD'),1) AND UPPER(trip_status)='CANCELLED') trips_cancelled,(SELECT NVL(SUM(amount),0) FROM Payment WHERE payment_date>=TO_TIMESTAMP(:d,'YYYY-MM-DD') AND payment_date<ADD_MONTHS(TO_TIMESTAMP(:d,'YYYY-MM-DD'),1) AND UPPER(payment_status)='COMPLETED') revenue,(SELECT COUNT(*) FROM Passenger WHERE registration_date>=TO_DATE(:d,'YYYY-MM-DD') AND registration_date<ADD_MONTHS(TO_DATE(:d,'YYYY-MM-DD'),1)) new_passengers FROM dual`,{d:`${y}-${String(m).padStart(2,'0')}-01`}));res.json(rows[0]||{});}catch(e){sendError(res,e,"Monthly operations report");}});
app.get("/api/reports/frequent-routes",requireAdmin,async(req,res)=>{try{const a=String(req.query.start||""),b=String(req.query.end||""),n=Math.max(1,Math.min(50,Number(req.query.topN)||10));const rows=await withOracle(c=>cursorRows(c,`SELECT * FROM (SELECT r.route_id,r.route_name,COUNT(DISTINCT b.booking_id) bookings,COUNT(k.ticket_id) tickets_sold,NVL(SUM(CASE WHEN UPPER(pay.payment_status)='COMPLETED' THEN pay.amount ELSE 0 END),0) revenue FROM Route r LEFT JOIN Trip t ON t.route_id=r.route_id AND t.departure_time>=TO_TIMESTAMP(:a,'YYYY-MM-DD') AND t.departure_time<TO_TIMESTAMP(:b,'YYYY-MM-DD')+INTERVAL '1' DAY LEFT JOIN Booking b ON b.trip_id=t.trip_id AND UPPER(b.booking_status)='CONFIRMED' LEFT JOIN Ticket k ON k.booking_id=b.booking_id AND UPPER(k.ticket_status)='ISSUED' LEFT JOIN Payment pay ON pay.booking_id=b.booking_id GROUP BY r.route_id,r.route_name ORDER BY bookings DESC,tickets_sold DESC,r.route_name) WHERE ROWNUM<=:n`,{a,b,n}));res.json(rows);}catch(e){sendError(res,e,"Frequent routes report");}});
app.get("/api/reports/maintenance-due",requireAdmin,async(req,res)=>{try{const days=Math.max(0,Math.min(3650,Number(req.query.days)||30));const rows=await withOracle(c=>cursorRows(c,`SELECT v.vehicle_id,v.registration_number,v.make||' '||v.model vehicle,MAX(m.service_date) last_service_date,m.next_due_date,TRUNC(m.next_due_date)-TRUNC(SYSDATE) days_remaining,v.vehicle_status current_status,m.status,m.cost FROM Vehicle v JOIN Maintenance m ON m.vehicle_id=v.vehicle_id WHERE m.next_due_date<=TRUNC(SYSDATE)+:days AND UPPER(m.status)<>'COMPLETED' GROUP BY v.vehicle_id,v.registration_number,v.make,v.model,m.next_due_date,v.vehicle_status,m.status,m.cost ORDER BY m.next_due_date`,{days}));res.json(rows);}catch(e){sendError(res,e,"Maintenance due report");}});
app.get("/api/reports/passenger-history",requireAdmin,async(req,res)=>{try{const no=String(req.query.passengerNo||"").trim();if(!no)return res.status(400).json({error:"Select a passenger."});res.json(await withOracle(c=>cursorRows(c,`SELECT p.passenger_no,u.first_name||' '||u.last_name passenger_name,b.booking_id,r.route_name,t.departure_time,b.seat_number,b.booking_status,b.tot_amount FROM Passenger p JOIN "User" u ON u.user_id=p.user_id LEFT JOIN Booking b ON b.user_id=p.user_id LEFT JOIN Trip t ON t.trip_id=b.trip_id LEFT JOIN Route r ON r.route_id=t.route_id WHERE UPPER(p.passenger_no)=UPPER(:no) ORDER BY t.departure_time DESC NULLS LAST`,{no})));}catch(e){sendError(res,e,"Passenger history report");}});

app.get("/api/reviews",async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});try{const passengerId=String(req.query.passengerId||"").trim();const passengerNo=String(req.query.passengerNo||"").trim();const filter=passengerId||passengerNo?{$or:[...(passengerId?[{passenger_id:passengerId}]:[]),...(passengerNo?[{passenger_no:passengerNo}]:[])]}:{};res.json(await mongoDb.collection("passenger_reviews").find(filter).sort({timestamp:-1}).toArray());}catch(e){sendError(res,e,"List passenger reviews");}});
app.get("/api/reviews/:routeId",async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});try{res.json(await mongoDb.collection("passenger_reviews").find({route_id:req.params.routeId}).sort({timestamp:-1}).toArray());}catch(e){sendError(res,e,"List reviews");}});
app.post("/api/reviews",async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});const b=req.body||{},rating=Number(b.rating);if(!b.routeId||!Number.isInteger(rating)||rating<1||rating>5||!String(b.comment||"").trim())return res.status(400).json({error:"Route, rating 1-5 and comment are required."});try{const r=await mongoDb.collection("passenger_reviews").insertOne({booking_id:b.bookingId||null,route_id:String(b.routeId),passenger_id:b.userId||null,passenger_no:b.passengerNo||null,passenger_name:String(b.passengerName||"Passenger"),email:b.email||null,rating,comment:String(b.comment).trim(),timestamp:new Date()});res.status(201).json({message:"Review saved.",reviewId:r.insertedId});}catch(e){sendError(res,e,"Create review");}});
app.get("/api/announcements",async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});try{res.json(await mongoDb.collection("travel_announcements").find({}).sort({publish_date:-1}).toArray());}catch(e){sendError(res,e,"List announcements");}});
app.post("/api/announcements",requireAdmin,async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});const b=req.body||{};if(!b.title||!b.content)return res.status(400).json({error:"Title and content are required."});try{const r=await mongoDb.collection("travel_announcements").insertOne({announcement_id:b.announcementId||makeId("A"),title:String(b.title).trim(),content:String(b.content).trim(),target_audience:b.targetAudience||"All Commuters",publish_date:new Date()});res.status(201).json({message:"Announcement created.",id:r.insertedId});}catch(e){sendError(res,e,"Create announcement");}});
app.get("/api/vehicles/:id/multimedia",async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});try{const d=await mongoDb.collection("vehicle_multimedia").findOne({vehicle_id:req.params.id});res.json(d||{vehicle_id:req.params.id,document_type:null,file_url:null,multimedia_content:[],uploaded_date:null});}catch(e){sendError(res,e,"Vehicle multimedia");}});
app.post("/api/vehicles/:id/multimedia",requireAdmin,async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});try{await mongoDb.collection("vehicle_multimedia").updateOne({vehicle_id:req.params.id},{$set:{vehicle_id:req.params.id,document_type:req.body.documentType||"Other",file_url:req.body.fileUrl||null,multimedia_content:Array.isArray(req.body.multimediaContent)?req.body.multimediaContent:[],uploaded_date:new Date()}},{upsert:true});res.status(201).json({message:"Vehicle multimedia saved."});}catch(e){sendError(res,e,"Save vehicle multimedia");}});
app.get("/api/trips/:id/multimedia",async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});try{res.json(await mongoDb.collection("trip_multimedia").find({trip_id:req.params.id}).toArray());}catch(e){sendError(res,e,"Trip multimedia");}});
app.post("/api/trips/:id/multimedia",requireAdmin,async(req,res)=>{if(!mongoDb)return res.status(503).json({error:"MongoDB is not connected."});if(!req.body.url||!req.body.type)return res.status(400).json({error:"Media type and URL are required."});try{const r=await mongoDb.collection("trip_multimedia").insertOne({trip_id:req.params.id,type:String(req.body.type),url:String(req.body.url),caption:String(req.body.caption||""),created_at:new Date()});res.status(201).json({message:"Trip multimedia saved.",id:r.insertedId});}catch(e){sendError(res,e,"Save trip multimedia");}});

app.use((req,res,next)=>{if(req.path.startsWith("/api/"))return res.status(404).json({error:`API endpoint not found: ${req.method} ${req.path}`});next();});
app.use((err,req,res,next)=>{console.error("Unhandled request error:",err);res.status(500).json({error:"Unexpected server error."});});

async function syncFeedbackToMongo(){
  if(!mongoDb || !oracleConfig.user) return;
  try{
    const rows=(await withOracle(c=>c.execute(`SELECT f.feedback_id,f.user_id,f.trip_id,f.vehicle_id,f.rating,f.feedback_text feedback_comment,f.feedback_date,
      p.passenger_no,u.first_name||' '||u.last_name passenger_name,u.email,t.route_id,t.driver_id
      FROM Feedback f JOIN "User" u ON u.user_id=f.user_id LEFT JOIN Passenger p ON p.user_id=f.user_id LEFT JOIN Trip t ON t.trip_id=f.trip_id`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT}))).rows;
    if(!rows.length)return;
    for(const f of rows){
      await mongoDb.collection("passenger_reviews").updateOne({review_id:f.FEEDBACK_ID},{$set:{review_id:f.FEEDBACK_ID,passenger_id:f.USER_ID,passenger_no:f.PASSENGER_NO||null,passenger_name:f.PASSENGER_NAME||"Passenger",email:f.EMAIL||null,route_id:f.ROUTE_ID||null,trip_id:f.TRIP_ID||null,driver_id:f.DRIVER_ID||null,vehicle_id:f.VEHICLE_ID||null,rating:Number(f.RATING),comment:f.FEEDBACK_COMMENT,timestamp:f.FEEDBACK_DATE||new Date()}},{upsert:true});
    }
    console.log(`MongoDB feedback sync complete: ${rows.length} Oracle feedback record(s).`);
  }catch(e){console.warn("MongoDB feedback sync skipped:",e.message);}
}

async function startServer(){if(!oracleConfig.user||!oracleConfig.password||!oracleConfig.connectionString)console.warn("Oracle environment variables are missing; configure .env before using database features.");else console.log("Oracle configured. Install database/install_plsql_reports.sql before using PL/SQL reports.");if(process.env.MONGODB_URI){try{mongoClient=new MongoClient(process.env.MONGODB_URI);await mongoClient.connect();mongoDb=mongoClient.db(process.env.MONGODB_DATABASE || (()=>{try{return new URL(process.env.MONGODB_URI).pathname.replace(/^\/+/,"")||"smartmove";}catch(_){return "smartmove";}})());console.log("MongoDB connected."); await syncFeedbackToMongo();}catch(e){console.warn("MongoDB connection failed:",e.message);}}app.listen(port,()=>console.log(`SmartMove API listening on http://localhost:${port}`));}
startServer().catch(e=>{console.error("Server startup failed:",e);process.exit(1);});
