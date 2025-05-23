import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';

export function AuthView() {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    role: 'guardian'
  });
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    
    const endpoint = isLogin ? 'login' : 'register';
    console.log('Отправляем запрос на:', endpoint);
    console.log('Данные формы:', formData);

    try {
      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      console.log('Статус ответа:', response.status);
      const data = await response.json();
      console.log('Ответ сервера:', data);

      if (!response.ok) {
        throw new Error(data.message || 'Ошибка при авторизации');
      }

      localStorage.clear();

      localStorage.setItem('token', data.token);
      localStorage.setItem('role', data.user.role);
      localStorage.setItem('userId', data.user.id);

      if (data.user.role === 'guardian') {
        navigate('/guardian');
      } else {
        navigate('/dependent');
      }
    } catch (error) {
      console.error('Ошибка:', error);
      setError(error.message);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <main style={{ maxWidth: '400px', margin: '0 auto', padding: '20px' }}>
      <header>
        <h1 style={{ 
          textAlign: 'center',
          marginBottom: '1.5rem',
          color: '#2c3e50',
          fontSize: '24px',
          fontWeight: '600'
        }}>
          {isLogin ? 'Вход в систему' : 'Регистрация'}
        </h1>
      </header>
      
      {error && (
        <div role="alert" style={{ 
          color: '#dc2626', 
          marginBottom: '10px',
          padding: '10px',
          backgroundColor: '#fee2e2',
          borderRadius: '4px',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      <section>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#333' }}>
              Имя:
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ced4da'
                }}
              />
            </label>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#333' }}>
              Пароль:
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ced4da'
                }}
              />
            </label>
          </div>

          {!isLogin && (
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', color: '#333' }}>
                Роль:
                <select
                  name="role"
                  value={formData.role}
                  onChange={handleChange}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #ced4da'
                  }}
                >
                  <option value="guardian">Опекун</option>
                  <option value="dependent">Подопечный</option>
                </select>
              </label>
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: '#1976d2',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '500'
            }}
          >
            {isLogin ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>
      </section>

      <footer style={{ marginTop: '15px', textAlign: 'center' }}>
        <button
          onClick={() => setIsLogin(!isLogin)}
          style={{
            background: 'none',
            border: 'none',
            color: '#0d47a1',
            cursor: 'pointer',
            textDecoration: 'underline',
            fontSize: '16px',
            fontWeight: '500',
            padding: '0'
          }}
        >
          {isLogin ? 'Создать аккаунт' : 'Уже есть аккаунт? Войти'}
        </button>
      </footer>
    </main>
  );
} 