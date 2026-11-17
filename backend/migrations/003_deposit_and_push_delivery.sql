ALTER TABLE tours ADD COLUMN deposit_received boolean NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN push_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN next_push_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX push_pending ON notifications(next_push_at) WHERE push_status <> 'DELIVERED';
