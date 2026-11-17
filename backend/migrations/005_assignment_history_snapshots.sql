ALTER TABLE assignments ADD COLUMN trip_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE assignments ADD COLUMN end_kind text CHECK(end_kind IN ('REOPENED','CANCELLED'));
-- Historical revoked rows cannot safely reconstruct an earlier pickup. Leave them empty.
UPDATE assignments a SET trip_snapshot=jsonb_build_object('pickup',t.pickup,'destination',t.destination,'starts_at',t.starts_at,'ends_at',t.ends_at,'vehicle_type',t.vehicle_type,'passengers',t.passengers)
  FROM tours t WHERE a.tour_id=t.id AND a.ended_at IS NULL;
UPDATE assignments a SET end_kind=CASE WHEN t.status='CANCELLED' THEN 'CANCELLED' ELSE 'REOPENED' END
  FROM tours t WHERE a.tour_id=t.id AND a.ended_at IS NOT NULL;
