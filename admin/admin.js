'use strict';
/* SmartMove Admin Dashboard — Connected to Oracle and MongoDB Backend APIs. */

const $ = id => document.getElementById(id);
const ADMIN_TOKEN_KEY = 'smartmove-admin-token-v1';
const nativeAdminFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (token && String(url).startsWith('/api/')) {
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
    headers.set('X-Admin-Token', token);
    init = {...init, headers};
  }
  return nativeAdminFetch(input, init);
};
async function requireAdminSession(){
  const token=sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if(!token){location.replace('../login.html');return false;}
  const r=await nativeAdminFetch('/api/admin/auth/session',{headers:{'X-Admin-Token':token}});
  if(!r.ok){sessionStorage.removeItem(ADMIN_TOKEN_KEY);location.replace('../login.html');return false;}
  const admin=await r.json().catch(()=>({}));
  const name=`${admin.FIRST_NAME||''} ${admin.LAST_NAME||''}`.trim()||'Administrator';
  document.querySelector('.admin-profile strong')?.replaceChildren(document.createTextNode(name));
  document.querySelector('.admin-profile small')?.replaceChildren(document.createTextNode(admin.ROLE||'Administrator'));
  const initials=name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
  const avatar=document.querySelector('.admin-profile .profile-avatar'); if(avatar)avatar.textContent=initials;
  return true;
}

const value = id => $(id) ?$(id).value.trim() : '';
const setText = (id, text) => { if ($(id))$(id).textContent = String(text ?? '—'); };
const currency = amount => 'Rs. ' + Number(amount).toLocaleString('en-LK', {maximumFractionDigits:2});
const cell = (text, cls='') => { const td=document.createElement('td'); td.textContent=String(text ?? '—'); if(cls)td.className=cls; return td; };
const emptyTable = (tbody, columns, message) => { const row=document.createElement('tr'); const td=cell(message,'empty-message'); td.colSpan=columns; row.append(td); tbody.append(row); };
const makeButton = (title, className, cb) => { const btn=document.createElement('button'); btn.type='button'; btn.className=className; btn.textContent=title; btn.addEventListener('click',cb); return btn; };

let liveRoutes = [];
let liveTrips = [];
let liveBookings = [];
let liveReviews = [];
let liveVehicles = [];

async function loadAdminData() {
  try {
    const [vehiclesRes, routesRes, tripsRes, bookingsRes] = await Promise.all([
      fetch('/api/vehicles'), fetch('/api/routes'), fetch('/api/trips'), fetch('/api/customer-bookings')
    ]);
    if (vehiclesRes.ok) liveVehicles = await vehiclesRes.json();
    if (routesRes.ok) liveRoutes = await routesRes.json();
    if (tripsRes.ok) liveTrips = await tripsRes.json();
    
    if (bookingsRes.ok) {
      liveBookings = await bookingsRes.json();
    } else {
      console.warn(`Bookings API returned status: ${bookingsRes.status}`);
      liveBookings = [];
    }

    renderDashboard();
  } catch (err) {
    console.error("Failed to load live admin data from server:", err);
  }
}

function renderDashboard() {
  const totalBookings = liveBookings.length;
  const scheduledTrips = liveTrips.filter(t => ['SCHEDULED','ACTIVE'].includes(String(t.TRIP_STATUS || '').toUpperCase())).length;

  setText('total-vehicles', liveVehicles.length);
  setText('active-trips', scheduledTrips);
  const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const todayBookings = liveBookings.filter(b => String(b.BOOKING_DATE || '').slice(0,10) === today).length;
  const todayRevenue = liveBookings.filter(b => String(b.BOOKING_DATE || '').slice(0,10) === today).reduce((sum,b) => sum + Number(b.TOT_AMOUNT || 0),0);
  setText('today-bookings', todayBookings);
  setText('today-revenue', currency(todayRevenue));
  const completedTrips = liveTrips.filter(t => String(t.TRIP_STATUS || '').toUpperCase() === 'COMPLETED' && t.ACTUAL_ARRIVAL && t.EXPECTED_ARRIVAL);
  const onTime = completedTrips.filter(t => new Date(t.ACTUAL_ARRIVAL) <= new Date(t.EXPECTED_ARRIVAL)).length;
  setText('on-time-rate', completedTrips.length ? `${((onTime / completedTrips.length) * 100).toFixed(1)}% On-Time` : 'No completed trips yet');

  // Recent Bookings Table
  const tbody = $('recent-bookings-body');
  if (tbody) {
    tbody.replaceChildren();
    if (!liveBookings.length) {
      emptyTable(tbody, 6, 'No recent bookings in database.');
    } else {
      liveBookings.slice(0, 5).forEach(b => {
        const row = document.createElement('tr');
        [
          b.BOOKING_ID || b.bookingId,
          b.PASSENGER || b.USER_ID || 'Passenger #1',
          b.ROUTE || `${b.START_LOC || ''} → ${b.END_LOC || ''}`,
          b.SEATS || b.seat_number || '1',
          currency(b.TOT_AMOUNT || 0),
          b.BOOKING_STATUS || b.booking_status || 'Confirmed'
        ].forEach(x => row.append(cell(x)));
        tbody.append(row);
      });
    }
  }

  // Upcoming Trips List
  const list = $('upcoming-trips-list');
  if (list) {
    list.replaceChildren();
    const scheduled = liveTrips.filter(t => ['SCHEDULED','ACTIVE'].includes(String(t.TRIP_STATUS || t.tripStatus || '').toUpperCase()));
    if (!scheduled.length) {
      const p = document.createElement('p');
      p.className = 'empty-message';
      p.textContent = 'No scheduled trips found in Oracle.';
      list.append(p);
    } else {
      scheduled.slice(0, 5).forEach(t => {
        const item = document.createElement('div');
        item.className = 'trip-item';
        const title = document.createElement('h4');
        title.textContent = `${t.START_LOC || t.start_loc} → ${t.END_LOC || t.end_loc}`;
        const desc = document.createElement('p');
        desc.textContent = `Departure: ${t.DEPARTURE_TIME || t.departure_time} | Fare: ${currency(t.FARE || t.fare)}`;
        item.append(title, desc);
        list.append(item);
      });
    }
  }

  setText('welcome-date', 'Today is ' + new Date().toLocaleDateString('en-LK', {weekday:'long', year:'numeric', month:'long', day:'numeric'}) + '. Connected to Oracle & MongoDB.');
}

const pageTitles = {
  dashboard: 'Dashboard Overview',
  passengers: 'Passenger Management',
  vehicles: 'Vehicle Management',
  drivers: 'Driver Management',
  routes: 'Route Management',
  trips: 'Trip Management',
  bookings: 'Booking Management',
  payments: 'Payments & Finance',
  maintenance: 'Maintenance Management',
  feedback: 'Feedback Management',
  reports: 'Executive Reports',
  content: 'MongoDB Content',
  settings: 'Settings'
};

function showAdminPage(page) {
  if (!pageTitles[page] || !$(page + '-page')) return;
  document.querySelectorAll('.page-section').forEach(s => s.hidden = true);
  $(page + '-page').hidden = false;
  setText('page-title', pageTitles[page]);
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));

  if (page === 'dashboard') loadAdminData();
  if (page === 'passengers' && typeof window.renderPassengersManagement === 'function') window.renderPassengersManagement();
  if (page === 'maintenance' && typeof window.renderMaintenanceManagement === 'function') window.renderMaintenanceManagement();
  if (page === 'bookings' && typeof window.renderBookingsManagement === 'function') window.renderBookingsManagement();
  if (page === 'payments' && typeof window.renderPaymentsManagement === 'function') window.renderPaymentsManagement();
  if (page === 'feedback' && typeof window.renderFeedbackManagement === 'function') window.renderFeedbackManagement();
  if (page === 'reports' && typeof window.initReportsPage === 'function') window.initReportsPage();
  if (page === 'content' && typeof window.initContentPage === 'function') window.initContentPage();
  if (page === 'settings' && typeof window.renderSettingsManagement === 'function') window.renderSettingsManagement();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await requireAdminSession())) return;
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
    const page = button.dataset.page;
    if (pageTitles[page]) showAdminPage(page);
  }));

  $('admin-logout')?.addEventListener('click', async () => { const token=sessionStorage.getItem(ADMIN_TOKEN_KEY); try{await nativeAdminFetch('/api/admin/auth/logout',{method:'POST',headers:{'X-Admin-Token':token||''}});}catch(_){} sessionStorage.removeItem(ADMIN_TOKEN_KEY); location.replace('../login.html'); });
  const systemSearch=$('system-search');
  systemSearch?.addEventListener('input',()=>{
    const q=systemSearch.value.trim().toLowerCase(); if(!q)return;
    const pages=[['dashboard','dashboard',''],['passengers','passenger',''],['vehicles','vehicle',liveVehicles],['routes','route',liveRoutes],['trips','trip',liveTrips],['bookings','booking',liveBookings],['drivers','driver',''],['payments','payment',''],['maintenance','maintenance',''],['feedback','feedback',''],['settings','setting','']];
    const match=pages.find(([page,term,data])=>term.includes(q)||q.includes(term)||(Array.isArray(data)&&data.some(x=>Object.values(x||{}).some(v=>String(v??'').toLowerCase().includes(q)))));
    if(match){ showAdminPage(match[0]); const searchId={vehicles:'vehicle-search',routes:'route-search',trips:'trip-search',bookings:'booking-search',drivers:'driver-search'}[match[0]]; const field=searchId&&$(searchId); if(field){field.value=systemSearch.value;field.dispatchEvent(new Event('input',{bubbles:true}));} }
  });
  await loadAdminData();
  showAdminPage('dashboard');
});