import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { loadPebble } from './lib/pebble';
import './styles.css';

const root = createRoot(document.getElementById('root'));
// Pebble, the app's own typeface, is built in the browser first (about 50 ms) so the very first screen already uses it.
Promise.race([loadPebble(), new Promise((r) => setTimeout(r, 1500))]).finally(() => root.render(<ErrorBoundary><App /></ErrorBoundary>));
