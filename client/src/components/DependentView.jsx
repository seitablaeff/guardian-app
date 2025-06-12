import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL } from '../config';
import { saveTask, getTasks, savePendingChange, getPendingChanges, clearPendingChanges } from '../utils/db';
import { FaCheck, FaTimes, FaBell, FaHome, FaClipboardList, FaExclamationCircle } from 'react-icons/fa';
import { MdDescription, MdDateRange, MdAccessTime, MdPending } from 'react-icons/md';

// Добавляем стили для анимации
const styles = `
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

// Вставляем стили в head
const styleSheet = document.createElement("style");
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);

export function DependentView() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(true);
  const [userCode, setUserCode] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingChanges, setPendingChanges] = useState([]);
  const [wsError, setWsError] = useState(null);
  const [ws, setWs] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showCode, setShowCode] = useState(false);

  // const sendTestNotification = async () => {
  //   try {
  //     if (!('Notification' in window)) {
  //       setError('Браузер не поддерживает уведомления');
  //       return;
  //     }

  //     if (Notification.permission !== 'granted') {
  //       const permission = await Notification.requestPermission();
  //       if (permission !== 'granted') {
  //         setError('Разрешение на уведомления не получено');
  //         return;
  //       }
  //     }

  //     const notification = new Notification('Тестовое уведомление', {
  //       body: 'Это тестовое уведомление для проверки работы системы',
  //       icon: '/favicon.ico'
  //     });

  //     console.log('Тестовое уведомление отправлено');
  //   } catch (error) {
  //     console.error('Ошибка при отправке тестового уведомления:', error);
  //     setError('Ошибка при отправке тестового уведомления');
  //   }
  // };

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

  // Функция для проверки поддержки уведомлений
  useEffect(() => {
    if (!('Notification' in window)) {
      setError('Браузер не поддерживает уведомления');
      return;
    }
    
    // Проверяем текущее разрешение
    if (Notification.permission === 'denied') {
      setError('Уведомления отключены в браузере');
    }
  }, []);

  // Функция для проверки и отправки уведомлений
  const checkNotifications = () => {
    const now = new Date();
    console.log('Проверка уведомлений:', now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));

    tasks.forEach(task => {
      try {
        if (!task.date || !task.time || task.status === 'completed') {
          console.log('Пропуск задачи:', task.title, '- отсутствует дата/время или задача завершена');
          return;
        }

        // Создаем объект даты для задачи
        const [hours, minutes] = task.time.split(':').map(Number);
        const taskDate = new Date(task.date);
        taskDate.setHours(hours, minutes, 0, 0);

        console.log('Проверка задачи:', task.title);
        console.log('Время задачи:', taskDate.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
        console.log('Текущее время:', now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));

        // Проверяем, наступило ли время задачи
        const timeDiff = taskDate - now;
        console.log('Разница во времени (минуты):', Math.floor(timeDiff / (1000 * 60)));

        if (timeDiff <= 0 && timeDiff > -60 * 1000) { // Если время наступило, но не более минуты назад
          // Проверяем, не отправляли ли мы уже уведомление
          const lastNotified = localStorage.getItem(`lastNotified_${task.id}`);
          if (lastNotified) {
            const lastNotifiedTime = new Date(parseInt(lastNotified));
            console.log('Последнее уведомление было отправлено:', 
              lastNotifiedTime.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
            
            // Если уведомление было отправлено менее 1 минуты назад, пропускаем
            if (now - lastNotifiedTime < 60 * 1000) {
              console.log('Пропуск уведомления: уже отправляли менее 1 минуты назад');
              return;
            }
          }

          console.log('Отправка уведомления для задачи:', task.title);
          sendNotification(
            task.title,
            `${task.description || 'Нет описания'}\nВремя: ${task.time}`
          );

          // Сохраняем время последнего уведомления
          localStorage.setItem(`lastNotified_${task.id}`, Date.now().toString());
          console.log('Уведомление отправлено и сохранено');
        } else {
          console.log('Задача не требует уведомления:', 
            timeDiff > 0 ? 'время еще не наступило' : 'время прошло более минуты назад');
        }
      } catch (error) {
        console.error('Ошибка при проверке уведомлений:', error);
      }
    });
  };

  // Запускаем проверку уведомлений каждые 10 секунд
  useEffect(() => {
    console.log('Запуск системы уведомлений');
    // Первоначальная проверка
    checkNotifications();

    // Устанавливаем интервал
    const intervalId = setInterval(checkNotifications, 10000);

    // Очистка при размонтировании
    return () => {
      console.log('Остановка системы уведомлений');
      clearInterval(intervalId);
    };
  }, [tasks]); // Зависимость от tasks, чтобы перезапускать при изменении списка задач

  // Добавляем WebSocket соединение
  useEffect(() => {
    const connectWebSocket = () => {
      const token = localStorage.getItem('token');
      const socket = new WebSocket(`ws://localhost:3001/ws?token=${token}`);

      socket.onopen = () => {
        console.log('WebSocket соединение установлено');
        setWs(socket);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Получено WebSocket сообщение:', data);

          if (data.type === 'task_status_changed') {
            // Обновляем статус задачи
            setTasks(prevTasks => 
              prevTasks.map(task => 
                task.id === data.taskId 
                  ? { ...task, status: data.newStatus }
                  : task
              )
            );

            // Показываем уведомление
            const notification = {
              id: Date.now(),
              type: 'status_change',
              message: `Статус задачи изменен на: ${data.newStatus}`,
              timestamp: data.timestamp || new Date().toISOString()
            };
            setNotifications(prev => [notification, ...prev]);
          }
        } catch (error) {
          console.error('Ошибка при обработке WebSocket сообщения:', error);
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket ошибка:', error);
      };

      socket.onclose = (event) => {
        console.log('WebSocket соединение закрыто:', event.code);
        setWs(null);
        
        // Пытаемся переподключиться
        setTimeout(connectWebSocket, 3000);
      };

      return socket;
    };

    const socket = connectWebSocket();

    return () => {
      if (socket) {
        socket.close(1000, 'Компонент размонтирован');
      }
    };
  }, []);

  // Функция для отправки браузерных уведомлений
  // @param {string} title - Заголовок уведомления
  // @param {string} body - Текст уведомления
  // @returns {Promise<void>}
  const sendNotification = async (title, body) => {
    try {
      console.log('Запрашиваем разрешение на уведомления');
      // Запрашиваем разрешение на отправку уведомлений у пользователя
      // Возможные значения: 'granted', 'denied', 'default'
      const permission = await Notification.requestPermission();
      console.log('Статус разрешения:', permission);
      
      if (permission === 'granted') {
        console.log('Отправляем уведомление:', { title, body });
        // Создаем новое уведомление с указанными параметрами
        const notification = new Notification(title, {
          body,                    // Текст уведомления
          icon: '/favicon.ico',    // Иконка уведомления
          badge: '/favicon.ico',   // Иконка в панели уведомлений
          requireInteraction: true, // Уведомление не исчезнет автоматически
          vibrate: [200, 100, 200], // Паттерн вибрации (для мобильных устройств)
          silent: false,           // Проигрывать звук
          tag: 'task-notification' // Уникальный тег для группировки уведомлений
        });

        // Обработчик клика по уведомлению
        notification.onclick = () => {
          window.focus();          // Фокусируем окно приложения
          notification.close();    // Закрываем уведомление
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
        setPendingChanges(prev => [...prev, pendingChange]);
        
        // Обновляем локальное состояние
        setTasks(prevTasks => 
          prevTasks.map(task => 
            task.id === taskId 
              ? { ...task, status: newStatus }
              : task
          )
        );
        return;
      }

      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: newStatus,
          lastUpdated: new Date().toISOString()
        })
      });

      if (!response.ok) {
        if (response.status === 409) {
          // Конфликт версий
          const conflictData = await response.json();
          const shouldOverride = window.confirm(
            `Задача была изменена другим пользователем. Текущий статус: ${conflictData.currentStatus}. Хотите применить ваше изменение?`
          );

          if (shouldOverride) {
            // Повторяем запрос с принудительным обновлением
            const retryResponse = await fetch(`${API_URL}/api/tasks/${taskId}/status`, {
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

            const updatedTask = await retryResponse.json();
            setTasks(prevTasks => 
              prevTasks.map(task => 
                task.id === taskId 
                  ? { ...task, status: newStatus, last_updated: updatedTask.lastUpdated }
                  : task
              )
            );
          }
        } else {
          throw new Error('Ошибка при обновлении статуса');
        }
      } else {
        const updatedTask = await response.json();
        setTasks(prevTasks => 
          prevTasks.map(task => 
            task.id === taskId 
              ? { ...task, status: newStatus, last_updated: updatedTask.lastUpdated }
              : task
          )
        );

        // Отправляем уведомление через WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
          const notification = {
            type: 'status_update',
            taskId: taskId,
            status: newStatus,
            taskTitle: updatedTask.title,
            taskDescription: updatedTask.description,
            timestamp: new Date().toISOString()
          };
          ws.send(JSON.stringify(notification));
        }
      }
    } catch (error) {
      console.error('Ошибка при обновлении статуса:', error);
      setError(error.message);
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
          if (change.type === 'status_update') {
            console.log('Синхронизация изменения статуса:', change);
            const response = await fetch(`${API_URL}/api/tasks/${change.taskId}/status`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                status: change.status,
                lastUpdated: change.timestamp
              })
            });

            if (!response.ok) {
              if (response.status === 409) {
                // Если есть конфликт версий, используем локальную версию
                const retryResponse = await fetch(`${API_URL}/api/tasks/${change.taskId}/status`, {
                  method: 'PATCH',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ 
                    status: change.status,
                    force: true
                  })
                });

                if (!retryResponse.ok) {
                  throw new Error('Ошибка синхронизации при конфликте');
                }
              } else {
                throw new Error('Ошибка синхронизации');
              }
            }

            // Обновляем локальное состояние после успешной синхронизации
            const updatedTask = await response.json();
            setTasks(prevTasks => 
              prevTasks.map(task => 
                task.id === change.taskId 
                  ? { ...task, status: change.status, last_updated: updatedTask.lastUpdated }
                  : task
              )
            );
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
    <div style={{ 
      width: '100%',
      boxSizing: 'border-box'
    }}>
      <main>
        {error && (
          <div role="alert" style={{ 
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>⚠️</span>
            {error}
          </div>
        )}

        {wsError && (
          <div role="alert" style={{ 
            backgroundColor: '#fff3cd', 
            color: '#856404',
            padding: '8px',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: 0.8
          }}>
            <span>ℹ️</span>
            {wsError}
          </div>
        )}

        <h1 style={{ margin: '0 0 20px 0' }}>Ваши задачи</h1>

        <section style={{ 
          backgroundColor: '#e3f2fd',
          padding: '15px',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid #bbdefb'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <div 
              role="button"
              tabIndex="0"
              onClick={() => setShowCode(!showCode)}
              onKeyPress={(e) => handleKeyPress(e, () => setShowCode(!showCode))}
              style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                padding: '10px',
                borderRadius: '8px',
                transition: 'background-color 0.2s',
                ':hover': {
                  backgroundColor: '#bbdefb'
                }
              }}
              title="Нажмите, чтобы показать или скрыть код подключения"
            >
              <FaHome style={{ fontSize: '24px', color: '#0d47a1' }} />
              <h2 style={{ 
                margin: 0,
                color: '#0d47a1',
                fontSize: '16px',
                fontWeight: '600'
              }}>
                {showCode ? 'Скрыть код подключения' : 'Показать код подключения'}
              </h2>
            </div>
            {/*
              Это отладочная кнопка для проверки уведомлений
            */}</div>
            {/* <button
              onClick={sendTestNotification}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'background-color 0.2s'
              }}
            >
              <FaBell />
              Тест уведомлений
            </button>
          </div> */}
          
          {showCode && (
            <div 
              style={{ 
                marginTop: '15px',
                animation: 'fadeIn 0.3s ease-in-out'
              }}
            >
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
            </div>
          )}
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
                        <h3 style={{ 
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
                        </h3>
                        
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
    </div>
  );
}