import { Fragment, useMemo } from 'react';
const tokenPattern =
  /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi;
function highlighted(line: string, json: boolean) {
  if (!json) return line;
  return line
    .split(tokenPattern)
    .map((part, i) => (
      <Fragment key={i}>
        {/^"/.test(part) ? (
          <span className={/:$/.test(part) ? 'token-key' : 'token-string'}>{part}</span>
        ) : /^(true|false|null)$/.test(part) ? (
          <span className="token-literal">{part}</span>
        ) : /^-?\d/.test(part) ? (
          <span className="token-number">{part}</span>
        ) : (
          part
        )}
      </Fragment>
    ));
}
export default function CodeViewer({
  text,
  json = true,
  wrap = false,
  search = '',
}: {
  text: string;
  json?: boolean;
  wrap?: boolean;
  search?: string;
}) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const shown = lines.slice(0, 2000);
  return (
    <div className={`code-viewer ${wrap ? 'wrap' : ''}`} tabIndex={0} aria-label="Response body">
      {shown.map((line, i) => (
        <div
          className={`code-line ${search && line.toLowerCase().includes(search.toLowerCase()) ? 'search-match' : ''}`}
          key={i}
        >
          <span className="line-number" aria-hidden="true">
            {i + 1}
          </span>
          <code>{highlighted(line, json)}</code>
        </div>
      ))}
      {lines.length > 2000 && (
        <div className="code-limit">
          Showing the first 2,000 lines. Copy or export the response to read all{' '}
          {lines.length.toLocaleString()} lines.
        </div>
      )}
    </div>
  );
}
