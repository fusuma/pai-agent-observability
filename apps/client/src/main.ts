import { createApp, defineAsyncComponent } from 'vue'
import './styles/main.css'
import './styles/themes.css'
import './styles/compact.css'
import App from './App.vue'

// Simple hash-based routing
const TerminalPage = defineAsyncComponent(() => import('./pages/TerminalPage.vue'));

const path = window.location.pathname;

if (path === '/terminal') {
  createApp(TerminalPage).mount('#app');
} else {
  createApp(App).mount('#app');
}
