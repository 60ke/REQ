import { useState } from 'react';
import { Copy, Eye, EyeOff, MoreHorizontal, Trash2 } from 'lucide-react';
import { row, secretPattern, uid } from '../lib/model';
import type { KeyValue } from '../lib/types';

type Props = {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  kind?: 'parameter' | 'header' | 'variable';
};

export default function KeyValueEditor({ rows, onChange, kind = 'parameter' }: Props) {
  const [draft, setDraft] = useState<KeyValue>(() => ({ ...row(), enabled: false }));
  const [actionRow, setActionRow] = useState<string | null>(null);
  const allEnabled = rows.length > 0 && rows.every((item) => item.enabled);
  const mixedEnabled = rows.some((item) => item.enabled) && !allEnabled;

  const update = (index: number, patch: Partial<KeyValue>) => {
    if (index === rows.length) {
      onChange([...rows, { ...draft, ...patch, enabled: patch.enabled ?? true }]);
      setDraft({ ...row(), enabled: false });
    } else {
      onChange(rows.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    }
  };

  return (
    <div className={`kv-editor kv-grid ${kind === 'variable' ? 'variables-grid' : ''}`}>
      <div className="kv-columns">
        <div className="kv-cell check-cell">
          <input
            type="checkbox"
            className="checkbox"
            aria-label={`Enable all ${kind}s`}
            checked={allEnabled}
            ref={(input) => {
              if (input) input.indeterminate = mixedEnabled;
            }}
            onChange={(event) =>
              onChange(rows.map((item) => ({ ...item, enabled: event.target.checked })))
            }
          />
        </div>
        <div className="kv-cell key-cell">Key</div>
        <div className="kv-cell value-cell">Value</div>
        <div className="kv-cell description-cell">Description</div>
        <div className="kv-cell action-cell" />
      </div>
      {[...rows, draft].map((item, index) => {
        const isDraft = index === rows.length;
        const id = item.id ?? String(index);
        const knownSecret = kind === 'variable' && secretPattern.test(item.key);
        const isSecret = item.secret || knownSecret;
        return (
          <div
            className={`kv-row ${isDraft ? 'new-kv-row' : item.enabled ? '' : 'disabled'}`}
            key={id}
          >
            <div className="kv-cell check-cell">
              <input
                aria-label={isDraft ? `Add ${kind}` : `Enable ${kind} ${index + 1}`}
                className="checkbox"
                type="checkbox"
                checked={item.enabled}
                onChange={(event) => update(index, { enabled: event.target.checked })}
              />
            </div>
            <div className="kv-cell key-cell">
              <input
                aria-label={isDraft ? `New ${kind} key` : `${kind} key ${index + 1}`}
                className="kv-input"
                spellCheck={false}
                placeholder={isDraft ? `Add ${kind} key` : 'Key'}
                value={item.key}
                onChange={(event) =>
                  update(index, {
                    key: event.target.value,
                    ...(kind === 'variable' && secretPattern.test(event.target.value)
                      ? { secret: true }
                      : {}),
                  })
                }
              />
            </div>
            <div className="kv-cell value-cell">
              <div className="secret-input">
                <input
                  aria-label={isDraft ? `New ${kind} value` : `${kind} value ${index + 1}`}
                  className="kv-input"
                  spellCheck={false}
                  type={isSecret ? 'password' : 'text'}
                  placeholder={isDraft ? 'Add value' : isSecret ? 'Session-only value' : 'Value'}
                  value={item.value}
                  onChange={(event) => update(index, { value: event.target.value })}
                />
                {kind === 'variable' && !isDraft && (
                  <button
                    className={`icon-button secret-toggle ${isSecret ? 'active' : ''}`}
                    aria-label={
                      knownSecret
                        ? 'Credential variable is session-only'
                        : isSecret
                          ? 'Make variable non-secret'
                          : 'Mark variable as secret'
                    }
                    title={
                      knownSecret
                        ? 'Credential-like names are always session-only'
                        : isSecret
                          ? 'Secret: not saved to disk'
                          : 'Mark as secret'
                    }
                    disabled={knownSecret}
                    onClick={() => update(index, { secret: !item.secret })}
                  >
                    {isSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
            </div>
            <div className="kv-cell description-cell">
              <input
                aria-label={
                  isDraft ? `New ${kind} description` : `${kind} description ${index + 1}`
                }
                className="description-input"
                placeholder={isDraft ? 'Add description' : 'Description'}
                value={item.description ?? ''}
                onChange={(event) => update(index, { description: event.target.value })}
              />
            </div>
            <div className="kv-cell action-cell">
              {!isDraft && (
                <div className="row-action-anchor">
                  <button
                    className="icon-button row-menu-button"
                    aria-label={`${kind} actions ${index + 1}`}
                    aria-expanded={actionRow === id}
                    aria-haspopup="menu"
                    onClick={() => setActionRow(actionRow === id ? null : id)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {actionRow === id && (
                    <>
                      <div className="menu-dismiss" onClick={() => setActionRow(null)} />
                      <div className="dropdown-menu row-dropdown" role="menu">
                        <button
                          role="menuitem"
                          onClick={() => {
                            const next = [...rows];
                            next.splice(index + 1, 0, { ...item, id: uid() });
                            onChange(next);
                            setActionRow(null);
                          }}
                        >
                          <Copy size={14} />
                          Duplicate {kind}
                        </button>
                        <button
                          role="menuitem"
                          aria-label={`Remove ${kind} ${index + 1}`}
                          onClick={() => {
                            onChange(rows.filter((_, i) => i !== index));
                            setActionRow(null);
                          }}
                        >
                          <Trash2 size={14} />
                          Remove {kind}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
