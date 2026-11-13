import { captureShell } from './store.js';
// Take the document snapshot before anything touches the DOM.
captureShell();
import { createRoot } from 'react-dom/client';
import App from './app.jsx';
createRoot(document.getElementById('root')).render(<App />);
