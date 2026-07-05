// The master hub (the portal-less, top-level Clarity control plane) has no Tenant
// row, so it needs an explicit display name. Defined here in ONE place so every
// surface — the master-hub Email log's "Tenant" column, the sender identity/label
// on comms that originate from the master hub (invites today; others later) — reads
// the same value. Change it here and it updates everywhere.
export const MASTER_HUB_NAME = "Clarity HQ";
