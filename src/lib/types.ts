export type KeyValue = {
  id?: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  secret?: boolean;
};
export type Auth = {
  type: 'none' | 'bearer' | 'basic' | 'apiKey';
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  location?: 'header' | 'query';
};
export type HttpRequest = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  bodyType: 'none' | 'json' | 'text' | 'form';
  body: string;
  auth: Auth;
  timeoutMs: number;
  followRedirects: boolean;
  folder?: string;
};
export type HttpResponse = {
  requestId: string;
  status: number;
  statusText: string;
  headers: { key: string; value: string }[];
  body: string;
  durationMs: number;
  sizeBytes: number;
  url: string;
  truncated: boolean;
  contentType: string;
};
export type Environment = { id: string; name: string; variables: KeyValue[] };
export type HistoryEntry = {
  id: string;
  request: HttpRequest;
  createdAt: string;
  status?: number;
  durationMs?: number;
  error?: string;
};
export type Workspace = {
  version: 1;
  saved: HttpRequest[];
  folders: string[];
  history: HistoryEntry[];
  environments: Environment[];
  activeEnvironmentId: string;
};
export type RequestTab = { request: HttpRequest; response?: HttpResponse; error?: string };
