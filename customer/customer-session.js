"use strict";
/* SmartMove frontend prototype session management. */
(function () {
  const KEY = "smartmove-passenger-session-v2";
  const INTENT_KEY = "smartmove-booking-intent-v1";

  function current() {
    try {
      const data = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (
        data &&
        typeof data.email === "string" &&
        typeof data.firstName === "string"
      )
        return data;
    } catch (_) {}
    return null;
  }

  function begin(profile) {
    const firstName = String(profile.firstName || "Demo").trim().slice(0, 60);
    const lastName = String(profile.lastName || "Passenger").trim().slice(0, 60);
    const email = String(profile.email || "demo.passenger@example.com").trim().toLowerCase().slice(0, 140);
    const phone = String(profile.phone || "").trim().slice(0, 24);
    const userId = String(profile.userId || "").trim().slice(0, 20);
    const data = {
      firstName,
      lastName,
      email,
      phone,
      userId,
      demo: false,
      memberSince: new Date().toISOString().slice(0, 10),
    };
    sessionStorage.setItem(KEY, JSON.stringify(data));
    return data;
  }

  function update(profile) {
    const old = current();
    if (!old) return null;
    const next = {
      ...old,
      firstName: String(profile.firstName || old.firstName).trim().slice(0, 60),
      lastName: String(profile.lastName || old.lastName).trim().slice(0, 60),
      phone: String(profile.phone || old.phone || "").trim().slice(0, 24),
      userId: String(profile.userId || old.userId || "").trim().slice(0, 20),
    };
    sessionStorage.setItem(KEY, JSON.stringify(next));
    drawHeader();
    return next;
  }

  function end() {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(INTENT_KEY);
  }

  function safeNext(value) {
    const pages = new Set(["index.html", "my-bookings.html", "../index.html"]);
    return pages.has(value) ? value : "my-bookings.html";
  }

  function loginHref(next) {
    return "/login.html?next=" + encodeURIComponent(safeNext(next || "customer/index.html"));
  }

  function initials(user) {
    return ((user.firstName[0] || "") + (user.lastName[0] || "")).toUpperCase();
  }

  function makeElement(tag, cls, value) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (value != null) e.textContent = value;
    return e;
  }

  function drawHeader() {
    const holder = document.querySelector(".header-actions");
    if (!holder) return;
    const user = current();
    holder.replaceChildren();

    if (!user) {
      const login = makeElement("a", "btn btn-outline btn-small header-btn header-btn-outline", "Login");
      login.href = holder.dataset.loginHref || "/login.html";
      const signup = makeElement("a", "btn btn-green btn-small header-btn header-btn-green", "Sign Up");
      signup.href = holder.dataset.signupHref || "/customer/signup.html";
      holder.append(login, signup);
      return;
    }

    const details = makeElement("details", "sm-account-menu");
    const trigger = makeElement("summary", "sm-account-trigger");
    trigger.setAttribute("aria-label", "Open customer account menu");
    trigger.append(makeElement("span", "sm-avatar", initials(user)));

    const text = makeElement("span", "sm-account-text");
    text.append(makeElement("strong", "", user.firstName + " " + user.lastName));
    text.append(makeElement("small", "", "Passenger"));
    trigger.append(text, makeElement("span", "sm-chevron", "⌄"));

    const menu = makeElement("div", "sm-menu-items");
    const path = location.pathname.includes("/customer/") ? "" : "customer/";
    const entries = [
      ["My Profile", "my-bookings.html?tab=profile"],
      ["My Bookings", "my-bookings.html?tab=upcoming"],
      ["Travel History", "my-bookings.html?tab=history"],
      ["My Feedback", "my-bookings.html?tab=feedback"],
    ];

    entries.forEach(([text, href]) => {
      const a = makeElement("a", "", text);
      a.href = path + href;
      menu.append(a);
    });

    const logout = makeElement("button", "sm-logout", "Log Out");
    logout.type = "button";
    logout.addEventListener("click", () => {
      end();
      location.href = path ? "index.html" : "../index.html";
    });

    menu.append(logout);
    details.append(trigger, menu);
    holder.append(details);
  }

  document.addEventListener("DOMContentLoaded", () => {
    drawHeader();
    if (!document.querySelector("script[src$='script.js']") && !document.querySelector("script[src$='booking.js']")) {
      const toggle = document.getElementById("menuToggle"),
        nav = document.getElementById("mainNav");
      if (toggle && nav) {
        toggle.addEventListener("click", () => {
          const open = nav.classList.toggle("open");
          toggle.setAttribute("aria-expanded", String(open));
        });
        nav.querySelectorAll("a").forEach((a) =>
          a.addEventListener("click", () => {
            nav.classList.remove("open");
            toggle.setAttribute("aria-expanded", "false");
          }),
        );
      }
    }

    document.addEventListener("click", (event) => {
      document.querySelectorAll("details.sm-account-menu[open]").forEach((menu) => {
        if (!menu.contains(event.target)) menu.open = false;
      });
    });
  });

  window.SmartMoveDemo = Object.freeze({
    current,
    begin,
    update,
    end,
    safeNext,
    loginHref,
    drawHeader,
    intentKey: INTENT_KEY,
  });
})();