{# Trim like JavaScript's String.trim() (the loader's cleaning): leading and trailing whitespace,
   including tabs, newlines, no-break spaces and the byte-order mark. Postgres trim() strips
   spaces only. Does not turn '' into null; wrap in nullif() where blank should be null. #}
{% macro clean_text(col) -%}
regexp_replace({{ col }}, '^[\s ﻿]+|[\s ﻿]+$', '', 'g')
{%- endmacro %}
