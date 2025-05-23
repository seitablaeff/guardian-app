import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom'; // Добавьте это
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter> {/* Оберните App в BrowserRouter */}
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Отслеживание офлайн-статуса
window.addEventListener('online', () => {
  // Синхронизация данных с сервером
});