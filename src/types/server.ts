export interface VpsConnection {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  notes?: string;
  tags?: string;
  created_at: string;
  last_tested?: string;
  last_status: 'online' | 'offline' | 'unknown';
}
