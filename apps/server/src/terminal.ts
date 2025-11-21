import * as pty from 'node-pty';

// Store active terminal sessions
const terminals = new Map<string, pty.IPty>();

// Environment variable for terminal password
const TERMINAL_PASSWORD = process.env.TERMINAL_PASSWORD || '';

export interface TerminalMessage {
  type: 'auth' | 'input' | 'resize';
  password?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalResponse {
  type: 'auth_required' | 'auth_success' | 'auth_failed' | 'output' | 'exit';
  data?: string;
  code?: number;
}

export function createTerminalSession(
  sessionId: string,
  onData: (data: string) => void,
  onExit: (code: number) => void
): pty.IPty {
  // Spawn shell with claude available
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: process.env.HOME || '/root',
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  term.onData(onData);
  term.onExit(({ exitCode }) => {
    terminals.delete(sessionId);
    onExit(exitCode);
  });

  terminals.set(sessionId, term);
  return term;
}

export function getTerminal(sessionId: string): pty.IPty | undefined {
  return terminals.get(sessionId);
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  const term = terminals.get(sessionId);
  if (term) {
    term.resize(cols, rows);
  }
}

export function writeToTerminal(sessionId: string, data: string): void {
  const term = terminals.get(sessionId);
  if (term) {
    term.write(data);
  }
}

export function closeTerminal(sessionId: string): void {
  const term = terminals.get(sessionId);
  if (term) {
    term.kill();
    terminals.delete(sessionId);
  }
}

export function isPasswordRequired(): boolean {
  return TERMINAL_PASSWORD.length > 0;
}

export function validatePassword(password: string): boolean {
  if (!isPasswordRequired()) {
    return true;
  }
  return password === TERMINAL_PASSWORD;
}
