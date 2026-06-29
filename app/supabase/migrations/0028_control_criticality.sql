-- Control criticality tiers — powers the 14-Day Sprint "close the core gaps" phase.
-- Lets the onboarding guide focus a new workspace on the handful of auditor-critical
-- controls first instead of burying them under the full framework. Reference data on
-- the global (non-tenant) controls table, so it rides the existing controls SELECT
-- policy — no new RLS. Safe default ('important') keeps every existing query working.

alter table public.controls
  add column if not exists criticality text not null default 'important'
  check (criticality in ('core', 'important', 'operational'));

-- Seed by (framework, category) so the mapping is deterministic and any control later
-- added to a known category inherits the right tier. Unmapped categories stay 'important'.

-- core: the technical, must-pass controls an auditor will fail you on and that map to
-- collectible evidence (access, change, crypto/data protection, logging/monitoring, IR).
update public.controls c
set criticality = 'core'
from public.frameworks f
where f.id = c.framework_id and (
     (f.slug = 'soc2'     and c.category in ('Access Controls', 'Change Management', 'System Operations'))
  or (f.slug = 'iso27001' and c.category in ('Technological'))
  or (f.slug = 'hipaa'    and c.category in ('Technical'))
  or (f.slug = 'pci-dss'  and c.category in ('Access control', 'Data protection'))
  or (f.slug = 'gdpr'     and c.category in ('Security', 'Breach', 'Data subject rights'))
);

-- operational: low-stakes / documentation-cadence controls the long tail can defer.
update public.controls c
set criticality = 'operational'
from public.frameworks f
where f.id = c.framework_id and (
     (f.slug = 'soc2'     and c.category in ('Communication', 'Control Environment'))
  or (f.slug = 'iso27001' and c.category in ('Physical'))
  or (f.slug = 'hipaa'    and c.category in ('Physical'))
  or (f.slug = 'pci-dss'  and c.category in ('Policy'))
  or (f.slug = 'gdpr'     and c.category in ('Governance'))
);
