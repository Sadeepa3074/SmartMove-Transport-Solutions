SET SERVEROUTPUT ON;
DECLARE r SYS_REFCURSOR; n NUMBER;
BEGIN
  smartmove_reports_pkg.revenue_summary(TRUNC(SYSDATE)-30,TRUNC(SYSDATE),r); CLOSE r;
  smartmove_reports_pkg.driver_schedule(NULL,TRUNC(SYSDATE)-30,TRUNC(SYSDATE)+30,r); CLOSE r;
  smartmove_reports_pkg.monthly_operations(EXTRACT(MONTH FROM SYSDATE),EXTRACT(YEAR FROM SYSDATE),r); CLOSE r;
  smartmove_reports_pkg.frequent_routes(TRUNC(SYSDATE)-30,TRUNC(SYSDATE),10,r); CLOSE r;
  smartmove_reports_pkg.maintenance_due(30,r); CLOSE r;
  smartmove_reports_pkg.passenger_history('PAS001',r); CLOSE r;
  DBMS_OUTPUT.PUT_LINE('All SmartMove report procedures opened successfully.');
EXCEPTION WHEN OTHERS THEN DBMS_OUTPUT.PUT_LINE('REPORT TEST FAILED: '||SQLERRM); RAISE;
END;
/
SELECT object_name, object_type, status FROM user_objects WHERE object_name IN ('SMARTMOVE_REPORTS_PKG','GET_REVENUE_SUMMARY','GET_DRIVER_SCHEDULE','GET_MONTHLY_OPERATIONS','GET_FREQUENT_ROUTES','GET_MAINTENANCE_DUE') ORDER BY object_name;
