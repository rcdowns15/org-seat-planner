-- Custom migration (hand-written). app.seat_changes is append-only (D-010): history can't be
-- rewritten, and undo is a reversing INSERT. BR-07 adds grants so the app's role can't even try.

-- 1. Any UPDATE or DELETE of a row raises.
CREATE FUNCTION app.seat_changes_block_modify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.seat_changes is append-only: % is not allowed (insert a reversing row instead)', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER seat_changes_no_update_delete
  BEFORE UPDATE OR DELETE ON app.seat_changes
  FOR EACH ROW EXECUTE FUNCTION app.seat_changes_block_modify();
--> statement-breakpoint

-- 2. TRUNCATE skips row triggers, so a statement trigger blocks it too, with one narrow escape:
-- the seed (`pnpm db:seed`) wipes and reseeds inside one transaction that first runs
--   SET LOCAL app.allow_seat_changes_reset = 'on';
-- SET LOCAL lasts only until that transaction ends. It guards against accidents, not a determined
-- owner (who could drop the trigger); BR-07's grants are the access control.
CREATE FUNCTION app.seat_changes_block_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.allow_seat_changes_reset', true), '') <> 'on' THEN
    RAISE EXCEPTION 'app.seat_changes is append-only: TRUNCATE is only allowed for the seed reset (SET LOCAL app.allow_seat_changes_reset = ''on'')';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER seat_changes_no_truncate
  BEFORE TRUNCATE ON app.seat_changes
  FOR EACH STATEMENT EXECUTE FUNCTION app.seat_changes_block_truncate();
