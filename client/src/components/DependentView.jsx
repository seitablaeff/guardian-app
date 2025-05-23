import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL } from '../config';
import { saveTask, getTasks, savePendingChange, getPendingChanges, clearPendingChanges } from '../utils/db';
import { FaCheck, FaTimes, FaBell, FaHome, FaClipboardList, FaExclamationCircle } from 'react-icons/fa';
import { MdDescription, MdDateRange, MdAccessTime, MdPending, MdNotifications } from 'react-icons/md';

export function DependentView() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(true);
  const [userCode, setUserCode] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingChanges, setPendingChanges] = useState([]);

  const fetchTasks = async () => {
    try {
      // Всегда сначала получаем данные из локального хранилища
      const userId = localStorage.getItem('userId');
      const localTasks = await getTasks(userId);
      console.log('Получены задачи из локального хранилища:', localTasks);
      
      if (Array.isArray(localTasks) && localTasks.length > 0) {
        setTasks(localTasks);
      }

      // Если есть интернет, синхронизируем с сервером
      if (navigator.onLine) {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/tasks/dependent`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Ошибка при получении задач');
        }

        const serverTasks = await response.json();
        
        if (Array.isArray(serverTasks)) {
          // Объединяем данные, сохраняя локальные изменения
          const mergedTasks = serverTasks.map(serverTask => {
            const localTask = localTasks.find(lt => lt.id === serverTask.id);
            if (localTask) {
              // Если есть локальная версия задачи, используем её статус
              return { ...serverTask, status: localTask.status };
            }
            return serverTask;
          });

          // Сохраняем объединенные данные в локальное хранилище
          await Promise.all(mergedTasks.map(task => saveTask(task)));
          localStorage.setItem('tasks', JSON.stringify(mergedTasks));
          setTasks(mergedTasks);
        }
      }
    } catch (error) {
      console.error('Ошибка при получении задач:', error);
      setError(error.message);
    }
  };

  const fetchUserInfo = async () => {
    try {
      const token = localStorage.getItem('token');
      const userId = localStorage.getItem('userId');
      
      if (!token || !userId) {
        console.error('Токен или userId не найден');
        setError('Требуется авторизация');
        return;
      }

      // Если офлайн, используем данные из локального хранилища
      if (!navigator.onLine) {
        const cachedUserInfo = localStorage.getItem('userInfo');
        if (cachedUserInfo) {
          setUserName(cachedUserInfo.name);
          return;
        }
      }

      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка при получении информации о пользователе');
      }

      const data = await response.json();
      
      if (!data || !data.name) {
        throw new Error('Не удалось получить имя пользователя');
      }
      
      localStorage.setItem('userInfo', JSON.stringify(data));
      setUserName(data.name);
    } catch (error) {
      console.error('Ошибка при получении информации о пользователе:', error);
      const cachedUserInfo = localStorage.getItem('userInfo');
      if (cachedUserInfo) {
        setUserName(cachedUserInfo.name);
      } else {
        setError(error.message);
        setUserName('Гость');
      }
    }
  };

  const fetchUserCode = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('Токен не найден');
        return;
      }

      // Если офлайн, используем код из локального хранилища
      if (!navigator.onLine) {
        const cachedCode = localStorage.getItem('userCode');
        if (cachedCode) {
          setUserCode(cachedCode);
          return;
        }
      }

      const response = await fetch(`${API_URL}/api/dependent/code`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка при получении кода');
      }

      const data = await response.json();
      
      if (!data || !data.code) {
        throw new Error('Код не найден');
      }
      
      localStorage.setItem('userCode', data.code);
      setUserCode(data.code);
    } catch (error) {
      console.error('Ошибка при получении кода:', error);
      const cachedCode = localStorage.getItem('userCode');
      if (cachedCode) {
        setUserCode(cachedCode);
      } else {
        setError(error.message);
      }
    }
  };

  // Функция для проверки приближающихся задач
  const checkUpcomingTasks = () => {
    const now = new Date();
    tasks.forEach(task => {
      if (task.date && task.time && task.status !== 'completed') {
        const taskDate = new Date(`${task.date}T${task.time}`);
        const timeDiff = taskDate - now;
        
        // Если задача наступает через 30 минут
        if (timeDiff > 0 && timeDiff <= 30 * 60 * 1000) {
          const notification = {
            title: 'Напоминание о задаче',
            body: `Скоро наступает задача:\n${task.title}\n${task.description ? `Описание: ${task.description}` : ''}\nВремя: ${task.time}`,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            requireInteraction: true,
            vibrate: [200, 100, 200]
          };
          window.dispatchEvent(new CustomEvent('taskUpdate', { detail: notification }));
        }
      }
    });
  };

  // Добавляем проверку задач каждую минуту
  useEffect(() => {
    const intervalId = setInterval(checkUpcomingTasks, 60000);
    return () => clearInterval(intervalId);
  }, [tasks]);

  // Добавляем WebSocket соединение
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    let ws = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 3000; // 3 секунды

    const connectWebSocket = () => {
      try {
        console.log('Попытка установить WebSocket соединение');
        ws = new WebSocket(`ws://localhost:3001?token=${token}`);

        ws.onopen = () => {
          console.log('WebSocket соединение установлено');
          reconnectAttempts = 0; // Сбрасываем счетчик попыток при успешном подключении
        };

        ws.onmessage = (event) => {
          try {
            console.log('Получено WebSocket сообщение:', event.data);
            const notification = JSON.parse(event.data);
            
            if (notification.type === 'task_reminder') {
              console.log('Отправляем уведомление:', notification);
              sendNotification(notification.title, notification.body);
            } else if (notification.type === 'connection_established') {
              console.log('Подтверждение подключения получено:', notification.message);
            }
          } catch (error) {
            console.error('Ошибка при обработке сообщения:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket ошибка:', error);
          setError('Ошибка соединения с сервером уведомлений');
        };

        ws.onclose = (event) => {
          console.log('WebSocket соединение закрыто:', event.code, event.reason);
          
          // Пытаемся переподключиться, если это не было намеренное закрытие
          if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Попытка переподключения ${reconnectAttempts} из ${maxReconnectAttempts}`);
            setTimeout(connectWebSocket, reconnectDelay);
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            console.log('Достигнуто максимальное количество попыток переподключения');
            setError('Не удалось установить соединение с сервером уведомлений');
          }
        };
      } catch (error) {
        console.error('Ошибка при создании WebSocket:', error);
        setError('Ошибка при создании соединения с сервером уведомлений');
      }
    };

    connectWebSocket();

    return () => {
      if (ws) {
        ws.close(1000, 'Компонент размонтирован');
      }
    };
  }, []);

  // Обновляем функцию отправки уведомлений
  const sendNotification = async (title, body) => {
    try {
      console.log('Запрашиваем разрешение на уведомления');
      const permission = await Notification.requestPermission();
      console.log('Статус разрешения:', permission);
      
      if (permission === 'granted') {
        console.log('Отправляем уведомление:', { title, body });
        const notification = new Notification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          requireInteraction: true,
          vibrate: [200, 100, 200],
          silent: false,
          tag: 'task-notification'
        });

        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } else {
        console.log('Разрешение на уведомления не получено');
        setError('Необходимо разрешить отправку уведомлений в браузере');
      }
    } catch (error) {
      console.error('Ошибка при отправке уведомления:', error);
      setError('Не удалось отправить уведомление');
    }
  };

  // Обновляем обработчик изменения статуса задачи
  const handleStatusChange = async (taskId, newStatus) => {
    try {
      if (!navigator.onLine) {
        // Сохраняем изменение локально
        const pendingChange = {
          type: 'status_update',
          taskId,
          status: newStatus,
          timestamp: new Date().toISOString()
        };
        await savePendingChange(pendingChange);
        return;
      }

      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: newStatus,
          lastUpdated: task.last_updated
        })
      });

      if (response.status === 409) {
        // Конфликт версий
        const conflictData = await response.json();
        const shouldOverride = window.confirm(
          `Задача была изменена другим пользователем. Текущий статус: ${conflictData.currentStatus}. Хотите применить ваше изменение?`
        );

        if (shouldOverride) {
          // Повторяем запрос с принудительным обновлением
          const retryResponse = await fetch(`${API_URL}/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              status: newStatus,
              force: true
            })
          });

          if (!retryResponse.ok) {
            throw new Error('Ошибка при обновлении статуса');
          }
        } else {
          // Обновляем локальное состояние в соответствии с серверной версией
          setTasks(prevTasks => 
            prevTasks.map(task => 
              task.id === taskId 
                ? { ...task, status: conflictData.currentStatus, last_updated: conflictData.currentVersion }
                : task
            )
          );
        }
      } else if (!response.ok) {
        throw new Error('Ошибка при обновлении статуса');
      }

      const updatedTask = await response.json();
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.id === taskId 
            ? { ...task, status: newStatus, last_updated: updatedTask.lastUpdated }
            : task
        )
      );

    } catch (error) {
      console.error('Ошибка при обновлении статуса:', error);
      // Показываем уведомление об ошибке
      sendNotification(
        'Ошибка обновления',
        'Не удалось обновить статус задачи. Попробуйте позже.'
      );
    }
  };

  // Добавляем обработчик для получения уведомлений о новых задачах
  useEffect(() => {
    const handleNewTask = (event) => {
      const { title, body } = event.detail;
      sendNotification(title, body);
    };

    window.addEventListener('newTask', handleNewTask);
    return () => window.removeEventListener('newTask', handleNewTask);
  }, []);

  // Обработчик изменения статуса задачи
  useEffect(() => {
    const handleTaskUpdate = (event) => {
      const { title, body } = event.detail;
      sendNotification(title, body);
    };

    window.addEventListener('taskUpdate', handleTaskUpdate);
    return () => window.removeEventListener('taskUpdate', handleTaskUpdate);
  }, []);

  // Синхронизация при восстановлении соединения
  useEffect(() => {
    const syncChanges = async () => {
      if (!navigator.onLine) return;

      const pendingChanges = await getPendingChanges();
      if (pendingChanges.length === 0) return;

      console.log('Начинаем синхронизацию изменений:', pendingChanges);
      const token = localStorage.getItem('token');
      
      // Отправляем все локальные изменения на сервер
      for (const change of pendingChanges) {
        try {
          if (change.type === 'update_status') {
            console.log('Синхронизация изменения статуса:', change);
            const response = await fetch(`${API_URL}/api/tasks/${change.taskId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ status: change.newStatus })
            });

            if (!response.ok) {
              throw new Error('Ошибка синхронизации');
            }
          }
        } catch (error) {
          console.error('Ошибка при синхронизации:', error);
          return; // Прерываем синхронизацию при ошибке
        }
      }

      // Очищаем синхронизированные изменения
      await clearPendingChanges();
      setPendingChanges([]);

      // Обновляем список задач
      await fetchTasks();
    };

    const handleOnline = () => {
      console.log('Соединение восстановлено');
      setIsOnline(true);
      syncChanges();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const handleSetReminder = async (task) => {
    try {
      // Запрашиваем разрешение на отправку уведомлений
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        // Отправляем уведомление
        new Notification('Время выполнить задачу', {
          body: `Задача: ${task.title}\n${task.description ? `Описание: ${task.description}` : ''}\n${task.time ? `Время: ${task.time}` : ''}`,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          requireInteraction: true,
          vibrate: [200, 100, 200]
        });
      } else {
        setError('Необходимо разрешить отправку уведомлений');
      }
    } catch (error) {
      console.error('Ошибка при отправке уведомления:', error);
      setError('Не удалось отправить уведомление');
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        await fetchUserInfo();
        await fetchUserCode();
        await fetchTasks();
      } catch (error) {
        console.error('Ошибка при загрузке данных:', error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Устанавливаем интервал обновления задач каждые 5 секунд
    const intervalId = setInterval(fetchTasks, 5000);

    // Очищаем интервал при размонтировании компонента
    return () => clearInterval(intervalId);
  }, []);

  // В компонентах с интерактивными элементами
  const handleKeyPress = (event, callback) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      callback();
    }
  };

  // Функция для проверки времени до задачи
  const isTaskUpcoming = (task) => {
    if (!task.date || !task.time) return false;
    
    const taskDateTime = new Date(`${task.date}T${task.time}`);
    const now = new Date();
    const timeDiff = taskDateTime - now;
    
    // Проверяем, что задача в будущем и до неё осталось 15 минут или меньше
    return timeDiff > 0 && timeDiff <= 15 * 60 * 1000;
  };

  if (loading) {
    return <div>Загрузка...</div>;
  }

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <header>
      </header>

      <section style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '2rem',
        backgroundColor: '#ffffff',
        padding: '20px',
        borderRadius: '12px'
      }}>
        <h2>Добро пожаловать, {userName}!</h2>
      </section>

      <div aria-live="polite" aria-atomic="true">
        {error && (
          <div role="alert" className="alert alert-error">
            {error}
          </div>
        )}
      </div>

      <section style={{ 
        backgroundColor: '#e3f2fd',
        padding: '15px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #bbdefb'
      }}>
        <h3 style={{ 
          margin: '0 0 10px 0',
          color: '#0d47a1',
          fontSize: '16px',
          fontWeight: '600'
        }}>
          Покажите этот код для подключения к опекуну
        </h3>
        <div 
          role="button"
          tabIndex="0"
          onKeyPress={(e) => handleKeyPress(e, () => {})}
          style={{ 
            backgroundColor: '#ffffff',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #bbdefb',
            fontSize: '32px',
            fontWeight: '600',
            color: '#0d47a1',
            textAlign: 'center',
            letterSpacing: '3px',
            minHeight: '48px',
            minWidth: '48px',
            cursor: 'pointer'
          }}
        >
          {userCode || 'Загрузка...'}
        </div>
      </section>

      {!isOnline && (
        <div role="alert" style={{ 
          backgroundColor: '#fff3cd', 
          color: '#856404',
          padding: '10px',
          borderRadius: '4px',
          marginBottom: '1rem',
          textAlign: 'center'
        }}>
          Работа в офлайн-режиме. Изменения будут синхронизированы при восстановлении соединения.
        </div>
      )}

      {pendingChanges.length > 0 && (
        <div role="alert" style={{ 
          backgroundColor: '#d4edda', 
          color: '#155724',
          padding: '10px',
          borderRadius: '4px',
          marginBottom: '1rem',
          textAlign: 'center'
        }}>
          Ожидает синхронизации: {pendingChanges.length} изменений
        </div>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {tasks.length > 0 ? (
          <ul role="list" aria-label="Список задач" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tasks.map(task => (
              <li key={task.id} role="listitem" style={{ margin: 0, padding: 0 }}>
                <div
                  style={{
                    padding: '20px',
                    backgroundColor: isTaskUpcoming(task) ? '#fff3cd' : '#ffffff',
                    border: '1px solid #e0e0e0',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '15px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    ':hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
                    }
                  }}
                >
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'flex-start',
                    gap: '15px'
                  }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ 
                        margin: '0 0 10px 0',
                        fontSize: '32px',
                        color: '#2c3e50',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px'
                      }}>
                        {isTaskUpcoming(task) ? (
                          <FaExclamationCircle style={{ fontSize: '32px', color: '#ffc107' }} />
                        ) : (
                          <FaBell style={{ fontSize: '32px' }} />
                        )}
                        {task.title}
                      </h4>
                      
                      {task.description && (
                        <div style={{ 
                          margin: '0 0 15px 0',
                          color: '#666',
                          fontSize: '14px',
                          lineHeight: '1.6',
                          backgroundColor: '#f8f9fa',
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid #e9ecef',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px'
                        }}>
                          <MdDescription style={{ flexShrink: 0, marginTop: '3px' }} />
                          <span>{task.description}</span>
                        </div>
                      )}

                      <div style={{ 
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '12px',
                        marginBottom: '15px'
                      }}>
                        {task.date && (
                          <div style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: '#666',
                            fontSize: '14px',
                            backgroundColor: '#e3f2fd',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid #bbdefb'
                          }}>
                            <MdDateRange />
                            {new Date(task.date).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric'
                            })}
                          </div>
                        )}
                        
                        {task.time && (
                          <div style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: '#666',
                            fontSize: '14px',
                            backgroundColor: '#e3f2fd',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid #bbdefb'
                          }}>
                            <MdAccessTime />
                            {task.time}
                          </div>
                        )}

                        <div style={{ 
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          color: task.status === 'completed' ? '#155724' : 
                                 task.status === 'in_progress' ? '#856404' : '#1a237e',
                          fontSize: '14px',
                          backgroundColor: task.status === 'completed' ? '#d4edda' : 
                                         task.status === 'in_progress' ? '#fff3cd' : '#e8eaf6',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid ' + (task.status === 'completed' ? '#c3e6cb' : 
                                                task.status === 'in_progress' ? '#ffeeba' : '#c5cae9')
                        }}>
                          {task.status === 'completed' ? <FaCheck /> : 
                           task.status === 'in_progress' ? <MdPending /> : <MdPending />}
                          {task.status === 'completed' ? 'Выполнено' : 
                           task.status === 'in_progress' ? 'В процессе' : 'В ожидании'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => {
                          const newStatus = task.status === 'completed' ? 'pending' : 'completed';
                          handleStatusChange(task.id, newStatus);
                        }}
                        onKeyPress={(e) => handleKeyPress(e, () => handleStatusChange(task.id, newStatus))}
                        style={{
                          padding: '16px',
                          backgroundColor: task.status === 'completed' ? '#dc3545' : '#6c5ce7',
                          color: 'white',
                          border: 'none',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          fontSize: '20px',
                          fontWeight: '500',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '64px',
                          height: '64px'
                        }}
                        title={task.status === 'completed' ? 'Отменить' : 'Завершить'}
                      >
                        {task.status === 'completed' ? <FaTimes style={{ fontSize: '28px' }} /> : <FaCheck style={{ fontSize: '28px' }} />}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ 
            textAlign: 'center', 
            color: '#6c757d',
            padding: '30px',
            backgroundColor: '#f8f9fa',
            borderRadius: '12px',
            border: '1px solid #e9ecef'
          }}>
            <p style={{ margin: 0, fontSize: '16px' }}>Нет активных задач</p>
          </div>
        )}
      </section>
    </main>
  );
}