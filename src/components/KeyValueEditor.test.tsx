// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import KeyValueEditor from './KeyValueEditor';
import { row } from '../lib/model';
import type { KeyValue } from '../lib/types';

function Harness({
  initial = [row('page', '1'), row('limit', '20')],
  kind = 'parameter',
}: {
  initial?: KeyValue[];
  kind?: 'parameter' | 'variable';
}) {
  const [rows, setRows] = useState(initial);
  return <KeyValueEditor rows={rows} onChange={setRows} kind={kind} />;
}
afterEach(cleanup);

describe('reference parameter grid', () => {
  it('has a labeled header, selectable rows, and an inline blank entry row', () => {
    render(<Harness />);
    expect(screen.getByText('Key')).toBeTruthy();
    expect(screen.getByText('Value')).toBeTruthy();
    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByLabelText('Enable all parameters')).toHaveProperty('checked', true);
    expect(screen.getByPlaceholderText('Add parameter key')).toBeTruthy();
    expect(screen.getByPlaceholderText('Add value')).toBeTruthy();
    expect(screen.getByPlaceholderText('Add description')).toBeTruthy();
  });
  it('toggles all rows and reflects a mixed enabled state without changing values', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Enable parameter 2'));
    expect(screen.getByLabelText('Enable all parameters')).toHaveProperty('indeterminate', true);
    fireEvent.click(screen.getByLabelText('Enable all parameters'));
    expect(screen.getByLabelText('Enable parameter 1')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Enable parameter 2')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByLabelText('Enable all parameters'));
    expect(screen.getByLabelText('Enable parameter 1')).toHaveProperty('checked', false);
    expect(screen.getByLabelText('Enable parameter 2')).toHaveProperty('checked', false);
    expect(screen.getByLabelText('parameter value 1')).toHaveProperty('value', '1');
  });
  it('materializes an inline row once and preserves focus while typing', () => {
    render(<Harness />);
    const input = screen.getByLabelText('New parameter key');
    input.focus();
    fireEvent.change(input, { target: { value: 'role' } });
    expect(screen.getByLabelText('parameter key 3')).toBe(input);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'role_name' } });
    fireEvent.change(screen.getByLabelText('parameter value 3'), { target: { value: 'admin' } });
    expect(screen.getByLabelText('parameter key 3')).toHaveProperty('value', 'role_name');
    expect(screen.queryByLabelText('parameter key 4')).toBeNull();
    expect(screen.getByLabelText('New parameter key')).toHaveProperty('value', '');
  });
  it('provides real duplicate and remove actions from the row ellipsis', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('parameter actions 1'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate parameter' }));
    expect(screen.getByLabelText('parameter key 2')).toHaveProperty('value', 'page');
    expect(screen.getByLabelText('parameter key 3')).toHaveProperty('value', 'limit');
    fireEvent.click(screen.getByLabelText('parameter actions 2'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove parameter 2' }));
    expect(screen.getByLabelText('parameter key 2')).toHaveProperty('value', 'limit');
    expect(screen.queryByLabelText('parameter key 3')).toBeNull();
  });
  it('keeps credential-like variables visibly session-only', () => {
    render(<Harness initial={[row('api_key', 'private-value')]} kind="variable" />);
    expect(screen.getByLabelText('variable value 1')).toHaveProperty('type', 'password');
    expect(screen.getByLabelText('Credential variable is session-only')).toHaveProperty(
      'disabled',
      true,
    );
  });
});
