CREATE INDEX activities_reading_target ON activities(
  json_extract(detail,'$.detail.source'),
  coalesce(json_extract(detail,'$.readingTarget'),json_extract(detail,'$.detail.items[0].id')),
  made
) WHERE json_extract(detail,'$.detail.kind')='reading';
--> statement-breakpoint
CREATE INDEX self_promise_plan ON memories(json_extract(details,'$.planId'))
  WHERE kind='promise' AND scope='self';
--> statement-breakpoint
CREATE TRIGGER sync_plan_promise AFTER UPDATE OF category,evidence,due,quote ON memories
WHEN NEW.kind='day_plan' AND NEW.scope IN ('public','self')
BEGIN
  UPDATE memories SET category=NEW.category,evidence=NEW.evidence,due=NEW.due,quote=NEW.quote,
    resolved=CASE WHEN NEW.category IN ('done','interrupted') THEN 1 ELSE 0 END,
    closed_by=CASE WHEN NEW.category IN ('done','interrupted') THEN NEW.id END
  WHERE kind='promise' AND scope='self' AND json_extract(details,'$.planId')=NEW.id;
END;
