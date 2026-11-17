-- Persistent local edition. Mirrors PostgreSQL migrations 001 through 005.
-- UTC ISO timestamps, strict integer money, foreign keys and partial uniqueness.
CREATE TABLE users (
 id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('TOURIST','AGENT','DRIVER','ADMIN')),
 status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
 name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
 photo_url TEXT, token_version INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE agent_profiles (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id), agency_name TEXT NOT NULL, location TEXT NOT NULL DEFAULT 'Sri Lanka') STRICT;
CREATE TABLE driver_profiles (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id), licence_number TEXT NOT NULL DEFAULT '', licence_expiry TEXT) STRICT;
CREATE TABLE memberships (
 id TEXT PRIMARY KEY NOT NULL, agent_id TEXT NOT NULL REFERENCES agent_profiles(user_id), driver_id TEXT NOT NULL REFERENCES driver_profiles(user_id),
 status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REJECTED','REMOVED')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(agent_id,driver_id)
) STRICT;
CREATE TABLE vehicles (
 id TEXT PRIMARY KEY NOT NULL, driver_id TEXT NOT NULL REFERENCES driver_profiles(user_id), type TEXT NOT NULL CHECK(type IN ('CAR','VAN','KDH')),
 registration TEXT NOT NULL UNIQUE, model TEXT NOT NULL, seats INTEGER NOT NULL CHECK(seats BETWEEN 1 AND 60), approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1))
) STRICT;
CREATE TABLE media (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), vehicle_id TEXT REFERENCES vehicles(id),
 kind TEXT NOT NULL CHECK(kind IN ('DOCUMENT','VEHICLE_PHOTO','PROFILE_PHOTO')), public_id TEXT NOT NULL UNIQUE,
 url TEXT, approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((kind='DOCUMENT' AND url IS NULL) OR kind<>'DOCUMENT')
) STRICT;
CREATE TABLE tours (
 id TEXT PRIMARY KEY NOT NULL, tourist_id TEXT NOT NULL REFERENCES users(id), agent_id TEXT NOT NULL REFERENCES agent_profiles(user_id),
 pickup TEXT NOT NULL, destination TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 vehicle_type TEXT NOT NULL CHECK(vehicle_type IN ('CAR','VAN','KDH')), passengers INTEGER NOT NULL CHECK(passengers BETWEEN 1 AND 60), notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','QUOTED','ACCEPTED','OPEN','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
 payout_minor INTEGER CHECK(payout_minor >= 0 AND payout_minor <= 10000000000), collector TEXT CHECK(collector IN ('AGENT','DRIVER')),
 collection_minor INTEGER CHECK(collection_minor >= 0 AND collection_minor <= 10000000000), instructions TEXT NOT NULL DEFAULT '',
 deposit_received INTEGER NOT NULL DEFAULT 0 CHECK(deposit_received IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), CHECK(ends_at > starts_at)
) STRICT;
CREATE TABLE quotes (
 id TEXT PRIMARY KEY NOT NULL, tour_id TEXT NOT NULL REFERENCES tours(id), total_minor INTEGER NOT NULL CHECK(total_minor > 0 AND total_minor <= 10000000000),
 deposit_minor INTEGER NOT NULL CHECK(deposit_minor >= 0 AND deposit_minor <= total_minor), currency TEXT NOT NULL DEFAULT 'LKR' CHECK(currency='LKR'),
 terms TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','SUPERSEDED')), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE UNIQUE INDEX one_accepted_quote ON quotes(tour_id) WHERE status='ACCEPTED';
CREATE TABLE interests (tour_id TEXT NOT NULL REFERENCES tours(id), driver_id TEXT NOT NULL REFERENCES driver_profiles(user_id), vehicle_id TEXT NOT NULL REFERENCES vehicles(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY(tour_id,driver_id)) STRICT;
CREATE TABLE assignments (
 id TEXT PRIMARY KEY NOT NULL, tour_id TEXT NOT NULL REFERENCES tours(id), driver_id TEXT NOT NULL REFERENCES driver_profiles(user_id), vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
 assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at TEXT, end_reason TEXT, sent_at TEXT, sent_key TEXT,
 release_phone INTEGER NOT NULL DEFAULT 0 CHECK(release_phone IN (0,1)), acknowledged_at TEXT, withdrawal_reason TEXT,
 trip_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(trip_snapshot)), end_kind TEXT CHECK(end_kind IN ('REOPENED','CANCELLED'))
) STRICT;
CREATE UNIQUE INDEX one_active_assignment ON assignments(tour_id) WHERE ended_at IS NULL;
CREATE TABLE changes (id TEXT PRIMARY KEY NOT NULL, tour_id TEXT NOT NULL REFERENCES tours(id), actor_id TEXT NOT NULL REFERENCES users(id), request TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REJECTED')), response TEXT, acknowledged_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;
CREATE TABLE ratings (
 id TEXT PRIMARY KEY NOT NULL, tour_id TEXT NOT NULL REFERENCES tours(id), author_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id),
 score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(tour_id,author_id,target_id)
) STRICT;
CREATE TABLE settlements (
 id TEXT PRIMARY KEY NOT NULL, tour_id TEXT NOT NULL UNIQUE REFERENCES tours(id), amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0 AND amount_minor <= 10000000000),
 note TEXT NOT NULL DEFAULT '', agent_confirmed_at TEXT, driver_confirmed_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE settlement_events (id TEXT PRIMARY KEY NOT NULL, settlement_id TEXT NOT NULL REFERENCES settlements(id), actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;
CREATE TABLE notifications (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, resource_id TEXT, read_at TEXT,
 push_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(push_status IN ('PENDING','DELIVERED','UNAVAILABLE','FAILED')), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 push_attempts INTEGER NOT NULL DEFAULT 0, next_push_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 resource_kind TEXT NOT NULL DEFAULT 'TOUR' CHECK(resource_kind IN ('TOUR','MEMBERSHIP','ACCOUNT','GENERAL'))
) STRICT;
CREATE TABLE push_tokens (user_id TEXT NOT NULL REFERENCES users(id), token TEXT NOT NULL UNIQUE, PRIMARY KEY(user_id,token)) STRICT;
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY NOT NULL, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource_id TEXT, reason TEXT NOT NULL DEFAULT '',
 metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX tours_agent_status ON tours(agent_id,status);
CREATE INDEX tours_tourist ON tours(tourist_id,created_at DESC);
CREATE INDEX memberships_driver ON memberships(driver_id,status);
CREATE INDEX assignments_driver ON assignments(driver_id) WHERE ended_at IS NULL;
CREATE INDEX assignment_history ON assignments(driver_id,assigned_at DESC);
CREATE INDEX notifications_user ON notifications(user_id,created_at DESC);
CREATE INDEX push_pending ON notifications(next_push_at) WHERE push_status <> 'DELIVERED';
CREATE INDEX audit_resource ON audit_logs(resource_id,created_at DESC);
CREATE INDEX ratings_target ON ratings(target_id);
