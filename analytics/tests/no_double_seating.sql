{{ config(severity='error') }}

-- A worker holds at most one seat at a time, on every date in history (CLAUDE.md domain rules).
-- Singular, not generic: it checks one model (int_seat_occupancy) with logic that no other model reuses.
-- Returns one row per pair of seats the same worker held during overlapping periods.
-- Periods are half-open [start_date, end_date); a null end_date means still holding.

select
    a.worker_id,
    a.seat_id as seat_id_a,
    b.seat_id as seat_id_b,
    greatest(a.start_date, b.start_date) as overlap_start
from {{ ref('int_seat_occupancy') }} as a
inner join {{ ref('int_seat_occupancy') }} as b
    on a.worker_id = b.worker_id
    and a.seat_id < b.seat_id
    and a.start_date < coalesce(b.end_date, date '9999-12-31')
    and b.start_date < coalesce(a.end_date, date '9999-12-31')
