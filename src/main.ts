import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { ensureWebMcpInstalled } from './core/webmcp/webmcp-polyfill';

// Ensure WebMCP runtime is globally installed on navigator, window, and document
ensureWebMcpInstalled();

const target = document.getElementById('app');
if (!target) {
  throw new Error('Root target element with id "app" not found.');
}

const app = mount(App, {
  target,
});

export default app;
