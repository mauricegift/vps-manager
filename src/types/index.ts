export interface SystemInfo {
  os: { platform: string; distro: string; release: string; arch: string; hostname: string; kernel: string };
  cpu: { manufacturer: string; brand: string; speed: number; cores: number; physicalCores: number; load: number };
  memory: { total: number; used: number; free: number; usedPercent: number };
  disk: Array<{ fs: string; type: string; size: number; used: number; use: number; mount: string }>;
  network: Array<{ iface: string; ip4: string; ip6: string; mac: string }>;
  uptime: number;
  load: { avg1: number; avg5: number; avg15: number };
  temps: Array<{ label: string; main: number }>;
}

export interface PM2Process {
  pid: number;
  name: string;
  pm_id: number;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  pm_exec_path?: string;
  pm_cwd?: string;
  instances?: number;
  mode?: string;
  watching?: boolean;
  created_at?: number;
  port?: string | null;
}

export interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  Status: string;
  State: string;
  Ports: Array<{ PrivatePort: number; PublicPort?: number; Type: string }>;
  Created: number;
  SizeRw?: number;
}

export interface DockerImage {
  Id: string;
  RepoTags: string[];
  Size: number;
  Created: number;
}

export interface DockerCompose {
  name: string;
  path: string;
  services: string[];
  status: string;
  ports?: string[];
}

export interface Database {
  type: 'postgresql' | 'mysql' | 'mongodb' | 'redis' | 'mariadb';
  name: string;
  installed: boolean;
  running: boolean;
  port: number;
  size?: string;
  connections?: number;
  databases?: string[];
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  permissions: string;
  owner: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
