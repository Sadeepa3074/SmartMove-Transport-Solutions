-- SmartMove DM2 FINAL upgrade for existing Oracle schemas
-- Run as SMARTMOVE. Safe to run more than once where practical.
SET SERVEROUTPUT ON;

DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM user_tab_columns WHERE table_name='PASSENGER' AND column_name='PASSENGER_TYPE';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Passenger ADD (passenger_type VARCHAR2(30) DEFAULT ''daily commuter'' NOT NULL)'; END IF;
  SELECT COUNT(*) INTO n FROM user_tab_columns WHERE table_name='VEHICLE' AND column_name='PURCHASE_DATE';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Vehicle ADD (purchase_date DATE)'; END IF;
  SELECT COUNT(*) INTO n FROM user_tab_columns WHERE table_name='VEHICLE' AND column_name='LAST_SERVICE_DATE';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Vehicle ADD (last_service_date DATE)'; END IF;
  SELECT COUNT(*) INTO n FROM user_tab_columns WHERE table_name='VEHICLE' AND column_name='NEXT_SERVICE_DUE_DATE';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Vehicle ADD (next_service_due_date DATE)'; END IF;
  SELECT COUNT(*) INTO n FROM user_tab_columns WHERE table_name='PAYMENT' AND column_name='PAYMENT_DATE';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Payment ADD (payment_date TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL)'; END IF;
  SELECT COUNT(*) INTO n FROM user_tab_columns WHERE table_name='TRIP' AND column_name='DRIVER_ID';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Trip ADD (driver_id VARCHAR2(20))'; END IF;
  SELECT COUNT(*) INTO n FROM user_constraints WHERE constraint_name='FK_TRIP_DRIVER';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Trip ADD CONSTRAINT fk_trip_driver FOREIGN KEY (driver_id) REFERENCES Driver(user_id)'; END IF;
  SELECT COUNT(*) INTO n FROM user_tab_columns WHERE table_name='MAINTENANCE' AND column_name='SERVICE_DATE';
  IF n=0 THEN EXECUTE IMMEDIATE 'ALTER TABLE Maintenance ADD (service_date DATE DEFAULT SYSDATE NOT NULL)'; END IF;
  SELECT COUNT(*) INTO n FROM user_tables WHERE table_name='TICKET';
  IF n=0 THEN EXECUTE IMMEDIATE 'CREATE TABLE Ticket (ticket_id VARCHAR2(20) PRIMARY KEY, booking_id VARCHAR2(20) NOT NULL, seat_number VARCHAR2(10) NOT NULL, fare NUMBER(8,2) NOT NULL, issue_date TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL, ticket_status VARCHAR2(20) NOT NULL, CONSTRAINT fk_ticket_booking FOREIGN KEY (booking_id) REFERENCES Booking(booking_id), CONSTRAINT ck_ticket_fare CHECK (fare >= 0), CONSTRAINT uq_ticket_booking_seat UNIQUE (booking_id,seat_number))'; END IF;
END;
/

-- Backfill direct driver link from the existing Trip_Driver relationship.
UPDATE Trip t SET driver_id=(SELECT MIN(td.user_id) FROM Trip_Driver td WHERE td.trip_id=t.trip_id) WHERE driver_id IS NULL;

-- Backfill one ticket per seat from existing bookings.
DECLARE
  n NUMBER;
BEGIN
  FOR b IN (SELECT booking_id,seat_number,ticket_fare,booking_status FROM Booking) LOOP
    FOR x IN (SELECT TRIM(REGEXP_SUBSTR(b.seat_number,'[^,]+',1,LEVEL)) seat_no FROM dual CONNECT BY REGEXP_SUBSTR(b.seat_number,'[^,]+',1,LEVEL) IS NOT NULL) LOOP
      SELECT COUNT(*) INTO n FROM Ticket WHERE booking_id=b.booking_id AND seat_number=x.seat_no;
      IF n=0 THEN INSERT INTO Ticket(ticket_id,booking_id,seat_number,fare,ticket_status) VALUES ('TK'||SUBSTR(REPLACE(b.booking_id,'-',''),1,12)||LPAD(ROWNUM,2,'0'),b.booking_id,x.seat_no,b.ticket_fare,CASE WHEN UPPER(b.booking_status)='CANCELLED' THEN 'CANCELLED' ELSE 'ISSUED' END); END IF;
    END LOOP;
  END LOOP;
END;
/
COMMIT;

@@oracle_plsql_reports.sql

-- Coursework business-logic triggers
BEGIN EXECUTE IMMEDIATE 'DROP TRIGGER trg_ticket_seat_count'; EXCEPTION WHEN OTHERS THEN IF SQLCODE!=-4080 THEN RAISE; END IF; END; /
CREATE OR REPLACE TRIGGER trg_ticket_seat_count
AFTER INSERT OR UPDATE OF ticket_status OR DELETE ON Ticket
FOR EACH ROW
BEGIN
  IF INSERTING AND UPPER(:NEW.ticket_status)='ISSUED' THEN
    UPDATE Trip SET available_seats=available_seats-1 WHERE trip_id=(SELECT trip_id FROM Booking WHERE booking_id=:NEW.booking_id);
  ELSIF DELETING AND UPPER(:OLD.ticket_status)='ISSUED' THEN
    UPDATE Trip SET available_seats=available_seats+1 WHERE trip_id=(SELECT trip_id FROM Booking WHERE booking_id=:OLD.booking_id);
  ELSIF UPDATING THEN
    IF UPPER(:OLD.ticket_status)='ISSUED' AND UPPER(:NEW.ticket_status)<>'ISSUED' THEN UPDATE Trip SET available_seats=available_seats+1 WHERE trip_id=(SELECT trip_id FROM Booking WHERE booking_id=:OLD.booking_id);
    ELSIF UPPER(:OLD.ticket_status)<>'ISSUED' AND UPPER(:NEW.ticket_status)='ISSUED' THEN UPDATE Trip SET available_seats=available_seats-1 WHERE trip_id=(SELECT trip_id FROM Booking WHERE booking_id=:NEW.booking_id); END IF;
  END IF;
END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TRIGGER trg_trip_rules'; EXCEPTION WHEN OTHERS THEN IF SQLCODE!=-4080 THEN RAISE; END IF; END; /
CREATE OR REPLACE TRIGGER trg_trip_rules
BEFORE INSERT OR UPDATE ON Trip
FOR EACH ROW
DECLARE n NUMBER;
BEGIN
  IF :NEW.expected_arrival<=:NEW.departure_time THEN RAISE_APPLICATION_ERROR(-20020,'Trip arrival must be after departure.'); END IF;
  IF :NEW.driver_id IS NOT NULL THEN
    SELECT COUNT(*) INTO n FROM Driver d WHERE d.user_id=:NEW.driver_id AND (d.license_expiry IS NULL OR d.license_expiry>=TRUNC(:NEW.departure_time)) AND UPPER(d.employment_status)='ACTIVE';
    IF n=0 THEN RAISE_APPLICATION_ERROR(-20021,'Driver is inactive, missing, or has an expired licence.'); END IF;
    SELECT COUNT(*) INTO n FROM Trip t WHERE t.trip_id<>NVL(:NEW.trip_id,'~') AND t.driver_id=:NEW.driver_id AND UPPER(t.trip_status)<>'CANCELLED' AND t.departure_time<:NEW.expected_arrival AND t.expected_arrival>:NEW.departure_time;
    IF n>0 THEN RAISE_APPLICATION_ERROR(-20022,'Driver already has an overlapping trip.'); END IF;
  END IF;
END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TRIGGER trg_maintenance_vehicle_status'; EXCEPTION WHEN OTHERS THEN IF SQLCODE!=-4080 THEN RAISE; END IF; END; /
CREATE OR REPLACE TRIGGER trg_maintenance_vehicle_status
AFTER INSERT OR UPDATE OF status,vehicle_id ON Maintenance
FOR EACH ROW
BEGIN
  IF UPPER(:NEW.status) IN ('PENDING','SCHEDULED') THEN UPDATE Vehicle SET vehicle_status='Maintenance',last_service_date=:NEW.service_date,next_service_due_date=:NEW.next_due_date WHERE vehicle_id=:NEW.vehicle_id;
  ELSIF UPPER(:NEW.status)='COMPLETED' THEN UPDATE Vehicle SET vehicle_status='Active',last_service_date=:NEW.service_date,next_service_due_date=:NEW.next_due_date WHERE vehicle_id=:NEW.vehicle_id; END IF;
END;
/

-- Keep Trip direct driver link synchronized with legacy Trip_Driver assignments.
UPDATE Trip t SET driver_id=(SELECT MIN(td.user_id) FROM Trip_Driver td WHERE td.trip_id=t.trip_id) WHERE driver_id IS NULL;
COMMIT;
