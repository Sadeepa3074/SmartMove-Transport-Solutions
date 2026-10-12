-- Run as an Oracle DBA, not as SMARTMOVE.
-- Adjust passwords and usernames to your institution's security policy.
CREATE ROLE smartmove_operator_role;
CREATE ROLE smartmove_reporting_role;
-- Example grants. Replace SMARTMOVE with the actual schema owner if different.
GRANT SELECT, INSERT, UPDATE, DELETE ON SMARTMOVE.Vehicle TO smartmove_operator_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON SMARTMOVE.Driver TO smartmove_operator_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON SMARTMOVE.Route TO smartmove_operator_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON SMARTMOVE.Trip TO smartmove_operator_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON SMARTMOVE.Booking TO smartmove_operator_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON SMARTMOVE.Ticket TO smartmove_operator_role;
GRANT SELECT, INSERT, UPDATE ON SMARTMOVE.Payment TO smartmove_operator_role;
GRANT EXECUTE ON SMARTMOVE.SMARTMOVE_REPORTS_PKG TO smartmove_reporting_role;
GRANT SELECT ON SMARTMOVE.Route TO smartmove_reporting_role;
GRANT SELECT ON SMARTMOVE.Trip TO smartmove_reporting_role;
GRANT SELECT ON SMARTMOVE.Booking TO smartmove_reporting_role;
GRANT SELECT ON SMARTMOVE.Ticket TO smartmove_reporting_role;
GRANT SELECT ON SMARTMOVE.Payment TO smartmove_reporting_role;
