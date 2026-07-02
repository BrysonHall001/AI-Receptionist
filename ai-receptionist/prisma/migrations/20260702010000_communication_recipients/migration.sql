-- Store the per-recipient list on each blast so the Communication Sent-log detail
-- view can show WHO each blast went to (with sent/failed status), not just counts.
-- NOT NULL DEFAULT '[]' so existing rows are backfilled with an empty list and stay valid.
ALTER TABLE "CommunicationSend" ADD COLUMN IF NOT EXISTS "recipients" JSONB NOT NULL DEFAULT '[]';
