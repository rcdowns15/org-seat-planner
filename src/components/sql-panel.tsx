import type { PanelSection, QueryResult, UnderTheHood } from "@/server/queries/under-the-hood";
import type { SaveLogEntry } from "@/server/sql-log";

// "Under the hood" (LR-02-08): the preset queries behind the board, with their SQL, bound values
// and results, and the SQL the last save ran. A server component: it only displays data the page
// already loaded. There is no input of any kind (D-026).

function ResultTable({ result, testId }: { result: QueryResult; testId: string }) {
  if (!result.ok) {
    return (
      <p role="alert" data-testid={`${testId}-error`} className="text-sm font-medium">
        {result.message}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table data-testid={`${testId}-table`} className="w-full text-left text-xs">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} scope="col" className="border-b px-2 py-1 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} data-testid={`${testId}-row`}>
              {row.map((value, j) => (
                <td key={j} data-col={result.columns[j]} className="border-b px-2 py-1">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated ? (
        <p className="text-muted-foreground mt-1 text-xs">Showing the first 200 rows.</p>
      ) : null}
    </div>
  );
}

function Section({ section }: { section: PanelSection }) {
  const testId = `sql-${section.key}`;
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`} className="mt-5">
      <h3 id={`${testId}-title`} className="text-sm font-semibold">
        {section.title}
      </h3>
      <p className="text-muted-foreground text-xs">{section.description}</p>
      <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 text-xs">{section.sql}</pre>
      {section.params.length > 0 ? (
        <p className="text-muted-foreground mt-1 text-xs">
          Bound values:{" "}
          {section.params.map((p, i) => (
            <code key={i}>
              {`$${i + 1} = ${p}`}
              {i < section.params.length - 1 ? ", " : ""}
            </code>
          ))}
        </p>
      ) : null}
      <div className="mt-2">
        {section.empty ? (
          <p data-testid={`${testId}-empty`} className="text-muted-foreground text-sm">
            {section.empty}
          </p>
        ) : section.result ? (
          <ResultTable result={section.result} testId={testId} />
        ) : null}
      </div>
    </section>
  );
}

function LastSave({ save }: { save: SaveLogEntry | null }) {
  return (
    <section data-testid="sql-last-save" aria-labelledby="sql-last-save-title" className="mt-5">
      <h3 id="sql-last-save-title" className="text-sm font-semibold">
        Last save: SQL executed
      </h3>
      {save === null ? (
        <p data-testid="sql-last-save-empty" className="text-muted-foreground text-sm">
          No save since the server started. Move a worker to see the statements it ran.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {save.action} at {save.at}: {save.ok ? "saved" : `rejected (${save.code})`}. Values are
            bound parameters, shown after each statement.
          </p>
          <ol className="mt-2 flex flex-col gap-2">
            {save.statements.map((s, i) => (
              <li key={i} data-testid="sql-last-save-statement">
                <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">{s.sql}</pre>
                {s.params.length > 0 ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Values: <code>{JSON.stringify(s.params)}</code>
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function SqlPanelBody({ data }: { data: UnderTheHood }) {
  const bySection = (key: string) => data.sections.find((s) => s.key === key)!;
  return (
    <div>
      <LastSave save={data.lastSave} />
      <Section section={bySection("last_move_impact")} />
      <Section section={bySection("seat")} />
      <Section section={bySection("worker")} />
      <Section section={bySection("recent_changes")} />
      <Section section={bySection("plan_gaps")} />
    </div>
  );
}

// The collapsible version on the board.
export function SqlPanel({ data }: { data: UnderTheHood }) {
  return (
    <details data-testid="sql-panel" className="mt-6 rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Under the hood: the SQL behind this board (read-only)
      </summary>
      <SqlPanelBody data={data} />
    </details>
  );
}
