{{ config(severity='error') }}

-- A squad's filled seats plus accepted offers must not exceed its approved seats for the quarter.
-- Same thing as variance > 0 in rpt_squad_headcount. Singular, not generic: it is tied to one
-- model's columns and has one use. Returns the squads and report dates that are over plan.

select
    squad_id,
    report_date,
    filled_employee_seats + filled_contingent_seats + offer_accepted_seats as committed_seats,
    approved_seats
from {{ ref('rpt_squad_headcount') }}
where filled_employee_seats + filled_contingent_seats + offer_accepted_seats > approved_seats
