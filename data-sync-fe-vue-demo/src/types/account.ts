export interface Account {
  id?: string | number;
  key: string;
  name: string;
  mode: string;
  status: 'active' | 'expired';
  shopId?: string;
  isActive?: boolean;
  module?: string;
  userId?: string;
  shareScope?: 'company' | 'private';
}

export interface SharedAccount {
  id: string;
  key?: string;
  name: string;
  mode?: string;
  status?: 'active' | 'expired';
  shopId?: string;
  module?: string;
  shareScope?: 'company' | 'private';
}

export interface SyncLog {
  id: number | string;
  logKey: string;
  taskId?: string;
  transactionId?: string;
  syncModule?: string;
  accountName?: string;
  shopId?: string;
  pageToken?: string;
  nextPageToken?: string;
  recordCount?: number;
  hasMore?: number | boolean;
  status: 'running' | 'success' | 'failed';
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface SyncLogListResponse {
  list: SyncLog[];
  total: number;
  page: number;
  pageSize: number;
}
