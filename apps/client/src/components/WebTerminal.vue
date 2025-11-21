<template>
  <div class="terminal-container h-full flex flex-col bg-[#1a1b26]">
    <!-- Password prompt -->
    <div v-if="needsAuth" class="flex-1 flex items-center justify-center">
      <div class="bg-[#24283b] p-6 rounded-lg shadow-lg max-w-sm w-full mx-4">
        <h2 class="text-[#c0caf5] text-lg font-semibold mb-4">Terminal Access</h2>
        <form @submit.prevent="authenticate">
          <input
            v-model="password"
            type="password"
            placeholder="Enter password"
            class="w-full px-3 py-2 bg-[#1a1b26] border border-[#414868] rounded text-[#c0caf5] placeholder-[#565f89] focus:outline-none focus:border-[#7aa2f7]"
            :class="{ 'border-red-500': authError }"
            autofocus
          />
          <p v-if="authError" class="text-red-400 text-sm mt-2">Invalid password</p>
          <button
            type="submit"
            class="w-full mt-4 px-4 py-2 bg-[#7aa2f7] text-[#1a1b26] rounded font-medium hover:bg-[#89b4fa] transition-colors"
          >
            Connect
          </button>
        </form>
      </div>
    </div>

    <!-- Connection status -->
    <div v-else-if="!isConnected" class="flex-1 flex items-center justify-center">
      <div class="text-[#565f89]">
        <span v-if="isConnecting">Connecting to terminal...</span>
        <span v-else>Disconnected. <button @click="connect" class="text-[#7aa2f7] hover:underline">Reconnect</button></span>
      </div>
    </div>

    <!-- Terminal -->
    <div v-show="isConnected && !needsAuth" ref="terminalRef" class="flex-1 p-2"></div>

    <!-- Status bar -->
    <div class="flex items-center justify-between px-3 py-1 bg-[#24283b] text-xs text-[#565f89] border-t border-[#414868]">
      <span>
        <span :class="isConnected ? 'text-green-400' : 'text-red-400'">●</span>
        {{ isConnected ? 'Connected' : 'Disconnected' }}
      </span>
      <span>Claude CLI Terminal</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

interface TerminalMessage {
  type: 'auth' | 'input' | 'resize';
  password?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

interface TerminalResponse {
  type: 'auth_required' | 'auth_success' | 'auth_failed' | 'output' | 'exit';
  data?: string;
  code?: number;
}

const props = defineProps<{
  wsUrl?: string;
}>();

const terminalRef = ref<HTMLElement | null>(null);
const isConnected = ref(false);
const isConnecting = ref(false);
const needsAuth = ref(false);
const authError = ref(false);
const password = ref('');

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;

const getWsUrl = () => {
  if (props.wsUrl) return props.wsUrl;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/terminal`;
};

const initTerminal = () => {
  if (!terminalRef.value || terminal) return;

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(122, 162, 247, 0.3)',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.open(terminalRef.value);
  fitAddon.fit();

  // Handle terminal input
  terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: TerminalMessage = { type: 'input', data };
      ws.send(JSON.stringify(msg));
    }
  });

  // Handle terminal resize
  terminal.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: TerminalMessage = { type: 'resize', cols, rows };
      ws.send(JSON.stringify(msg));
    }
  });

  // Watch for container resize
  resizeObserver = new ResizeObserver(() => {
    if (fitAddon) {
      fitAddon.fit();
    }
  });
  resizeObserver.observe(terminalRef.value);
};

const connect = () => {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  isConnecting.value = true;
  authError.value = false;
  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    console.log('Terminal WebSocket connected');
  };

  ws.onmessage = (event) => {
    try {
      const response: TerminalResponse = JSON.parse(event.data);

      switch (response.type) {
        case 'auth_required':
          needsAuth.value = true;
          isConnecting.value = false;
          break;

        case 'auth_success':
          needsAuth.value = false;
          isConnected.value = true;
          isConnecting.value = false;
          nextTick(() => {
            initTerminal();
            // Send initial resize
            if (terminal && ws && ws.readyState === WebSocket.OPEN) {
              const msg: TerminalMessage = {
                type: 'resize',
                cols: terminal.cols,
                rows: terminal.rows,
              };
              ws.send(JSON.stringify(msg));
              terminal.focus();
            }
          });
          break;

        case 'auth_failed':
          authError.value = true;
          password.value = '';
          break;

        case 'output':
          if (terminal && response.data) {
            terminal.write(response.data);
          }
          break;

        case 'exit':
          terminal?.writeln(`\r\n\x1b[33mProcess exited with code ${response.code}\x1b[0m`);
          break;
      }
    } catch (err) {
      console.error('Failed to parse terminal response:', err);
    }
  };

  ws.onclose = () => {
    console.log('Terminal WebSocket disconnected');
    isConnected.value = false;
    isConnecting.value = false;
  };

  ws.onerror = (error) => {
    console.error('Terminal WebSocket error:', error);
    isConnecting.value = false;
  };
};

const authenticate = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    authError.value = false;
    const msg: TerminalMessage = { type: 'auth', password: password.value };
    ws.send(JSON.stringify(msg));
  }
};

onMounted(() => {
  connect();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  terminal?.dispose();
  ws?.close();
});

// Re-fit terminal when it becomes visible
watch(isConnected, (connected) => {
  if (connected) {
    nextTick(() => {
      fitAddon?.fit();
    });
  }
});
</script>

<style scoped>
.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 4px;
}

.terminal-container :deep(.xterm-viewport) {
  overflow-y: auto !important;
}
</style>
