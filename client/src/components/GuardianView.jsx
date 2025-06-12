// components/GuardianView.jsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import { saveTask, getTasks, savePendingChange, getPendingChanges, clearPendingChanges, deleteTask } from '../utils/db';
import { FaCheck, FaTimes, FaTrash, FaBell, FaHome, FaUserPlus, FaPlus } from 'react-icons/fa';
import { MdDescription, MdDateRange, MdAccessTime, MdPending } from 'react-icons/md';

export function GuardianView() {
  const [dependents, setDependents] = useState([]);
  const [tasks, setTasks] = useState({});
  const [newTask, setNewTask] = useState({ 
    title: '', 
    dependentId: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().slice(0, 5)
  });
  const [linkCode, setLinkCode] = useState('');
  const [error, setError] = useState(null);
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingTasks, setPendingTasks] = useState([]);
  const [wsError, setWsError] = useState(null);
  const [ws, setWs] = useState(null);
  const [dependentCode, setDependentCode] = useState('');
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const fetchTasks = async () => {
    try {
      console.log('Запрос списка задач');
      const response = await fetch(`${API_URL}/api/tasks/guardian`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Ошибка при получении задач');
      }

      const serverTasks = await response.json();
      console.log('Получены задачи с сервера:', serverTasks);

      // Сохраняем каждую задачу отдельно в IndexedDB
      for (const task of serverTasks) {
        await saveTask(task);
      }

      // Группируем задачи по подопечным
      const groupedTasks = {};
      serverTasks.forEach(task => {
        if (!groupedTasks[task.dependent_id]) {
          groupedTasks[task.dependent_id] = [];
        }
        groupedTasks[task.dependent_id].push(task);
      });

      setTasks(groupedTasks);
    } catch (error) {
      console.error('Ошибка при получении задач:', error);
      setError('Не удалось загрузить задачи');
    }
  };

  const fetchDependents = async () => {
    try {
      console.log('Запрос списка подопечных');
      
      // Если офлайн, используем данные из localStorage
      if (!navigator.onLine) {
        const cachedDependents = localStorage.getItem('dependents');
        if (cachedDependents) {
          const dependents = JSON.parse(cachedDependents);
          setDependents(dependents);
          return;
        }
      }
      
      const response = await fetch(`${API_URL}/api/guardian/dependents`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('Статус ответа:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка при получении списка подопечных');
      }

      const data = await response.json();
      console.log('Получены подопечные:', data);
      
      if (!Array.isArray(data)) {
        console.error('Получены некорректные данные:', data);
        setDependents([]);
        return;
      }
      
      // Сохраняем список подопечных в localStorage
      localStorage.setItem('dependents', JSON.stringify(data));
      setDependents(data);
    } catch (error) {
      console.error('Ошибка при получении подопечных:', error);
      // Пытаемся получить данные из localStorage
      const cachedDependents = localStorage.getItem('dependents');
      if (cachedDependents) {
        const dependents = JSON.parse(cachedDependents);
        setDependents(dependents);
      } else {
        setError(error.message);
        setDependents([]);
      }
    }
  };

  const fetchUserInfo = async () => {
    try {
      if (!token) {
        console.error('Токен не найден');
        setError('Требуется авторизация');
        return;
      }

      // Если офлайн, используем данные из localStorage
      if (!navigator.onLine) {
        const cachedUserInfo = localStorage.getItem('userInfo');
        if (cachedUserInfo) {
          const userInfo = JSON.parse(cachedUserInfo);
          setUserName(userInfo.name);
          return;
        }
      }

      console.log('Отправляем запрос на получение информации о пользователе');
      
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('Статус ответа:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка при получении информации о пользователе');
      }

      const data = await response.json();
      console.log('Получены данные пользователя:', data);
      
      if (!data || !data.name) {
        throw new Error('Не удалось получить имя пользователя');
      }
      
      // Сохраняем информацию о пользователе в localStorage
      localStorage.setItem('userInfo', JSON.stringify(data));
      setUserName(data.name);
    } catch (error) {
      console.error('Ошибка при получении информации о пользователе:', error);
      // Пытаемся получить данные из localStorage
      const cachedUserInfo = localStorage.getItem('userInfo');
      if (cachedUserInfo) {
        const userInfo = JSON.parse(cachedUserInfo);
        setUserName(userInfo.name);
      } else {
        setError(error.message);
        setUserName('Гость');
      }
    }
  };

  // Функция для синхронизации отложенных задач при восстановлении соединения
  const syncPendingTasks = async () => {
    if (pendingTasks.length === 0) return;

    console.log('Синхронизация отложенных задач:', pendingTasks);
    
    for (const task of pendingTasks) {
      try {
        const response = await fetch(`${API_URL}/api/tasks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: task.title,
            dependentId: task.dependentId
          })
        });

        if (!response.ok) {
          throw new Error('Ошибка синхронизации');
        }
      } catch (error) {
        console.error('Ошибка при синхронизации задачи:', error);
        // Оставляем задачу в очереди для следующей попытки
        return;
      }
    }

    // Если все задачи успешно синхронизированы, очищаем очередь
    setPendingTasks([]);
    // Обновляем список задач
    await fetchTasks();
  };

  // Обработчики онлайн/офлайн статуса
  useEffect(() => {
    const handleOnline = () => {
      console.log('Соединение восстановлено');
      setIsOnline(true);
      syncPendingTasks();
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
  }, [pendingTasks]);

  // Загружаем данные при монтировании компонента
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        // Загружаем информацию о пользователе
        await fetchUserInfo();
        // Загружаем список подопечных
        await fetchDependents();
        
        // Загружаем задачи из IndexedDB
        const offlineTasks = await getTasks();
        if (offlineTasks && offlineTasks.length > 0) {
          console.log('Загружены задачи из IndexedDB:', offlineTasks);
          const tasksByDependent = offlineTasks.reduce((acc, task) => {
            if (!acc[task.dependent_id]) {
              acc[task.dependent_id] = [];
            }
            acc[task.dependent_id].push(task);
            return acc;
          }, {});
          setTasks(tasksByDependent);
        }

        // Затем обновляем с сервера, если есть соединение
        if (isOnline) {
          await fetchTasks();
        }
      } catch (error) {
        console.error('Ошибка при загрузке начальных данных:', error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [isOnline]);

  // Устанавливаем интервал обновления задач
  useEffect(() => {
    if (isOnline) {
      const intervalId = setInterval(fetchTasks, 5000);
      return () => clearInterval(intervalId);
    }
  }, [isOnline]);

  const handleLinkDependent = async (e) => {
    e.preventDefault();
    if (!linkCode.trim()) {
      setError('Введите код подопечного');
      return;
    }

    try {
      console.log('Отправляем запрос на связывание с кодом:', linkCode);
      
      const response = await fetch(`${API_URL}/api/guardian/link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: linkCode.trim() })
      });

      console.log('Статус ответа:', response.status);
      const data = await response.json();
      console.log('Ответ сервера:', data);

      if (!response.ok) {
        throw new Error(data.message || 'Ошибка при связывании с подопечным');
      }

      setLinkCode('');
      setError(null);
      
      // Обновляем список подопечных
      await fetchDependents();
      // Обновляем список задач
      await fetchTasks();
    } catch (error) {
      console.error('Ошибка при связывании:', error);
      setError(error.message);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!token) {
      console.error('Токен не найден');
      return;
    }

    const formData = new FormData(e.target);
    const date = formData.get('date');
    const time = formData.get('time');
    
    console.log('Полученные дата и время:', { date, time });
    console.log('Все данные формы:', Object.fromEntries(formData.entries()));

    if (!date || !time) {
      setError('Пожалуйста, укажите дату и время');
      return;
    }

    // Проверяем формат даты
    const dateObj = new Date(`${date}T${time}`);
    if (isNaN(dateObj.getTime())) {
      setError('Неверный формат даты и времени');
      return;
    }
    
    console.log('Разобранные дата и время:', { date, time });
    
    const taskData = {
      title: newTask.title,
      description: newTask.description,
      date: date,
      time: time,
      dependentId: formData.get('dependent_id'),
      status: 'pending'
    };

    console.log('Подготовленные данные для отправки:', taskData);

    try {
      if (!isOnline) {
        // В офлайн режиме создаем локальную задачу
        const newTask = {
          ...taskData,
          id: Date.now().toString(),
          created_at: new Date().toISOString(),
          last_updated: new Date().toISOString()
        };

        // Сохраняем в IndexedDB
        await saveTask(newTask);
        await savePendingChange({
          type: 'create',
          task: newTask,
          timestamp: Date.now()
        });

        // Обновляем состояние
        setTasks(prevTasks => {
          const updated = { ...prevTasks };
          if (!updated[taskData.dependentId]) {
            updated[taskData.dependentId] = [];
          }
          updated[taskData.dependentId] = [...updated[taskData.dependentId], newTask];
          return updated;
        });

        // Сбрасываем форму и состояние
        e.target.reset();
        setNewTask({ 
          title: '', 
          dependentId: '',
          description: '',
          date: new Date().toISOString().split('T')[0],
          time: new Date().toTimeString().slice(0, 5)
        });
        return;
      }

      const response = await fetch(`${API_URL}/api/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify(taskData)
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('token');
          navigate('/login');
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка при создании задачи');
      }

      const newTask = await response.json();
      console.log('Задача успешно создана:', newTask);

      // Сохраняем в IndexedDB
      await saveTask(newTask);

      // Обновляем состояние
      setTasks(prevTasks => {
        const updated = { ...prevTasks };
        if (!updated[taskData.dependentId]) {
          updated[taskData.dependentId] = [];
        }
        updated[taskData.dependentId] = [...updated[taskData.dependentId], newTask];
        return updated;
      });

      // Сбрасываем форму и состояние
      e.target.reset();
      setNewTask({ 
        title: '', 
        dependentId: '',
        description: '',
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().slice(0, 5)
      });
    } catch (error) {
      console.error('Ошибка при создании задачи:', error);
      setError(error.message || 'Не удалось создать задачу');
    }
  };

  // Синхронизация при восстановлении соединения
  useEffect(() => {
    const syncData = async () => {
      if (isOnline) {
        try {
          // Синхронизируем отложенные изменения
          const pendingChanges = await getPendingChanges();
          
          if (pendingChanges.length > 0) {
            console.log('Синхронизация отложенных изменений:', pendingChanges);
            
            for (const change of pendingChanges) {
              try {
                if (change.type === 'create') {
                  const response = await fetch(`${API_URL}/api/tasks`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(change.task)
                  });

                  if (response.ok) {
                    const newTask = await response.json();
                    // Обновляем задачу в IndexedDB
                    await saveTask(newTask);
                  }
                } else if (change.type === 'status') {
                  const response = await fetch(`${API_URL}/api/tasks/${change.taskId}/status`, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ 
                      status: change.newStatus,
                      lastUpdated: change.timestamp
                    })
                  });

                  if (response.ok) {
                    const updatedTask = await response.json();
                    // Обновляем задачу в IndexedDB
                    await saveTask(updatedTask);
                  }
                }
              } catch (error) {
                console.error('Ошибка при синхронизации изменения:', error);
                // Продолжаем с следующим изменением
                continue;
              }
            }

            // Очищаем отложенные изменения только если все синхронизированы успешно
            await clearPendingChanges();
          }

          // Обновляем список задач
          await fetchTasks();
        } catch (error) {
          console.error('Ошибка при синхронизации:', error);
          setError('Ошибка при синхронизации данных');
        }
      }
    };

    syncData();
  }, [isOnline]);

  const showTestNotification = async () => {
    try {
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        new Notification('Тестовое уведомление', {
          body: 'Это тестовое уведомление для проверки работы системы',
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'test-notification',
          requireInteraction: true,
          vibrate: [200, 100, 200]
        });
      } else {
        setError('Разрешение на отправку уведомлений не получено');
      }
    } catch (error) {
      console.error('Ошибка при отправке уведомления:', error);
      setError('Не удалось отправить уведомление');
    }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      if (!isOnline) {
        // В офлайн режиме обновляем статус локально
        const updatedTasks = {};
        let updatedTask = null;
        
        for (const depId in tasks) {
          updatedTasks[depId] = tasks[depId].map(task => {
            if (task.id === taskId) {
              updatedTask = { 
                ...task, 
                status: newStatus,
                last_updated: new Date().toISOString()
              };
              return updatedTask;
            }
            return task;
          });
        }
        
        setTasks(updatedTasks);
        
        // Сохраняем в IndexedDB только обновленную задачу
        if (updatedTask) {
          await saveTask(updatedTask);
        }
        
        // Добавляем изменение в pendingChanges
        await savePendingChange({
          type: 'status',
          taskId,
          newStatus,
          timestamp: new Date().toISOString()
        });
        
        setError(null); // Очищаем сообщение об ошибке
        return;
      }

      const response = await fetch(`${API_URL}/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        throw new Error('Ошибка при обновлении статуса');
      }

      const updatedTask = await response.json();
      
      // Обновляем только конкретную задачу, не перезагружая весь список
      setTasks(prevTasks => {
        const updated = { ...prevTasks };
        for (const depId in updated) {
          const taskIndex = updated[depId].findIndex(t => t.id === taskId);
          if (taskIndex !== -1) {
            updated[depId][taskIndex] = {
              ...updated[depId][taskIndex],
              status: newStatus,
              last_updated: updatedTask.last_updated
            };
          }
        }
        return updated;
      });

      // Сохраняем обновленную задачу в IndexedDB
      await saveTask(updatedTask);

      // Отправляем уведомление через WebSocket
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'task_status_changed',
          taskId,
          newStatus,
          userId: user.id,
          timestamp: new Date().toISOString()
        }));
      }

      setError(null); // Очищаем сообщение об ошибке при успешном обновлении
    } catch (error) {
      console.error('Ошибка при обновлении статуса:', error);
      setError('Не удалось обновить статус задачи');
    }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      if (!navigator.onLine) {
        // В офлайн режиме сохраняем изменение в очередь синхронизации
        await savePendingChange({
          type: 'delete_task',
          taskId,
          timestamp: new Date().toISOString()
        });

        // Удаляем задачу из локального хранилища
        await deleteTask(taskId);

        // Обновляем UI
        setTasks(prevTasks => {
          const updated = { ...prevTasks };
          for (const depId in updated) {
            updated[depId] = updated[depId].filter(t => t.id !== taskId);
          }
          return updated;
        });
        return;
      }

      const response = await fetch(`${API_URL}/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка при удалении задачи');
      }

      // Удаляем задачу из локального хранилища
      await deleteTask(taskId);

      // Обновляем UI
      setTasks(prevTasks => {
        const updated = { ...prevTasks };
        for (const depId in updated) {
          updated[depId] = updated[depId].filter(t => t.id !== taskId);
        }
        return updated;
      });

      // Отправляем уведомление через WebSocket
      if (ws && ws.readyState === WebSocket.OPEN) {
        const notification = {
          type: 'delete_task',
          taskId: taskId,
          timestamp: new Date().toISOString()
        };
        ws.send(JSON.stringify(notification));
      }
    } catch (error) {
      console.error('Ошибка при удалении задачи:', error);
      setError(error.message);
    }
  };

  // Функция для отправки уведомлений
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

        // Добавляем обработку ошибок
        notification.onerror = (error) => {
          console.error('Ошибка при отображении уведомления:', error);
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

  // WebSocket соединение
  useEffect(() => {
    if (!token) return;

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 3000;

    const connectWebSocket = () => {
      console.log('Попытка установить WebSocket соединение');
      const socket = new WebSocket(`ws://localhost:3001/ws?token=${token}`);

      socket.onopen = () => {
        console.log('WebSocket соединение установлено');
        setWs(socket);
        reconnectAttempts = 0;
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Получено сообщение:', data);

          if (data.type === 'task_status_changed') {
            setTasks(prevTasks => {
              const updated = { ...prevTasks };
              for (const depId in updated) {
                const taskIndex = updated[depId].findIndex(t => t.id === data.taskId);
                if (taskIndex !== -1) {
                  updated[depId][taskIndex] = {
                    ...updated[depId][taskIndex],
                    status: data.newStatus,
                    last_updated: data.timestamp
                  };
                }
              }
              return updated;
            });
          }
        } catch (error) {
          console.error('Ошибка при обработке сообщения:', error);
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket ошибка:', error);
      };

      socket.onclose = (event) => {
        console.log('WebSocket соединение закрыто:', event.code);
        setWs(null);

        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log(`Попытка переподключения ${reconnectAttempts} из ${maxReconnectAttempts}`);
          setTimeout(connectWebSocket, reconnectDelay);
        } else {
          console.log('Достигнуто максимальное количество попыток переподключения');
        }
      };
    };

    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [token]);

  // Обработчик для получения уведомлений
  useEffect(() => {
    const handleTaskUpdate = (event) => {
      const { title, body } = event.detail;
      sendNotification(title, body);
      
      // Обновляем список задач при получении уведомления
      fetchTasks();
    };

    const handleNewTask = (event) => {
      const { title, body } = event.detail;
      sendNotification(title, body);
      
      // Обновляем список задач при получении уведомления
      fetchTasks();
    };

    window.addEventListener('taskUpdate', handleTaskUpdate);
    window.addEventListener('newTask', handleNewTask);
    
    return () => {
      window.removeEventListener('taskUpdate', handleTaskUpdate);
      window.removeEventListener('newTask', handleNewTask);
    };
  }, []);

  // Добавляем обработчик для обновления задач при изменении статуса
  useEffect(() => {
    const handleStatusUpdate = (event) => {
      const { taskId, newStatus } = event.detail;
      setTasks(prevTasks => {
        const updated = { ...prevTasks };
        for (const depId in updated) {
          const taskIndex = updated[depId].findIndex(t => t.id === taskId);
          if (taskIndex !== -1) {
            updated[depId][taskIndex] = {
              ...updated[depId][taskIndex],
              status: newStatus
            };
          }
        }
        return updated;
      });
    };

    window.addEventListener('statusUpdate', handleStatusUpdate);
    return () => window.removeEventListener('statusUpdate', handleStatusUpdate);
  }, []);

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
        
        {!isOnline && (
          <div role="alert" style={{ 
            backgroundColor: '#fff3cd', 
            color: '#856404',
            padding: '10px',
            borderRadius: '4px',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            Работа в офлайн-режиме. Созданные задачи будут синхронизированы при восстановлении соединения.
          </div>
        )}

        {pendingTasks.length > 0 && (
          <div role="alert" style={{ 
            backgroundColor: '#d4edda', 
            color: '#155724',
            padding: '10px',
            borderRadius: '4px',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            Ожидает синхронизации: {pendingTasks.length} задач
          </div>
        )}

        <section style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '2rem',
          backgroundColor: '#ffffff',
          padding: '20px',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ 
            margin: 0,
            fontSize: '24px',
            color: '#2c3e50',
            fontWeight: '600'
          }}>Добро пожаловать, {userName}!</h2>
        </section>

        <section style={{ 
          marginBottom: '30px',
          backgroundColor: '#ffffff',
          padding: '25px',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ 
            margin: '0 0 15px 0',
            fontSize: '18px',
            color: '#2c3e50',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <FaUserPlus />
            Добавить подопечного
          </h3>
          <form onSubmit={handleLinkDependent} style={{ 
            display: 'flex', 
            flexDirection: 'column',
            gap: '10px',
            width: '100%'
          }}>
            <label htmlFor="dependent-code" style={{ display: 'none' }}>
              Код подопечного
            </label>
            <input
              id="dependent-code"
              type="text"
              value={linkCode}
              onChange={(e) => setLinkCode(e.target.value)}
              placeholder="Введите код подопечного"
              aria-label="Код подопечного"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #e0e0e0',
                fontSize: '14px',
                backgroundColor: '#f8f9fa',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box'
              }}
            />
            <button
              type="submit"
              aria-label="Добавить подопечного"
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#6c5ce7',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'background-color 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <FaPlus />
              Добавить
            </button>
          </form>
        </section>

        {dependents.length === 0 ? (
          <section style={{ 
            backgroundColor: '#ffffff', 
            padding: '30px', 
            borderRadius: '12px',
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <p style={{ 
              margin: 0,
              color: '#666',
              fontSize: '16px'
            }}>У вас пока нет подопечных. Добавьте подопечного, используя его код.</p>
          </section>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
            width: '100%'
          }}>
            {dependents.map(dependent => (
              <section key={dependent.id} style={{ 
                backgroundColor: '#ffffff',
                padding: '25px',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '20px'
                }}>
                  <h3 style={{ 
                    margin: 0,
                    fontSize: '20px',
                    color: '#2c3e50',
                    fontWeight: '600'
                  }}>{dependent.name}</h3>
                  <span style={{
                    padding: '6px 12px',
                    backgroundColor: '#e3f2fd',
                    color: '#0d47a1',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: '500'
                  }}>
                    Подопечный
                  </span>
                </div>
                
                <form onSubmit={handleCreateTask} style={{ marginBottom: '20px' }}>
                  <input type="hidden" name="dependent_id" value={dependent.id} />
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '15px',
                    backgroundColor: '#f8f9fa',
                    padding: '20px',
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0'
                  }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <label htmlFor={`task-title-${dependent.id}`} style={{ display: 'none' }}>
                        Название задачи
                      </label>
                      <input
                        id={`task-title-${dependent.id}`}
                        type="text"
                        name="title"
                        value={newTask.dependentId === dependent.id ? newTask.title : ''}
                        onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value, dependentId: dependent.id }))}
                        placeholder="Название задачи"
                        aria-label="Название задачи"
                        style={{
                          flex: 1,
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid #e0e0e0',
                          fontSize: '14px',
                          backgroundColor: '#ffffff',
                          transition: 'border-color 0.2s'
                        }}
                      />
                    </div>
                    
                    <label htmlFor={`task-description-${dependent.id}`} style={{ display: 'none' }}>
                      Описание задачи
                    </label>
                    <textarea
                      id={`task-description-${dependent.id}`}
                      name="description"
                      value={newTask.dependentId === dependent.id ? newTask.description : ''}
                      onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value, dependentId: dependent.id }))}
                      placeholder="Описание задачи"
                      aria-label="Описание задачи"
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid #e0e0e0',
                        fontSize: '14px',
                        minHeight: '80px',
                        resize: 'vertical',
                        backgroundColor: '#ffffff',
                        transition: 'border-color 0.2s'
                      }}
                    />

                    <div style={{ display: 'flex', gap: '10px' }}>
                      <label htmlFor={`task-date-${dependent.id}`} style={{ display: 'none' }}>
                        Дата выполнения
                      </label>
                      <input
                        id={`task-date-${dependent.id}`}
                        type="date"
                        name="date"
                        value={newTask.dependentId === dependent.id ? newTask.date : ''}
                        onChange={(e) => setNewTask(prev => ({ ...prev, date: e.target.value, dependentId: dependent.id }))}
                        aria-label="Дата выполнения"
                        style={{
                          flex: 1,
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid #e0e0e0',
                          fontSize: '14px',
                          backgroundColor: '#ffffff',
                          transition: 'border-color 0.2s'
                        }}
                      />
                      <label htmlFor={`task-time-${dependent.id}`} style={{ display: 'none' }}>
                        Время выполнения
                      </label>
                      <input
                        id={`task-time-${dependent.id}`}
                        type="time"
                        name="time"
                        value={newTask.dependentId === dependent.id ? newTask.time : ''}
                        onChange={(e) => setNewTask(prev => ({ ...prev, time: e.target.value, dependentId: dependent.id }))}
                        aria-label="Время выполнения"
                        style={{
                          flex: 1,
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid #e0e0e0',
                          fontSize: '14px',
                          backgroundColor: '#ffffff',
                          transition: 'border-color 0.2s'
                        }}
                      />
                    </div>

                    <button
                      type="submit"
                      aria-label="Добавить задачу"
                      style={{
                        padding: '12px 20px',
                        backgroundColor: '#6c5ce7',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '600',
                        transition: 'background-color 0.2s'
                      }}
                    >
                      Добавить задачу
                    </button>
                  </div>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {tasks[dependent.id]?.length > 0 ? (
                    tasks[dependent.id].map(task => (
                      <div
                        key={task.id}
                        style={{
                          padding: '20px',
                          backgroundColor: '#ffffff',
                          border: '1px solid #e0e0e0',
                          borderRadius: '8px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                          transition: 'transform 0.2s, box-shadow 0.2s',
                          ':hover': {
                            transform: 'translateY(-2px)',
                            boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
                          }
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <h4 style={{ 
                            margin: '0 0 10px 0',
                            fontSize: '18px',
                            color: '#2c3e50',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <FaBell />
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
                                     task.status === 'in_progress' ? '#856404' : '#495057',
                              fontSize: '14px',
                              backgroundColor: task.status === 'completed' ? '#d4edda' : 
                                             task.status === 'in_progress' ? '#fff3cd' : '#e2e3e5',
                              padding: '8px 12px',
                              borderRadius: '8px',
                              border: '1px solid ' + (task.status === 'completed' ? '#c3e6cb' : 
                                                    task.status === 'in_progress' ? '#ffeeba' : '#d6d8db')
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
                            style={{
                              padding: '10px',
                              backgroundColor: task.status === 'completed' ? '#dc3545' : '#6c5ce7',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontWeight: '500',
                              transition: 'all 0.2s',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '40px',
                              height: '40px'
                            }}
                            title={task.status === 'completed' ? 'Отменить' : 'Завершить'}
                          >
                            {task.status === 'completed' ? <FaTimes /> : <FaCheck />}
                          </button>

                          <button
                            onClick={() => {
                              if (window.confirm('Вы уверены, что хотите удалить эту задачу?')) {
                                handleDeleteTask(task.id);
                              }
                            }}
                            style={{
                              padding: '10px',
                              backgroundColor: '#dc3545',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontWeight: '500',
                              transition: 'all 0.2s',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '40px',
                              height: '40px'
                            }}
                            title="Удалить"
                          >
                            <FaTrash />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{ 
                      textAlign: 'center', 
                      color: '#666',
                      fontSize: '14px',
                      padding: '20px',
                      backgroundColor: '#f8f9fa',
                      borderRadius: '8px'
                    }}>Нет активных задач</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}