ALTER TABLE notifications ADD COLUMN resource_kind text NOT NULL DEFAULT 'TOUR'
  CHECK(resource_kind IN ('TOUR','MEMBERSHIP','ACCOUNT','GENERAL'));
UPDATE notifications SET resource_kind='ACCOUNT' WHERE title='Your account status was updated';
UPDATE notifications SET resource_kind='MEMBERSHIP' WHERE title IN ('A driver applied to your agency','Agency membership updated');
CREATE INDEX assignment_history ON assignments(driver_id,assigned_at DESC);
