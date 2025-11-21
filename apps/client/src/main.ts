import { createApp, defineAsyncComponent } from 'vue'
import './styles/main.css'
import './styles/themes.css'
import './styles/compact.css'
import App from './App.vue'

// Simple path-based routing
const TerminalPage = defineAsyncComponent(() => import('./pages/TerminalPage.vue'));

const path = window.location.pathname.replace(/\/$/, '') || '/';

console.log('Current path:', path);

if (path === '/terminal') {
  console.log('Loading terminal page');
  createApp(TerminalPage).mount('#app');
} else {
  console.log('Loading main app');
  createApp(App).mount('#app');
}
