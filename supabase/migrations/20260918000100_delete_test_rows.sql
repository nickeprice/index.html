-- 2026-09-18 — Remove three live test rows (Phase 5 CI/DB cleanup).
--
-- These are the duplicate 2026-09-18T03:17Z rows and the 2026-09-18T04:29Z row
-- created during the phone/dev-server verification session. The real sample the
-- angler kept (2026-09-17T13:30:00Z, Sep 17 6:30 AM PT) is NOT touched.
--
-- Idempotent: matches on the exact primary keys, so re-running is a no-op.
delete from public.catches
where id in (
    '7a26a57f-7409-44a7-b4a0-511437376d27',
    '3a00da49-9131-41ce-853f-15c6cdf0c15a',
    '5df6f9ce-e45d-4461-840b-caa0744c6e78'
);
