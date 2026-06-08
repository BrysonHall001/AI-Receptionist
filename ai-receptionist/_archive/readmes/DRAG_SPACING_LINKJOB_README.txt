Field-section drag/drop + detail spacing + link-job-from-contact
================================================================
Unzip at the project ROOT. NO migration, NO schema change.
Two files: public/js/portal.js, public/styles.css

PART 1 — Drag fields into sections: on the Fields page you can now DRAG any
field (including locked Name/Phone/Email/Last reason) from one section or
"Ungrouped" and DROP it into another section, including a new empty one. The
"Move to" dropdown stays as a fallback. Section placement is display-only — it
never changes a field's key, values, or how it's referenced.

PART 2 — Detail-page spacing: contact AND job detail cards now have proper inner
padding (they were hugging the edges because plain .card has no padding), a
capped width for side breathing room, tightened vertical gaps, and cleaner
linked-item rows (simple separators instead of boxed borders).

PART 3 — Link a job from the contact page: the contact's Jobs section now has a
"type a job title" search box that links a job to this contact (same RecordLink,
from the other direction), plus per-row stage selector and Unlink — matching the
job side. Results show job title + status to tell same-titled jobs apart.

See the chat for restore-point, apply, and revert commands.
