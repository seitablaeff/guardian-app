import { Routes, Route, Navigate } from "react-router-dom";
import { GuardianView } from "./components/GuardianView";
import { DependentView } from "./components/DependentView";
import { AuthView } from "./components/AuthView";
import { useEffect, useState } from "react";

function OfflineHandler({ children }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      console.log('Соединение восстановлено');
      setIsOnline(true);
    };

    const handleOffline = () => {
      console.log('Соединение потеряно');
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <>
      {!isOnline && (
        <div role="alert" style={{ 
          backgroundColor: '#fff3cd', 
          color: '#856404',
          padding: '10px',
          borderRadius: '4px',
          marginBottom: '1rem',
          textAlign: 'center'
        }}>
          <h2 style={{ 
            margin: '0 0 10px 0',
            fontSize: '18px',
            color: '#856404'
          }}>Работа в офлайн-режиме</h2>
        </div>
      )}
      {children}
    </>
  );
}

function ProtectedRoute({ children, requiredRole }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    
    if (token && role) {
      setIsAuthenticated(true);
      setUserRole(role);
    }
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return <div>Загрузка...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" />;
  }

  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to={userRole === 'guardian' ? '/guardian' : '/dependent'} />;
  }

  return children;
}

export default function App() {
  return (
    <div style={{ 
      padding: '20px',
      maxWidth: '1200px',
      width: '100%',
      boxSizing: 'border-box'
    }}>
      <OfflineHandler>
        <Routes>
          <Route path="/auth" element={<AuthView />} />
          <Route 
            path="/guardian" 
            element={
              <ProtectedRoute requiredRole="guardian">
                <GuardianView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dependent" 
            element={
              <ProtectedRoute requiredRole="dependent">
                <DependentView />
              </ProtectedRoute>
            } 
          />
          <Route path="/" element={<Navigate to="/auth" />} />
        </Routes>
      </OfflineHandler>
    </div>
  );
}