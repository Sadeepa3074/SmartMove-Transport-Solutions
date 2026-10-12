"use strict";
/* SmartMove Payments & Finance Management — Database Connected */

(function () {
    let serverPayments = [];
    const byId = id => document.getElementById(id);

    function setValue(id, value) {
        const element = byId(id);
        if (element) element.textContent = String(value);
    }

    function formatMoney(value) {
        return "Rs. " + Number(value || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async function fetchPayments() {
        try {
            const res = await fetch('/api/payments');
            if (res.ok) serverPayments = await res.json();
        } catch (err) {
            console.error("Failed to fetch payments:", err);
        }
        renderPayments();
    }

    function renderPayments() {
        const tableBody = byId("finance-table-body");
        if (!tableBody) return;
        tableBody.replaceChildren();

        const totalPaid = serverPayments.filter(p => (p.PAYMENT_STATUS || p.payment_status) === 'COMPLETED').reduce((acc, p) => acc + Number(p.AMOUNT || p.amount || 0), 0);
        setValue("finance-collected", formatMoney(totalPaid));
        setValue("finance-results", serverPayments.length + " transaction(s)");

        if (!serverPayments.length) {
            const row = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 8;
            td.className = "finance-empty";
            td.textContent = "No payment records found in Oracle database.";
            row.append(td);
            tableBody.append(row);
            return;
        }

        serverPayments.forEach(p => {
            const row = document.createElement("tr");
            const id = p.PAYMENT_ID || p.payment_id;
            const bookingId = p.BOOKING_ID || p.booking_id;
            const amount = formatMoney(p.AMOUNT || p.amount);
            const method = p.PAYMENT_METHOD || p.payment_method || 'Card';
            const status = p.PAYMENT_STATUS || p.payment_status || 'COMPLETED';
            const date = (p.BOOKING_DATE || p.booking_date || '').slice(0, 10);

            [id, bookingId, 'Passenger', amount, method, status, date].forEach(val => {
                const td = document.createElement("td");
                td.textContent = val;
                row.append(td);
            });

            const actionTd = document.createElement("td");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "finance-action-btn";
            btn.textContent = "View";
            btn.addEventListener("click", () => alert(`Payment ID: ${id} | Amount: ${amount}`));
            actionTd.append(btn);
            row.append(actionTd);

            tableBody.append(row);
        });
    }

    function setupPayments() {
        if (!byId("payments-page")) return;
        fetchPayments();
    }

    window.renderPaymentsManagement = fetchPayments;
    document.addEventListener("DOMContentLoaded", setupPayments);
})();