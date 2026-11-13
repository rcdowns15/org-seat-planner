{{ config(severity='warn') }}

-- Backstop for the move service's rule (D-037, LR-02-10): a change must not have an effective date
-- earlier than a change saved before it (lower change_id) on the same seat or the same worker.
-- Warn, not error: a violation means the app let bad data in, and the models still run on it
-- (they order by effective_date, change_id). Returns one row per offending change.

with changes as (

    select change_id, seat_id, worker_id, effective_date
    from {{ ref('stg_app__seat_changes') }}

),

by_seat as (

    select later.change_id, 'seat' as subject_kind, later.seat_id::text as subject
    from changes as later
    inner join changes as earlier
        on earlier.seat_id = later.seat_id
        and earlier.change_id < later.change_id
        and earlier.effective_date > later.effective_date

),

by_worker as (

    select later.change_id, 'worker' as subject_kind, later.worker_id as subject
    from changes as later
    inner join changes as earlier
        on earlier.worker_id = later.worker_id
        and earlier.change_id < later.change_id
        and earlier.effective_date > later.effective_date

)

select distinct change_id, subject_kind, subject from by_seat
union
select distinct change_id, subject_kind, subject from by_worker
