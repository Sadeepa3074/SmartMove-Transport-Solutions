-- SmartMove DM2 database quality audit. Run after schema/seed on the Oracle database.
SET SERVEROUTPUT ON;

PROMPT === NULL/ORPHAN/DOMAIN QUALITY CHECKS ===;
SELECT 'User missing mandatory names/email' issue, COUNT(*) bad_rows FROM "User" WHERE first_name IS NULL OR last_name IS NULL OR email IS NULL;
SELECT 'Passenger missing status/passenger_no' issue, COUNT(*) bad_rows FROM Passenger WHERE passenger_no IS NULL OR passenger_status IS NULL;
SELECT 'Admin missing role' issue, COUNT(*) bad_rows FROM Admin WHERE role IS NULL;
SELECT 'Driver missing employment/license' issue, COUNT(*) bad_rows FROM Driver WHERE employment_status IS NULL OR license_number IS NULL;
SELECT 'Vehicle missing mandatory fields' issue, COUNT(*) bad_rows FROM Vehicle WHERE registration_number IS NULL OR make IS NULL OR model IS NULL OR manufacturing_year IS NULL OR seat_capacity IS NULL OR fuel_type IS NULL OR vehicle_status IS NULL;
SELECT 'Route missing mandatory fields' issue, COUNT(*) bad_rows FROM Route WHERE route_name IS NULL OR start_loc IS NULL OR end_loc IS NULL OR distance IS NULL OR estimated_duration IS NULL OR fare IS NULL OR status IS NULL;
SELECT 'Trip missing mandatory fields' issue, COUNT(*) bad_rows FROM Trip WHERE route_id IS NULL OR vehicle_id IS NULL OR departure_time IS NULL OR expected_arrival IS NULL OR available_seats IS NULL OR trip_status IS NULL;
SELECT 'Booking missing mandatory fields' issue, COUNT(*) bad_rows FROM Booking WHERE trip_id IS NULL OR user_id IS NULL OR booking_date IS NULL OR seat_number IS NULL OR ticket_fare IS NULL OR booking_status IS NULL OR tot_amount IS NULL;
SELECT 'Payment missing mandatory fields' issue, COUNT(*) bad_rows FROM Payment WHERE booking_id IS NULL OR amount IS NULL OR payment_method IS NULL OR payment_status IS NULL OR transaction_reference IS NULL;
SELECT 'Maintenance missing mandatory fields' issue, COUNT(*) bad_rows FROM Maintenance WHERE vehicle_id IS NULL OR type IS NULL OR cost IS NULL OR next_due_date IS NULL OR status IS NULL;
SELECT 'Feedback missing mandatory fields' issue, COUNT(*) bad_rows FROM Feedback WHERE user_id IS NULL OR rating IS NULL OR "comment" IS NULL OR feedback_status IS NULL;
SELECT 'Feedback optional trip/vehicle nulls' issue, COUNT(*) optional_rows FROM Feedback WHERE trip_id IS NULL OR vehicle_id IS NULL;
SELECT 'Invalid feedback rating' issue, COUNT(*) bad_rows FROM Feedback WHERE rating NOT BETWEEN 1 AND 5;
SELECT 'Negative trip seats' issue, COUNT(*) bad_rows FROM Trip WHERE available_seats < 0;
SELECT 'Duplicate passenger emails' issue, COUNT(*) bad_rows FROM (SELECT LOWER(email) e FROM "User" GROUP BY LOWER(email) HAVING COUNT(*) > 1);
SELECT 'Orphan bookings' issue, COUNT(*) bad_rows FROM Booking b LEFT JOIN Trip t ON t.trip_id=b.trip_id LEFT JOIN Passenger p ON p.user_id=b.user_id WHERE t.trip_id IS NULL OR p.user_id IS NULL;
SELECT 'Orphan payments' issue, COUNT(*) bad_rows FROM Payment p LEFT JOIN Booking b ON b.booking_id=p.booking_id WHERE b.booking_id IS NULL;

PROMPT === EXPECTED RESULT ===;
PROMPT All mandatory-field bad_rows should be 0. Feedback trip_id and vehicle_id may legitimately be NULL for general feedback.
