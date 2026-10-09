-- 0053_aws_restore_tested.sql
--
-- "Back up and test restores" now has a check for the second half of its name:
-- a database or table restored in the last year (AWS Backup restore jobs, or a
-- native RDS/DynamoDB restore in CloudTrail), per in-scope AWS account.
--
-- Leavers and unknown logins in AWS (aws.offboarding_drift,
-- aws.untracked_accounts) were mapped in 0052. Data residency and manual
-- changes stay unmapped on purpose: residency only exists when a workspace has
-- made the commitment, and console changes are evidence to review, not a gate.

insert into public.measure_checks (measure_id, check_key)
select m.id, 'aws.restore_tested'
from public.measures m
where m.key = 'backups'
on conflict do nothing;
