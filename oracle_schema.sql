-- WARNING: destructive development reset. This drops all SmartMove tables.
-- Each drop is isolated so a missing table does not stop the remaining drops.
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Feedback CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Maintenance CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Payment CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Booking CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Trip_Driver CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Trip CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Route_Stop CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Route CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Bus CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Van CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Other_Vehicle CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Vehicle CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Driver CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Admin CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE Passenger CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE "User" CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/

-- 1. Base User Table
CREATE TABLE "User" (
    user_id VARCHAR2(20) PRIMARY KEY,
    first_name VARCHAR2(50) NOT NULL,
    last_name VARCHAR2(50) NOT NULL,
    gender VARCHAR2(10),
    dob DATE,
    address VARCHAR2(200),
    email VARCHAR2(100) UNIQUE NOT NULL,
    phone VARCHAR2(20),
    password_hash VARCHAR2(200)
);

-- 2. Passenger Sub-table
CREATE TABLE Passenger (
    user_id VARCHAR2(20) PRIMARY KEY,
    passenger_no VARCHAR2(20) UNIQUE NOT NULL,
    registration_date DATE DEFAULT SYSDATE,
    passenger_status VARCHAR2(20) NOT NULL,
    passenger_type VARCHAR2(30) DEFAULT 'daily commuter' NOT NULL,
    CONSTRAINT fk_passenger_user FOREIGN KEY (user_id) REFERENCES "User"(user_id)
);

-- 3. Admin Sub-table
CREATE TABLE Admin (
    user_id VARCHAR2(20) PRIMARY KEY,
    role VARCHAR2(50) NOT NULL,
    last_login TIMESTAMP,
    CONSTRAINT fk_admin_user FOREIGN KEY (user_id) REFERENCES "User"(user_id)
);

-- 4. Driver Sub-table
CREATE TABLE Driver (
    user_id VARCHAR2(20) PRIMARY KEY,
    employment_status VARCHAR2(30) NOT NULL,
    license_number VARCHAR2(50) UNIQUE NOT NULL,
    license_expiry DATE,
    hire_date DATE,
    CONSTRAINT fk_driver_user FOREIGN KEY (user_id) REFERENCES "User"(user_id)
);

-- 5. Vehicle Supertype
CREATE TABLE Vehicle (
    vehicle_id VARCHAR2(20) PRIMARY KEY,
    registration_number VARCHAR2(20) UNIQUE NOT NULL,
    make VARCHAR2(50) NOT NULL,
    model VARCHAR2(50) NOT NULL,
    manufacturing_year NUMBER(4) NOT NULL,
    seat_capacity NUMBER(3) NOT NULL,
    fuel_type VARCHAR2(20) NOT NULL,
    vehicle_status VARCHAR2(20) NOT NULL,
    purchase_date DATE,
    last_service_date DATE,
    next_service_due_date DATE
);

-- 6. Vehicle Subtypes
CREATE TABLE Bus (
    vehicle_id VARCHAR2(20) PRIMARY KEY,
    bus_type VARCHAR2(30) NOT NULL,
    number_of_decks NUMBER(1) NOT NULL,
    CONSTRAINT fk_bus_vehicle FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id)
);

CREATE TABLE Van (
    vehicle_id VARCHAR2(20) PRIMARY KEY,
    van_type VARCHAR2(30) NOT NULL,
    passenger_capacity NUMBER(3) NOT NULL,
    CONSTRAINT fk_van_vehicle FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id)
);

CREATE TABLE Other_Vehicle (
    vehicle_id VARCHAR2(20) PRIMARY KEY,
    description VARCHAR2(200) NOT NULL,
    category VARCHAR2(50) NOT NULL,
    CONSTRAINT fk_other_vehicle FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id)
);

-- 7. Route Management
CREATE TABLE Route (
    route_id VARCHAR2(20) PRIMARY KEY,
    route_name VARCHAR2(100) NOT NULL,
    start_loc VARCHAR2(100) NOT NULL,
    end_loc VARCHAR2(100) NOT NULL,
    distance NUMBER(6,2) NOT NULL,
    estimated_duration VARCHAR2(30) NOT NULL,
    fare NUMBER(8,2) NOT NULL,
    status VARCHAR2(20) NOT NULL
);

CREATE TABLE Route_Stop (
    stop_id VARCHAR2(20) PRIMARY KEY,
    route_id VARCHAR2(20) NOT NULL,
    stop_name VARCHAR2(100) NOT NULL,
    stop_order NUMBER(3) NOT NULL,
    scheduled_arrival VARCHAR2(20),
    scheduled_departure VARCHAR2(20),
    CONSTRAINT fk_routestop_route FOREIGN KEY (route_id) REFERENCES Route(route_id)
);

-- 8. Trip Scheduling
CREATE TABLE Trip (
    trip_id VARCHAR2(20) PRIMARY KEY,
    route_id VARCHAR2(20) NOT NULL,
    vehicle_id VARCHAR2(20) NOT NULL,
    driver_id VARCHAR2(20),
    departure_time TIMESTAMP NOT NULL,
    expected_arrival TIMESTAMP NOT NULL,
    actual_departure TIMESTAMP,
    actual_arrival TIMESTAMP,
    available_seats NUMBER(3) NOT NULL,
    trip_status VARCHAR2(20) NOT NULL,
    CONSTRAINT fk_trip_route FOREIGN KEY (route_id) REFERENCES Route(route_id),
    CONSTRAINT fk_trip_vehicle FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id),
    CONSTRAINT fk_trip_driver FOREIGN KEY (driver_id) REFERENCES Driver(user_id)
);

CREATE TABLE Trip_Driver (
    trip_driver_id VARCHAR2(20) PRIMARY KEY,
    trip_id VARCHAR2(20) NOT NULL,
    user_id VARCHAR2(20) NOT NULL,
    assignment_role VARCHAR2(50) NOT NULL,
    assignment_start_time TIMESTAMP,
    assignment_end_time TIMESTAMP,
    CONSTRAINT fk_tripdriver_trip FOREIGN KEY (trip_id) REFERENCES Trip(trip_id),
    CONSTRAINT fk_tripdriver_driver FOREIGN KEY (user_id) REFERENCES Driver(user_id)
);

-- 9. Ticket Booking
CREATE TABLE Booking (
    booking_id VARCHAR2(20) PRIMARY KEY,
    trip_id VARCHAR2(20) NOT NULL,
    user_id VARCHAR2(20) NOT NULL,
    booking_date TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    seat_number VARCHAR2(100) NOT NULL,
    ticket_fare NUMBER(8,2) NOT NULL,
    booking_status VARCHAR2(20) NOT NULL,
    tot_amount NUMBER(8,2) NOT NULL,
    CONSTRAINT fk_booking_trip FOREIGN KEY (trip_id) REFERENCES Trip(trip_id),
    CONSTRAINT fk_booking_passenger FOREIGN KEY (user_id) REFERENCES Passenger(user_id)
);

-- 10. Ticket entity required by DM2 coursework
CREATE TABLE Ticket (
    ticket_id VARCHAR2(20) PRIMARY KEY,
    booking_id VARCHAR2(20) NOT NULL,
    seat_number VARCHAR2(10) NOT NULL,
    fare NUMBER(8,2) NOT NULL,
    issue_date TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    ticket_status VARCHAR2(20) NOT NULL,
    CONSTRAINT fk_ticket_booking FOREIGN KEY (booking_id) REFERENCES Booking(booking_id),
    CONSTRAINT ck_ticket_fare CHECK (fare >= 0),
    CONSTRAINT uq_ticket_booking_seat UNIQUE (booking_id, seat_number)
);

-- 10. Payment Processing
CREATE TABLE Payment (
    payment_id VARCHAR2(20) PRIMARY KEY,
    booking_id VARCHAR2(20) NOT NULL,
    amount NUMBER(8,2) NOT NULL,
    payment_method VARCHAR2(30) NOT NULL,
    payment_status VARCHAR2(20) NOT NULL,
    transaction_reference VARCHAR2(100) NOT NULL,
    payment_date TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT fk_payment_booking FOREIGN KEY (booking_id) REFERENCES Booking(booking_id),
    CONSTRAINT uq_payment_booking UNIQUE (booking_id)
);

-- 11. Maintenance Management
CREATE TABLE Maintenance (
    maintenance_id VARCHAR2(20) PRIMARY KEY,
    service_date DATE DEFAULT SYSDATE NOT NULL,
    vehicle_id VARCHAR2(20) NOT NULL,
    type VARCHAR2(50) NOT NULL,
    description VARCHAR2(200),
    cost NUMBER(8,2) NOT NULL,
    next_due_date DATE NOT NULL,
    status VARCHAR2(20) NOT NULL,
    CONSTRAINT fk_maintenance_vehicle FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id)
);

-- 12. Feedback and Review Management
CREATE TABLE Feedback (
    feedback_id VARCHAR2(20) PRIMARY KEY,
    user_id VARCHAR2(20) NOT NULL,
    trip_id VARCHAR2(20),
    vehicle_id VARCHAR2(20),
    rating NUMBER(1) NOT NULL,
    "comment" VARCHAR2(1000) NOT NULL,
    feedback_date TIMESTAMP DEFAULT SYSTIMESTAMP,
    feedback_status VARCHAR2(20) NOT NULL,
    response VARCHAR2(1000),
    CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES "User"(user_id),
    CONSTRAINT fk_feedback_trip FOREIGN KEY (trip_id) REFERENCES Trip(trip_id),
    CONSTRAINT fk_feedback_vehicle FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id)
);
ALTER TABLE Vehicle ADD CONSTRAINT ck_vehicle_seats CHECK (seat_capacity > 0);
ALTER TABLE Vehicle ADD CONSTRAINT ck_vehicle_year CHECK (manufacturing_year >= 1900);
ALTER TABLE Route ADD CONSTRAINT ck_route_distance CHECK (distance > 0);
ALTER TABLE Route ADD CONSTRAINT ck_route_fare CHECK (fare >= 0);
ALTER TABLE Trip ADD CONSTRAINT ck_trip_seats CHECK (available_seats >= 0);
ALTER TABLE Booking ADD CONSTRAINT ck_booking_amount CHECK (ticket_fare >= 0 AND tot_amount >= 0);
ALTER TABLE Payment ADD CONSTRAINT ck_payment_amount CHECK (amount > 0);
ALTER TABLE Feedback ADD CONSTRAINT ck_feedback_rating CHECK (rating BETWEEN 1 AND 5);
