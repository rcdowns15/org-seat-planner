-- Who held which seat, and when: one row per (seat, worker, period), built from the audit log plus
-- the current seat holders. Periods are half-open [start_date, end_date); a null end_date means
-- still holding. Used to check that a worker never holds two seats at once, on any date.
--
-- Three sources of periods:
--   1. a change's to_worker_id holds the seat from its effective date until the seat's next change;
--   2. the first change's from_worker_id held the seat from the beginning of time until that change;
--   3. a seat never changed is held by its current worker since the beginning of time.
-- "Beginning of time" is 1900-01-01.
-- Changes are ordered by (effective_date, change_id). The move service rejects an effective date
-- earlier than a pending change (D-037), so effective order and save order agree.

with changes as (

    select
        seat_id,
        from_worker_id,
        to_worker_id,
        effective_date,
        row_number() over (partition by seat_id order by effective_date, change_id) as change_seq,
        lead(effective_date) over (partition by seat_id order by effective_date, change_id) as next_effective_date
    from {{ ref('stg_app__seat_changes') }}

),

held_after_change as (

    select
        seat_id,
        to_worker_id as worker_id,
        effective_date as start_date,
        next_effective_date as end_date
    from changes
    where to_worker_id is not null

),

held_before_first_change as (

    select
        seat_id,
        from_worker_id as worker_id,
        date '1900-01-01' as start_date,
        effective_date as end_date
    from changes
    where change_seq = 1
      and from_worker_id is not null

),

held_without_changes as (

    select
        seats.seat_id,
        seats.worker_id,
        date '1900-01-01' as start_date,
        null::date as end_date
    from {{ ref('stg_app__seats') }} as seats
    where seats.worker_id is not null
      and not exists (select 1 from changes where changes.seat_id = seats.seat_id)

),

all_periods as (

    select * from held_after_change
    union all
    select * from held_before_first_change
    union all
    select * from held_without_changes

)

-- A period that starts and ends on the same day never held the seat for any time.
select seat_id, worker_id, start_date, end_date
from all_periods
where end_date is null or start_date < end_date
