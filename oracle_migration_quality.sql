-- SmartMove DM2 existing-database quality migration.
-- Run this after oracle_data_quality.sql reports zero mandatory-field bad rows.
-- It intentionally stops instead of inventing values for unknown NULL data.
SET SERVEROUTPUT ON;
DECLARE
  PROCEDURE require_zero(p_label VARCHAR2, p_sql VARCHAR2) IS
    n NUMBER;
  BEGIN
    EXECUTE IMMEDIATE p_sql INTO n;
    IF n > 0 THEN
      RAISE_APPLICATION_ERROR(-20010, p_label || ' contains ' || n || ' NULL row(s). Clean those rows before applying NOT NULL constraints.');
    END IF;
  END;
  PROCEDURE make_not_null(p_sql VARCHAR2) IS
  BEGIN EXECUTE IMMEDIATE p_sql; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -01442 THEN RAISE; END IF; END;
BEGIN
  require_zero('Passenger.passenger_status','SELECT COUNT(*) FROM Passenger WHERE passenger_status IS NULL');
  require_zero('Admin.role','SELECT COUNT(*) FROM Admin WHERE role IS NULL');
  require_zero('Driver.employment_status','SELECT COUNT(*) FROM Driver WHERE employment_status IS NULL');
  require_zero('Vehicle.make/model/year/seats/fuel/status','SELECT COUNT(*) FROM Vehicle WHERE make IS NULL OR model IS NULL OR manufacturing_year IS NULL OR seat_capacity IS NULL OR fuel_type IS NULL OR vehicle_status IS NULL');
  require_zero('Route mandatory fields','SELECT COUNT(*) FROM Route WHERE route_name IS NULL OR start_loc IS NULL OR end_loc IS NULL OR distance IS NULL OR estimated_duration IS NULL OR fare IS NULL OR status IS NULL');
  require_zero('Route_Stop mandatory fields','SELECT COUNT(*) FROM Route_Stop WHERE route_id IS NULL OR stop_name IS NULL OR stop_order IS NULL');
  require_zero('Trip mandatory fields','SELECT COUNT(*) FROM Trip WHERE route_id IS NULL OR vehicle_id IS NULL OR departure_time IS NULL OR expected_arrival IS NULL OR available_seats IS NULL OR trip_status IS NULL');
  require_zero('Trip_Driver mandatory fields','SELECT COUNT(*) FROM Trip_Driver WHERE trip_id IS NULL OR user_id IS NULL OR assignment_role IS NULL');
  require_zero('Booking mandatory fields','SELECT COUNT(*) FROM Booking WHERE trip_id IS NULL OR user_id IS NULL OR booking_date IS NULL OR seat_number IS NULL OR ticket_fare IS NULL OR booking_status IS NULL OR tot_amount IS NULL');
  require_zero('Payment mandatory fields','SELECT COUNT(*) FROM Payment WHERE booking_id IS NULL OR amount IS NULL OR payment_method IS NULL OR payment_status IS NULL OR transaction_reference IS NULL');
  require_zero('Maintenance mandatory fields','SELECT COUNT(*) FROM Maintenance WHERE vehicle_id IS NULL OR type IS NULL OR cost IS NULL OR next_due_date IS NULL OR status IS NULL');
  require_zero('Feedback mandatory fields','SELECT COUNT(*) FROM Feedback WHERE user_id IS NULL OR rating IS NULL OR "comment" IS NULL OR feedback_status IS NULL');

  make_not_null('ALTER TABLE Passenger MODIFY passenger_status VARCHAR2(20) NOT NULL');
  make_not_null('ALTER TABLE Admin MODIFY role VARCHAR2(50) NOT NULL');
  make_not_null('ALTER TABLE Driver MODIFY employment_status VARCHAR2(30) NOT NULL');
  make_not_null('ALTER TABLE Vehicle MODIFY (make VARCHAR2(50) NOT NULL, model VARCHAR2(50) NOT NULL, manufacturing_year NUMBER(4) NOT NULL, seat_capacity NUMBER(3) NOT NULL, fuel_type VARCHAR2(20) NOT NULL, vehicle_status VARCHAR2(20) NOT NULL)');
  make_not_null('ALTER TABLE Route MODIFY (route_name VARCHAR2(100) NOT NULL, start_loc VARCHAR2(100) NOT NULL, end_loc VARCHAR2(100) NOT NULL, distance NUMBER(6,2) NOT NULL, estimated_duration VARCHAR2(30) NOT NULL, fare NUMBER(8,2) NOT NULL, status VARCHAR2(20) NOT NULL)');
  make_not_null('ALTER TABLE Route_Stop MODIFY (route_id VARCHAR2(20) NOT NULL, stop_name VARCHAR2(100) NOT NULL, stop_order NUMBER(3) NOT NULL)');
  make_not_null('ALTER TABLE Trip MODIFY (route_id VARCHAR2(20) NOT NULL, vehicle_id VARCHAR2(20) NOT NULL, departure_time TIMESTAMP NOT NULL, expected_arrival TIMESTAMP NOT NULL, available_seats NUMBER(3) NOT NULL, trip_status VARCHAR2(20) NOT NULL)');
  make_not_null('ALTER TABLE Trip_Driver MODIFY (trip_id VARCHAR2(20) NOT NULL, user_id VARCHAR2(20) NOT NULL, assignment_role VARCHAR2(50) NOT NULL)');
  make_not_null('ALTER TABLE Booking MODIFY (trip_id VARCHAR2(20) NOT NULL, user_id VARCHAR2(20) NOT NULL, booking_date TIMESTAMP NOT NULL, seat_number VARCHAR2(100) NOT NULL, ticket_fare NUMBER(8,2) NOT NULL, booking_status VARCHAR2(20) NOT NULL, tot_amount NUMBER(8,2) NOT NULL)');
  make_not_null('ALTER TABLE Payment MODIFY (booking_id VARCHAR2(20) NOT NULL, amount NUMBER(8,2) NOT NULL, payment_method VARCHAR2(30) NOT NULL, payment_status VARCHAR2(20) NOT NULL, transaction_reference VARCHAR2(100) NOT NULL)');
  make_not_null('ALTER TABLE Maintenance MODIFY (vehicle_id VARCHAR2(20) NOT NULL, type VARCHAR2(50) NOT NULL, cost NUMBER(8,2) NOT NULL, next_due_date DATE NOT NULL, status VARCHAR2(20) NOT NULL)');
  make_not_null('ALTER TABLE Feedback MODIFY (user_id VARCHAR2(20) NOT NULL, rating NUMBER(1) NOT NULL, "comment" VARCHAR2(1000) NOT NULL, feedback_status VARCHAR2(20) NOT NULL)');
  DBMS_OUTPUT.PUT_LINE('Mandatory-field NOT NULL migration completed successfully.');
END;
/
COMMIT;
