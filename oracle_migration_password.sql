-- SmartMove safe migration for existing coursework databases.
-- Run this if you already created the old schema and do NOT want to drop/recreate all tables.
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE "User" ADD (password_hash VARCHAR2(200))';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1430 THEN RAISE; END IF; -- ORA-01430: column already exists
END;
/

-- After this migration, newly registered customers will store password hashes.
-- Existing customers created before the password feature must register again or have a password hash set by an administrator.


-- Compatibility fixes for the database-backed booking/feedback UI.
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE Booking MODIFY (seat_number VARCHAR2(100))';
EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE Feedback MODIFY ("comment" VARCHAR2(1000))';
EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE Feedback MODIFY (response VARCHAR2(1000))';
EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
/


-- Administrator login seed credential for the coursework dashboard.
-- Password: Admin123!
UPDATE "User" SET password_hash='e0d899e149f0af5e347460fb64637ec9:f72f7421a7bd132dbb67cfe8112401d5c69a69cf7f8608f7276ff2538912076c0299e5ebd18c2c6bad290fd82ec176a1e736d7f8a6325ae4eb591cdb4528a8de' WHERE user_id=(SELECT user_id FROM Admin WHERE ROWNUM=1) AND (password_hash IS NULL OR password_hash='');
COMMIT;
