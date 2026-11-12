{# Fails if clean_text stops stripping the no-break space and byte-order mark. #}
select cleaned
from (
    select {{ clean_text("chr(65279) || chr(160) || ' x' || chr(9) || chr(160)") }} as cleaned
) as t
where cleaned <> 'x'
