{# Trim leading and trailing spaces, tabs, newlines, no-break spaces and the byte-order mark.
   Postgres trim() strips spaces only. Does not turn '' into null; wrap in nullif() where blank
   should be null. #}
{% macro clean_text(col) -%}
regexp_replace({{ col }}, '^[\s\u00a0\ufeff]+|[\s\u00a0\ufeff]+$', '', 'g')
{%- endmacro %}
