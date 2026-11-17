CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('TOURIST','AGENT','DRIVER','ADMIN')),
 status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
 name text NOT NULL, phone text NOT NULL DEFAULT '', bio text NOT NULL DEFAULT '',
 photo_url text, token_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_profiles (user_id uuid PRIMARY KEY REFERENCES users(id), agency_name text NOT NULL, location text NOT NULL DEFAULT 'Sri Lanka');
CREATE TABLE driver_profiles (user_id uuid PRIMARY KEY REFERENCES users(id), licence_number text NOT NULL DEFAULT '', licence_expiry date);
CREATE TABLE memberships (
 id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES agent_profiles(user_id), driver_id uuid NOT NULL REFERENCES driver_profiles(user_id),
 status text NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REJECTED','REMOVED')), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(agent_id,driver_id)
);
CREATE TABLE vehicles (
 id uuid PRIMARY KEY, driver_id uuid NOT NULL REFERENCES driver_profiles(user_id), type text NOT NULL CHECK(type IN ('CAR','VAN','KDH')),
 registration text NOT NULL UNIQUE, model text NOT NULL, seats integer NOT NULL CHECK(seats BETWEEN 1 AND 60), approved boolean NOT NULL DEFAULT false
);
CREATE TABLE media (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), vehicle_id uuid REFERENCES vehicles(id),
 kind text NOT NULL CHECK(kind IN ('DOCUMENT','VEHICLE_PHOTO','PROFILE_PHOTO')), public_id text NOT NULL UNIQUE,
 url text, approved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='DOCUMENT' AND url IS NULL) OR kind<>'DOCUMENT')
);
CREATE TABLE tours (
 id uuid PRIMARY KEY, tourist_id uuid NOT NULL REFERENCES users(id), agent_id uuid NOT NULL REFERENCES agent_profiles(user_id),
 pickup text NOT NULL, destination text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 vehicle_type text NOT NULL CHECK(vehicle_type IN ('CAR','VAN','KDH')), passengers integer NOT NULL CHECK(passengers BETWEEN 1 AND 60), notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','QUOTED','ACCEPTED','OPEN','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
 payout_minor bigint CHECK(payout_minor >= 0 AND payout_minor <= 10000000000), collector text CHECK(collector IN ('AGENT','DRIVER')),
 collection_minor bigint CHECK(collection_minor >= 0 AND collection_minor <= 10000000000), instructions text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at > starts_at)
);
CREATE TABLE quotes (
 id uuid PRIMARY KEY, tour_id uuid NOT NULL REFERENCES tours(id), total_minor bigint NOT NULL CHECK(total_minor > 0 AND total_minor <= 10000000000),
 deposit_minor bigint NOT NULL CHECK(deposit_minor >= 0 AND deposit_minor <= total_minor), currency text NOT NULL DEFAULT 'LKR' CHECK(currency='LKR'),
 terms text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','SUPERSEDED')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_accepted_quote ON quotes(tour_id) WHERE status='ACCEPTED';
CREATE TABLE interests (tour_id uuid REFERENCES tours(id), driver_id uuid REFERENCES driver_profiles(user_id), vehicle_id uuid NOT NULL REFERENCES vehicles(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tour_id,driver_id));
CREATE TABLE assignments (
 id uuid PRIMARY KEY, tour_id uuid NOT NULL REFERENCES tours(id), driver_id uuid NOT NULL REFERENCES driver_profiles(user_id), vehicle_id uuid NOT NULL REFERENCES vehicles(id),
 assigned_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, end_reason text, sent_at timestamptz, sent_key text,
 release_phone boolean NOT NULL DEFAULT false, acknowledged_at timestamptz, withdrawal_reason text
);
CREATE UNIQUE INDEX one_active_assignment ON assignments(tour_id) WHERE ended_at IS NULL;
CREATE TABLE changes (id uuid PRIMARY KEY, tour_id uuid NOT NULL REFERENCES tours(id), actor_id uuid NOT NULL REFERENCES users(id), request text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REJECTED')), response text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ratings (
 id uuid PRIMARY KEY, tour_id uuid NOT NULL REFERENCES tours(id), author_id uuid NOT NULL REFERENCES users(id), target_id uuid NOT NULL REFERENCES users(id),
 score integer NOT NULL CHECK(score BETWEEN 1 AND 5), comment text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tour_id,author_id,target_id)
);
CREATE TABLE settlements (
 id uuid PRIMARY KEY, tour_id uuid NOT NULL UNIQUE REFERENCES tours(id), amount_minor bigint NOT NULL CHECK(amount_minor >= 0 AND amount_minor <= 10000000000),
 note text NOT NULL DEFAULT '', agent_confirmed_at timestamptz, driver_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settlement_events (id uuid PRIMARY KEY, settlement_id uuid NOT NULL REFERENCES settlements(id), actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notifications (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), title text NOT NULL, resource_id uuid, read_at timestamptz,
 push_status text NOT NULL DEFAULT 'PENDING' CHECK(push_status IN ('PENDING','DELIVERED','UNAVAILABLE','FAILED')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_tokens (user_id uuid NOT NULL REFERENCES users(id), token text NOT NULL UNIQUE, PRIMARY KEY(user_id,token));
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL, resource_id uuid, reason text NOT NULL DEFAULT '',
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tours_agent_status ON tours(agent_id,status);
CREATE INDEX tours_tourist ON tours(tourist_id,created_at DESC);
CREATE INDEX memberships_driver ON memberships(driver_id,status);
CREATE INDEX assignments_driver ON assignments(driver_id) WHERE ended_at IS NULL;
CREATE INDEX notifications_user ON notifications(user_id,created_at DESC);
CREATE INDEX audit_resource ON audit_logs(resource_id,created_at DESC);
CREATE INDEX ratings_target ON ratings(target_id);
