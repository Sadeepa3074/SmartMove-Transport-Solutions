SET SERVEROUTPUT ON;

CREATE OR REPLACE PACKAGE smartmove_reports_pkg AS
  PROCEDURE revenue_summary(p_start_date DATE,p_end_date DATE,p_result OUT SYS_REFCURSOR);
  PROCEDURE driver_schedule(p_driver_id VARCHAR2,p_start_date DATE,p_end_date DATE,p_result OUT SYS_REFCURSOR);
  PROCEDURE monthly_operations(p_month NUMBER,p_year NUMBER,p_result OUT SYS_REFCURSOR);
  PROCEDURE frequent_routes(p_start_date DATE,p_end_date DATE,p_top_n NUMBER,p_result OUT SYS_REFCURSOR);
  PROCEDURE maintenance_due(p_days_ahead NUMBER,p_result OUT SYS_REFCURSOR);
  PROCEDURE passenger_history(p_passenger_no VARCHAR2,p_result OUT SYS_REFCURSOR);
END smartmove_reports_pkg;
/

CREATE OR REPLACE PACKAGE BODY smartmove_reports_pkg AS
  PROCEDURE revenue_summary(p_start_date DATE,p_end_date DATE,p_result OUT SYS_REFCURSOR) IS
  BEGIN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN RAISE_APPLICATION_ERROR(-20001,'Start date must be on or before end date.'); END IF;
    OPEN p_result FOR
      SELECT NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' THEN p.amount ELSE 0 END),0) total_paid,
             COUNT(CASE WHEN UPPER(p.payment_status)='COMPLETED' THEN 1 END) payment_count,
             NVL(SUM(CASE WHEN UPPER(p.payment_status)='REFUNDED' THEN p.amount ELSE 0 END),0) total_refunds,
             NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' THEN p.amount ELSE -p.amount END),0) net_revenue,
             NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' AND UPPER(p.payment_method)='CARD' THEN p.amount ELSE 0 END),0) card_revenue,
             NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' AND UPPER(p.payment_method)='ONLINE' THEN p.amount ELSE 0 END),0) online_revenue,
             NVL(SUM(CASE WHEN UPPER(p.payment_status)='COMPLETED' AND UPPER(p.payment_method) NOT IN ('CARD','ONLINE') THEN p.amount ELSE 0 END),0) other_revenue
      FROM Payment p JOIN Booking b ON b.booking_id=p.booking_id
      WHERE p.payment_date >= TRUNC(p_start_date) AND p.payment_date < TRUNC(p_end_date)+1;
  END;

  PROCEDURE driver_schedule(p_driver_id VARCHAR2,p_start_date DATE,p_end_date DATE,p_result OUT SYS_REFCURSOR) IS
  BEGIN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN RAISE_APPLICATION_ERROR(-20002,'Start date must be on or before end date.'); END IF;
    OPEN p_result FOR
      SELECT d.user_id driver_id,u.first_name||' '||u.last_name driver_name,t.trip_id,r.route_name,
             r.start_loc||' → '||r.end_loc route, v.registration_number,t.departure_time,t.expected_arrival,t.trip_status,
             ROUND((CAST(t.expected_arrival AS DATE)-CAST(t.departure_time AS DATE))*24,2) hours
      FROM Driver d JOIN "User" u ON u.user_id=d.user_id
      JOIN Trip t ON t.driver_id=d.user_id
      JOIN Route r ON r.route_id=t.route_id JOIN Vehicle v ON v.vehicle_id=t.vehicle_id
      WHERE t.departure_time>=CAST(TRUNC(p_start_date) AS TIMESTAMP) AND t.departure_time<CAST(TRUNC(p_end_date)+1 AS TIMESTAMP)
        AND (p_driver_id IS NULL OR d.user_id=p_driver_id)
      ORDER BY u.last_name,u.first_name,t.departure_time;
  END;

  PROCEDURE monthly_operations(p_month NUMBER,p_year NUMBER,p_result OUT SYS_REFCURSOR) IS
    d1 DATE; d2 DATE;
  BEGIN
    IF p_month IS NULL OR p_month<1 OR p_month>12 OR p_year IS NULL OR p_year<2000 THEN RAISE_APPLICATION_ERROR(-20003,'Enter a valid month and year.'); END IF;
    d1:=TO_DATE(p_year||LPAD(p_month,2,'0')||'01','YYYYMMDD'); d2:=ADD_MONTHS(d1,1);
    OPEN p_result FOR
      SELECT (SELECT COUNT(*) FROM Booking b WHERE b.booking_date>=d1 AND b.booking_date<d2) bookings,
             (SELECT COUNT(*) FROM Ticket k WHERE k.issue_date>=CAST(d1 AS TIMESTAMP) AND k.issue_date<CAST(d2 AS TIMESTAMP) AND UPPER(k.ticket_status)='ISSUED') tickets_issued,
             (SELECT COUNT(DISTINCT b.user_id) FROM Booking b JOIN Trip t ON t.trip_id=b.trip_id WHERE b.booking_date>=d1 AND b.booking_date<d2 AND UPPER(b.booking_status)='CONFIRMED') passengers_travelled,
             (SELECT COUNT(*) FROM Trip t WHERE t.departure_time>=CAST(d1 AS TIMESTAMP) AND t.departure_time<CAST(d2 AS TIMESTAMP) AND UPPER(t.trip_status)<>'CANCELLED') trips_run,
             (SELECT COUNT(*) FROM Trip t WHERE t.departure_time>=CAST(d1 AS TIMESTAMP) AND t.departure_time<CAST(d2 AS TIMESTAMP) AND UPPER(t.trip_status)='CANCELLED') trips_cancelled,
             (SELECT NVL(SUM(p.amount),0) FROM Payment p WHERE p.payment_date>=CAST(d1 AS TIMESTAMP) AND p.payment_date<CAST(d2 AS TIMESTAMP) AND UPPER(p.payment_status)='COMPLETED') revenue,
             (SELECT COUNT(*) FROM Passenger p WHERE p.registration_date>=d1 AND p.registration_date<d2) new_passengers
      FROM dual;
  END;

  PROCEDURE frequent_routes(p_start_date DATE,p_end_date DATE,p_top_n NUMBER,p_result OUT SYS_REFCURSOR) IS
  BEGIN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<p_start_date THEN RAISE_APPLICATION_ERROR(-20004,'Start date must be on or before end date.'); END IF;
    OPEN p_result FOR
      SELECT * FROM (SELECT r.route_id,r.route_name,COUNT(DISTINCT b.booking_id) bookings,COUNT(k.ticket_id) tickets_sold,
             NVL(SUM(CASE WHEN UPPER(pay.payment_status)='COMPLETED' THEN pay.amount ELSE 0 END),0) revenue
      FROM Route r LEFT JOIN Trip t ON t.route_id=r.route_id AND t.departure_time>=CAST(TRUNC(p_start_date) AS TIMESTAMP) AND t.departure_time<CAST(TRUNC(p_end_date)+1 AS TIMESTAMP)
      LEFT JOIN Booking b ON b.trip_id=t.trip_id AND UPPER(b.booking_status)='CONFIRMED'
      LEFT JOIN Ticket k ON k.booking_id=b.booking_id AND UPPER(k.ticket_status)='ISSUED'
      LEFT JOIN Payment pay ON pay.booking_id=b.booking_id
      GROUP BY r.route_id,r.route_name ORDER BY bookings DESC,tickets_sold DESC,r.route_name) WHERE ROWNUM<=GREATEST(NVL(p_top_n,10),1);
  END;

  PROCEDURE maintenance_due(p_days_ahead NUMBER,p_result OUT SYS_REFCURSOR) IS
    n NUMBER:=NVL(p_days_ahead,30);
  BEGIN
    IF n<0 OR n>3650 THEN RAISE_APPLICATION_ERROR(-20005,'Days ahead must be between 0 and 3650.'); END IF;
    OPEN p_result FOR
      SELECT v.vehicle_id,v.registration_number,v.make||' '||v.model vehicle,
             MAX(m.service_date) KEEP (DENSE_RANK LAST ORDER BY m.service_date) last_service_date,
             m.next_due_date,TRUNC(m.next_due_date)-TRUNC(SYSDATE) days_remaining,v.vehicle_status current_status,m.status
      FROM Vehicle v JOIN Maintenance m ON m.vehicle_id=v.vehicle_id
      WHERE m.next_due_date<=TRUNC(SYSDATE)+n AND UPPER(m.status)<>'COMPLETED'
      GROUP BY v.vehicle_id,v.registration_number,v.make,v.model,m.next_due_date,v.vehicle_status,m.status
      ORDER BY m.next_due_date;
  END;

  PROCEDURE passenger_history(p_passenger_no VARCHAR2,p_result OUT SYS_REFCURSOR) IS
  BEGIN
    OPEN p_result FOR SELECT p.passenger_no,u.first_name||' '||u.last_name passenger_name,b.booking_id,r.route_name,t.departure_time,b.seat_number,b.booking_status,b.tot_amount
      FROM Passenger p JOIN "User" u ON u.user_id=p.user_id LEFT JOIN Booking b ON b.user_id=p.user_id LEFT JOIN Trip t ON t.trip_id=b.trip_id LEFT JOIN Route r ON r.route_id=t.route_id
      WHERE UPPER(p.passenger_no)=UPPER(p_passenger_no) ORDER BY t.departure_time DESC NULLS LAST;
  END;
END smartmove_reports_pkg;
/

-- Standalone procedures for coursework demonstration
CREATE OR REPLACE PROCEDURE get_revenue_summary(p_start_date DATE,p_end_date DATE,p_result OUT SYS_REFCURSOR) IS BEGIN smartmove_reports_pkg.revenue_summary(p_start_date,p_end_date,p_result); END; /
CREATE OR REPLACE PROCEDURE get_driver_schedule(p_driver_id VARCHAR2,p_start_date DATE,p_end_date DATE,p_result OUT SYS_REFCURSOR) IS BEGIN smartmove_reports_pkg.driver_schedule(p_driver_id,p_start_date,p_end_date,p_result); END; /
CREATE OR REPLACE PROCEDURE get_monthly_operations(p_month NUMBER,p_year NUMBER,p_result OUT SYS_REFCURSOR) IS BEGIN smartmove_reports_pkg.monthly_operations(p_month,p_year,p_result); END; /
CREATE OR REPLACE PROCEDURE get_frequent_routes(p_start_date DATE,p_end_date DATE,p_top_n NUMBER,p_result OUT SYS_REFCURSOR) IS BEGIN smartmove_reports_pkg.frequent_routes(p_start_date,p_end_date,p_top_n,p_result); END; /
CREATE OR REPLACE PROCEDURE get_maintenance_due(p_days_ahead NUMBER,p_result OUT SYS_REFCURSOR) IS BEGIN smartmove_reports_pkg.maintenance_due(p_days_ahead,p_result); END; /

SELECT object_name,object_type,status FROM user_objects WHERE object_name LIKE 'GET_%' OR object_name='SMARTMOVE_REPORTS_PKG' ORDER BY object_name;
