document.addEventListener("DOMContentLoaded", () => {
  const menuToggle = document.getElementById("menuToggle");
  const mainNav = document.getElementById("mainNav");
  if (menuToggle && mainNav) {
    menuToggle.addEventListener("click", () => {
      const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
      menuToggle.setAttribute("aria-expanded", String(!isExpanded));
      mainNav.classList.toggle("active");
    });
  }
  const money = n => "Rs. " + Number(n || 0).toLocaleString("en-LK", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const safe = value => String(value ?? "").replace(/[&<>\"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
  const routeDuration = value => {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const minutes = Number(raw);
      if (Number.isFinite(minutes)) {
        const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
        return h ? `${h} hr${h === 1 ? "" : "s"}${m ? ` ${m} min` : ""}` : `${m} min`;
      }
    }
    return raw;
  };
  function renderRoutes(routes) {
    const box = document.getElementById("routeCards"); if (!box) return; box.replaceChildren();
    if (!routes.length) { box.append(Object.assign(document.createElement("p"), {className:"integration-note", textContent:"No active routes are currently available in Oracle."})); return; }
    routes.forEach(r => {
      const card = document.createElement("article"); card.className = "route-card";
      card.innerHTML = `<div class="route-top"><span>♙ ${safe(r.START_LOC)}</span><span>♙ ${safe(r.END_LOC)}</span></div><div class="route-details"><span>Distance<strong>${safe(r.DISTANCE)} km</strong></span><span>Duration<strong>${safe(routeDuration(r.ESTIMATED_DURATION))}</strong></span><span>Fare<strong class="fare">${money(r.FARE)}</strong></span></div><small class="route-bookings">${Number(r.BOOKING_COUNT || 0)} booking(s) for today's trips</small><a class="btn btn-green btn-full" href="customer/index.html?routeId=${encodeURIComponent(r.ROUTE_ID)}">Book Now</a>`;
      box.append(card);
    });
  }
  function renderAnnouncements(rows) { const box=document.getElementById("homepageAnnouncements"); if(!box)return; box.replaceChildren(); if(!rows.length){box.append(Object.assign(document.createElement("p"),{className:"integration-note",textContent:"No travel announcements are currently published."}));return;} rows.forEach(a=>{const card=document.createElement("article");card.className="update-card";card.innerHTML=`<span class="update-date">${safe(a.publish_date?new Date(a.publish_date).toLocaleDateString("en-LK"):"Latest")}</span><h3>${safe(a.title||"Travel update")}</h3><p>${safe(a.content||"")}</p><small>${safe(a.target_audience||"All Commuters")}</small>`;box.append(card);}); }
  function renderFeedback(rows) {
    const box = document.getElementById("homepageReviews"); if (!box) return; box.replaceChildren();
    if (!rows.length) { box.append(Object.assign(document.createElement("p"), {className:"integration-note", textContent:"No passenger feedback has been submitted yet."})); return; }
    rows.forEach(f => {
      const card = document.createElement("article"); card.className = "review-card";
      const rating = Number(f.RATING || 0), stars = "★".repeat(rating) + "☆".repeat(Math.max(0, 5-rating));
      const name = `${safe(f.FIRST_NAME || "Passenger")} ${safe(f.LAST_NAME ? f.LAST_NAME[0] + "." : "")}`;
      card.innerHTML = `<div class="stars">${stars}</div><p>“${safe(f.FEEDBACK_COMMENT || f.COMMENT || "")}”</p><div class="review-person"><span class="avatar">${safe((f.FIRST_NAME || "P").slice(0,1).toUpperCase())}</span><span><strong>${name}</strong><small>${safe(f.ROUTE_NAME || "SmartMove Passenger")}</small></span></div>`;
      box.append(card);
    });
  }
  async function loadHomepage() {
    try {
      const response = await fetch("/api/homepage"), data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const stats=data.stats||{}, set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value??"0");};
      set("home-stat-vehicles",stats.TOTAL_VEHICLES); set("home-stat-routes",stats.ACTIVE_ROUTES); set("home-stat-trips",stats.TODAY_TRIPS); set("home-stat-feedback",stats.FEEDBACK_COUNT);
      renderRoutes(Array.isArray(data.routes)?data.routes:[]); renderFeedback(Array.isArray(data.feedback)?data.feedback:[]); renderAnnouncements(Array.isArray(data.announcements)?data.announcements:[]);
    } catch(error) { console.error("Homepage database data:",error); renderRoutes([]); renderFeedback([]); renderAnnouncements([]); }
  }
  loadHomepage();
});
