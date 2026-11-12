{#
  Use the schema a model configures (analytics_staging, analytics_intermediate, analytics)
  exactly as written. dbt's default would prefix it with the target schema
  (analytics_analytics_staging), which we don't want.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
