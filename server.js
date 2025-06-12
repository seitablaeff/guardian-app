const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db'); // Подключаем файл с SQLite
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',
  clientTracking: true,
  perMessageDeflate: false,
  verifyClient: (info, callback) => {
    try {
      const url = new URL(info.req.url, 'ws://localhost');
      const token = url.searchParams.get('token');
      
      if (!token) {
        console.log('Отсутствует токен, отклоняем соединение');
        callback(false, 401, 'Токен не предоставлен');
        return;
      }

      jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
          console.log('Ошибка верификации токена:', err.message);
          callback(false, 401, 'Недействительный токен');
          return;
        }

        info.req.user = user;
        callback(true);
      });
    } catch (error) {
      console.error('Ошибка при верификации клиента:', error);
      callback(false, 500, 'Внутренняя ошибка сервера');
    }
  }
});

// Хранилище для активных соединений
const clients = new Map();

// Обработка WebSocket соединений
wss.on('connection', (ws, req) => {
  console.log('Новое WebSocket соединение');
  const user = req.user;
  
  console.log('Пользователь авторизован:', user.id);

  // Проверяем, нет ли уже активного соединения для этого пользователя
  const existingClient = clients.get(user.id);
  if (existingClient && existingClient.ws.readyState === WebSocket.OPEN) {
    console.log('Закрываем существующее соединение для пользователя:', user.id);
    existingClient.ws.close(1000, 'Новое соединение');
  }

  // Сохраняем соединение
  clients.set(user.id, {
    ws,
    role: user.role,
    lastActivity: Date.now()
  });

  // Отправляем подтверждение подключения
  try {
    ws.send(JSON.stringify({
      type: 'connection_established',
      message: 'Соединение установлено',
      userId: user.id,
      role: user.role
    }));
  } catch (error) {
    console.error('Ошибка при отправке подтверждения:', error);
  }

  // Обработка сообщений
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Получено сообщение от пользователя', user.id, ':', data);

      if (data.type === 'ping') {
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: data.timestamp,
          userId: user.id
        }));
      }
    } catch (error) {
      console.error('Ошибка при обработке сообщения:', error);
    }
  });

  // Обработка отключения
  ws.on('close', (code, reason) => {
    console.log('Пользователь отключился:', user.id, 'Код:', code, 'Причина:', reason);
    clients.delete(user.id);
  });

  // Обработка ошибок
  ws.on('error', (error) => {
    console.error('WebSocket ошибка для пользователя', user.id, ':', error);
    clients.delete(user.id);
  });

  // Пинг для поддержания соединения
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch (error) {
        console.error('Ошибка при отправке пинга:', error);
        clearInterval(pingInterval);
        ws.close();
      }
    } else {
      clearInterval(pingInterval);
    }
  }, 30000); // Каждые 30 секунд

  // Очистка при отключении
  ws.on('close', () => {
    clearInterval(pingInterval);
  });
});

// Функция для отправки уведомлений
const sendNotification = (userId, notification) => {
  console.log('Попытка отправить уведомление пользователю:', userId);
  console.log('Уведомление:', notification);
  
  const client = clients.get(userId);
  
  if (!client) {
    console.log('Пользователь не найден в активных соединениях');
    return;
  }

  if (client.ws.readyState === WebSocket.OPEN) {
    try {
      console.log('Отправляем уведомление через WebSocket');
      const message = JSON.stringify({
        ...notification,
        userId,
        timestamp: new Date().toISOString()
      });
      console.log('Сообщение для отправки:', message);
      
      client.ws.send(message, (error) => {
        if (error) {
          console.error('Ошибка при отправке уведомления:', error);
          clients.delete(userId);
        } else {
          console.log('Уведомление успешно отправлено');
          client.lastActivity = Date.now();
        }
      });
    } catch (error) {
      console.error('Ошибка при отправке уведомления:', error);
      clients.delete(userId);
    }
  } else {
    console.log('WebSocket соединение не активно, состояние:', client.ws.readyState);
    clients.delete(userId);
  }
};

// Настройка CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3001', 'http://127.0.0.1:5173', 'http://127.0.0.1:3001'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

app.use(express.json());

// Middleware для логирования запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

const JWT_SECRET = 'your-secret-key'; // В продакшене использовать переменные окружения

// Middleware для валидации данных
const validateData = (req, res, next) => {
  const { taskId } = req.params;
  const { status, lastUpdated } = req.body;

  // Валидация статуса задачи
  if (status && !['pending', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ message: 'Недопустимый статус задачи' });
  }

  // Валидация метки времени
  if (lastUpdated && isNaN(new Date(lastUpdated).getTime())) {
    return res.status(400).json({ message: 'Недопустимый формат времени' });
  }

  // Валидация ID задачи
  if (taskId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return res.status(400).json({ message: 'Недопустимый формат ID задачи' });
  }

  next();
};

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Недействительный токен' });
    }
    req.user = user;
    next();
  });
};

// Регистрация пользователя
app.post('/api/auth/register', async (req, res) => {
  try {
    const { password, name, role } = req.body;
    console.log('Попытка регистрации:', { name, role });

    // Проверяем, существует ли пользователь с таким именем
    db.get('SELECT * FROM users WHERE name = ?', [name], (err, row) => {
      if (err) {
        console.error('Ошибка при проверке пользователя:', err);
        return res.status(500).json({ message: 'Ошибка при проверке пользователя' });
      }

      console.log('Результат проверки пользователя:', row);

      if (row) {
        console.log('Пользователь с таким именем уже существует');
        return res.status(400).json({ message: 'Пользователь с таким именем уже существует' });
      }

      // Если пользователь не существует, продолжаем регистрацию
      registerNewUser();
    });

    // Функция для регистрации нового пользователя
    async function registerNewUser() {
      try {
        let code = null;
        // Генерируем код только для Dependent
        if (role === 'dependent') {
          code = uuidv4().slice(0, 8).toUpperCase();
          console.log('Сгенерирован код для подопечного:', code);
        }

        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Пароль захеширован');

        // Сохраняем в базу
        const id = uuidv4();
        db.run(
          'INSERT INTO users (id, password, name, role, code) VALUES (?, ?, ?, ?, ?)',
          [id, hashedPassword, name, role, code],
          function(err) {
            if (err) {
              console.error('Ошибка при сохранении пользователя:', err);
              return res.status(500).json({ message: 'Ошибка при сохранении пользователя' });
            }

            console.log('Пользователь сохранен в базу:', { id, name, role });
            
            // Создаем JWT токен
            const token = jwt.sign(
              { id, role },
              JWT_SECRET,
              { expiresIn: '24h' } // Добавляем срок действия токена
            );
            console.log('Создан токен для нового пользователя');

            res.status(201).json({ 
              token,
              user: {
                id,
                name,
                role,
                code
              }
            });
          }
        );
      } catch (error) {
        console.error('Ошибка при регистрации:', error);
        res.status(500).json({ message: 'Ошибка при регистрации' });
      }
    }
  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    res.status(500).json({ message: 'Ошибка при регистрации' });
  }
});

// Вход пользователя
app.post('/api/auth/login', async (req, res) => {
  try {
    const { name, password } = req.body;
    console.log('Попытка входа для пользователя:', name);

    // Находим пользователя
    db.get('SELECT * FROM users WHERE name = ?', [name], async (err, user) => {
      if (err) {
        console.error('Ошибка при поиске пользователя:', err);
        return res.status(500).json({ message: 'Ошибка при входе' });
      }

      console.log('Найденный пользователь:', user);

      if (!user) {
        console.log('Пользователь не найден');
        return res.status(401).json({ message: 'Неверное имя или пароль' });
      }

      try {
        // Проверяем пароль
        const validPassword = await bcrypt.compare(password, user.password);
        console.log('Результат проверки пароля:', validPassword);

        if (!validPassword) {
          console.log('Неверный пароль');
          return res.status(401).json({ message: 'Неверное имя или пароль' });
        }

        // Создаем JWT токен
        const token = jwt.sign(
          { id: user.id, role: user.role },
          JWT_SECRET,
          { expiresIn: '24h' } // Добавляем срок действия токена
        );
        console.log('Создан токен для пользователя:', user.id);

        res.json({
          token,
          user: {
            id: user.id,
            name: user.name,
            role: user.role,
            code: user.code
          }
        });
      } catch (error) {
        console.error('Ошибка при проверке пароля:', error);
        res.status(500).json({ message: 'Ошибка при входе' });
      }
    });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({ message: 'Ошибка при входе' });
  }
});

// Получение кода подопечного
app.get('/api/dependent/code', authenticateToken, (req, res) => {
  if (req.user.role !== 'dependent') {
    return res.status(403).json({ message: 'Доступ запрещен' });
  }

  console.log('Запрос кода для подопечного:', req.user.id);
  
  db.get('SELECT code FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      console.error('Ошибка при поиске кода:', err);
      return res.status(500).json({ message: 'Ошибка при получении кода' });
    }

    console.log('Найденный пользователь:', user);
    
    if (!user || !user.code) {
      console.log('Код не найден');
      return res.status(404).json({ message: 'Код не найден' });
    }

    console.log('Отправляем код:', user.code);
    res.json({ code: user.code });
  });
});

// Связывание опекуна с подопечным
app.post('/api/guardian/link', authenticateToken, async (req, res) => {
  if (req.user.role !== 'guardian') {
    return res.status(403).json({ message: 'Доступ запрещен' });
  }

  const { code } = req.body;
  console.log('Попытка связывания с кодом:', code);
  console.log('ID опекуна:', req.user.id);

  try {
    // Находим подопечного по коду
    db.get('SELECT * FROM users WHERE code = ? AND role = ?', [code, 'dependent'], (err, dependent) => {
      if (err) {
        console.error('Ошибка при поиске подопечного:', err);
        return res.status(500).json({ message: 'Ошибка при поиске подопечного' });
      }

      console.log('Найденный подопечный:', dependent);

      if (!dependent) {
        console.log('Подопечный не найден');
        return res.status(404).json({ message: 'Неверный код подопечного' });
      }

      // Проверяем, не связан ли уже подопечный с другим опекуном
      if (dependent.guardian_id) {
        console.log('Подопечный уже связан с опекуном:', dependent.guardian_id);
        return res.status(400).json({ message: 'Этот подопечный уже связан с опекуном' });
      }

      // Обновляем guardian_id у подопечного
      db.run('UPDATE users SET guardian_id = ? WHERE id = ?', [req.user.id, dependent.id], function(err) {
        if (err) {
          console.error('Ошибка при обновлении подопечного:', err);
          return res.status(500).json({ message: 'Ошибка при связывании с подопечным' });
        }

        console.log('Подопечный успешно связан с опекуном');
        res.json({ 
          message: 'Связь установлена',
          dependent: {
            id: dependent.id,
            name: dependent.name
          }
        });
      });
    });
  } catch (error) {
    console.error('Ошибка связывания:', error);
    res.status(500).json({ message: 'Ошибка при связывании с подопечным' });
  }
});

// Получение информации о связанном подопечном
app.get('/api/guardian/dependent', authenticateToken, (req, res) => {
  if (req.user.role !== 'guardian') {
    return res.status(403).json({ message: 'Доступ запрещен' });
  }

  const dependent = db.prepare(`
    SELECT id, name 
    FROM users 
    WHERE guardian_id = ?
  `).get(req.user.id);

  res.json({ dependent });
});

// Создание задачи
app.post('/api/tasks', authenticateToken, (req, res) => {
  const { title, description, date, time, dependentId } = req.body;
  console.log('Создание задачи:', { title, description, date, time, dependentId, guardianId: req.user.id });

  try {
    // Проверяем, что опекун связан с этим подопечным
    db.get('SELECT * FROM users WHERE id = ? AND guardian_id = ?', [dependentId, req.user.id], (err, dependent) => {
      if (err) {
        console.error('Ошибка при проверке подопечного:', err);
        return res.status(500).json({ message: 'Ошибка при создании задачи' });
      }

      if (!dependent) {
        console.log('Подопечный не найден или не связан с опекуном');
        return res.status(403).json({ message: 'Нет доступа к этому подопечному' });
      }

      const id = uuidv4();
      const createdAt = new Date().toISOString();

      db.run(
        'INSERT INTO tasks (id, title, description, date, time, status, guardian_id, dependent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, title, description, date, time, 'pending', req.user.id, dependentId, createdAt],
        function(err) {
          if (err) {
            console.error('Ошибка при создании задачи:', err);
            return res.status(500).json({ message: 'Ошибка при создании задачи' });
          }

          console.log('Задача создана:', { id, title, description, date, time, status: 'pending', guardianId: req.user.id, dependentId });
          
          // Отправляем уведомление подопечному через WebSocket
          const notification = {
            type: 'new_task',
            title: 'Новая задача',
            body: `Вам назначена новая задача:\n${title}\n${description ? `Описание: ${description}` : ''}\nДата: ${new Date(date).toLocaleDateString('ru-RU')}\nВремя: ${time}`,
            taskId: id,
            timestamp: createdAt
          };
          
          console.log('Отправляем уведомление подопечному:', dependentId);
          sendNotification(dependentId, notification);
          
          res.status(201).json({ 
            id,
            title,
            description,
            date,
            time,
            status: 'pending',
            guardian_id: req.user.id,
            dependent_id: dependentId,
            created_at: createdAt
          });
        }
      );
    });
  } catch (error) {
    console.error('Ошибка создания задачи:', error);
    res.status(500).json({ message: 'Ошибка при создании задачи' });
  }
});

// Получение задач опекуна
app.get('/api/tasks/guardian', authenticateToken, (req, res) => {
  if (req.user.role !== 'guardian') {
    return res.status(403).json({ message: 'Доступ запрещен' });
  }

  console.log('Запрос задач для опекуна:', req.user.id);

  try {
    db.all(`
      SELECT t.*, u.name as dependent_name
      FROM tasks t
      JOIN users u ON t.dependent_id = u.id
      WHERE t.guardian_id = ?
      ORDER BY t.created_at DESC
    `, [req.user.id], (err, tasks) => {
      if (err) {
        console.error('Ошибка при получении задач:', err);
        return res.status(500).json({ message: 'Ошибка при получении задач' });
      }

      console.log('Найденные задачи:', tasks);
      res.json(tasks || []);
    });
  } catch (error) {
    console.error('Ошибка получения задач:', error);
    res.status(500).json({ message: 'Ошибка при получении задач' });
  }
});

// Получение задач подопечного
app.get('/api/tasks/dependent', authenticateToken, (req, res) => {
  if (req.user.role !== 'dependent') {
    return res.status(403).json({ message: 'Доступ запрещен' });
  }

  console.log('Запрос задач для подопечного:', req.user.id);

  try {
    db.all(`
      SELECT t.*, u.name as guardian_name
      FROM tasks t
      JOIN users u ON t.guardian_id = u.id
      WHERE t.dependent_id = ?
      ORDER BY t.created_at DESC
    `, [req.user.id], (err, tasks) => {
      if (err) {
        console.error('Ошибка при получении задач:', err);
        return res.status(500).json({ message: 'Ошибка при получении задач' });
      }

      console.log('Найденные задачи для подопечного:', tasks);
      res.json(tasks || []);
    });
  } catch (error) {
    console.error('Ошибка получения задач:', error);
    res.status(500).json({ message: 'Ошибка при получении задач' });
  }
});

// Вспомогательные функции для работы с sqlite3 через промисы
function runAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function(err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Обновление статуса задачи
app.patch('/api/tasks/:taskId/status', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Проверяем, что статус валидный
    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Неверный статус задачи' });
    }

    // Получаем задачу
    const task = await getAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    // Проверяем права доступа
    // Опекун может быть только тот, кто создал задачу
    const isGuardian = (task.guardian_id === userId);
    const isDependent = (task.dependent_id === userId);

    if (!isGuardian && !isDependent) {
      return res.status(403).json({ message: 'Нет доступа к этой задаче' });
    }

    // Обновляем статус
    await runAsync(
      'UPDATE tasks SET status = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?',
      [status, taskId]
    );

    // Получаем обновленную задачу
    const updatedTask = await getAsync(`
      SELECT t.*, u.name as dependent_name 
      FROM tasks t 
      LEFT JOIN users u ON t.dependent_id = u.id 
      WHERE t.id = ?
    `, [taskId]);

    // Отправляем уведомление через WebSocket
    const notification = {
      type: 'task_status_changed',
      taskId,
      newStatus: status,
      userId,
      timestamp: new Date().toISOString()
    };

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(notification));
      }
    });

    res.json(updatedTask);
  } catch (error) {
    console.error('Ошибка при обновлении статуса задачи:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
});

// Получение всех пользователей (для отладки)
app.get('/api/debug/users', (req, res) => {
  try {
    const users = db.prepare('SELECT id, name, role, code FROM users').all();
    console.log('Все пользователи в базе:', users);
    res.json(users);
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ message: 'Ошибка при получении пользователей' });
  }
});

// Получение информации о текущем пользователе
app.get('/api/auth/me', authenticateToken, (req, res) => {
  try {
    console.log('Запрос информации о пользователе:', req.user);
    
    // Используем callback для получения данных пользователя
    db.get('SELECT id, name, role FROM users WHERE id = ?', [req.user.id], (err, user) => {
      if (err) {
        console.error('Ошибка при поиске пользователя:', err);
        return res.status(500).json({ message: 'Ошибка при получении информации о пользователе' });
      }

      console.log('Найденный пользователь:', user);
      
      if (!user) {
        console.log('Пользователь не найден');
        return res.status(404).json({ message: 'Пользователь не найден' });
      }
      
      console.log('Отправляем данные пользователя:', user);
      res.json(user);
    });
  } catch (error) {
    console.error('Ошибка при получении информации о пользователе:', error);
    res.status(500).json({ message: 'Ошибка при получении информации о пользователе' });
  }
});

// Получение списка подопечных опекуна
app.get('/api/guardian/dependents', authenticateToken, (req, res) => {
  if (req.user.role !== 'guardian') {
    return res.status(403).json({ message: 'Доступ запрещен' });
  }

  console.log('Запрос списка подопечных для опекуна:', req.user.id);

  try {
    db.all('SELECT id, name FROM users WHERE guardian_id = ?', [req.user.id], (err, dependents) => {
      if (err) {
        console.error('Ошибка при получении списка подопечных:', err);
        return res.status(500).json({ message: 'Ошибка при получении списка подопечных' });
      }

      console.log('Найденные подопечные:', dependents);
      res.json(dependents || []);
    });
  } catch (error) {
    console.error('Ошибка при получении списка подопечных:', error);
    res.status(500).json({ message: 'Ошибка при получении списка подопечных' });
  }
});

// Функция для проверки и отправки уведомлений о запланированных задачах
const checkScheduledTasks = async () => {
  try {
    console.log('Проверка запланированных задач...');
    const now = new Date();
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60000);

    console.log('Текущее время:', now.toISOString());
    console.log('Время через 30 минут:', thirtyMinutesFromNow.toISOString());

    const tasks = await new Promise((resolve, reject) => {
      db.all(`
        SELECT t.*, u.id as user_id, u.role, u.name as user_name
        FROM tasks t
        JOIN users u ON (t.guardian_id = u.id OR t.dependent_id = u.id)
        WHERE t.status != 'completed'
        AND t.date IS NOT NULL
        AND t.time IS NOT NULL
        AND datetime(t.date || 'T' || t.time) BETWEEN datetime(?) AND datetime(?)
      `, [now.toISOString(), thirtyMinutesFromNow.toISOString()], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    console.log('Найдено задач для уведомлений:', tasks.length);
    console.log('Задачи:', tasks);

    for (const task of tasks) {
      const taskDateTime = new Date(`${task.date}T${task.time}`);
      const timeDiff = taskDateTime - now;
      
      console.log('Проверка задачи:', {
        id: task.id,
        title: task.title,
        date: task.date,
        time: task.time,
        timeDiff: timeDiff / 1000 / 60, // разница в минутах
        user_id: task.user_id,
        role: task.role
      });

      // Отправляем уведомление опекуну
      if (task.role === 'guardian') {
        console.log('Отправка уведомления опекуну:', task.user_id);
        sendNotification(task.user_id, {
          type: 'task_reminder',
          title: 'Напоминание о задаче',
          body: `Скоро наступает задача:\n${task.title}\n${task.description ? `Описание: ${task.description}` : ''}\nВремя: ${task.time}`,
          taskId: task.id,
          timestamp: new Date().toISOString()
        });
      }

      // Отправляем уведомление подопечному
      if (task.role === 'dependent') {
        console.log('Отправка уведомления подопечному:', task.user_id);
        sendNotification(task.user_id, {
          type: 'task_reminder',
          title: 'Напоминание о задаче',
          body: `Скоро наступает задача:\n${task.title}\n${task.description ? `Описание: ${task.description}` : ''}\nВремя: ${task.time}`,
          taskId: task.id,
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке запланированных задач:', error);
  }
};

// Запускаем проверку задач каждую минуту
setInterval(checkScheduledTasks, 60000);

// Запускаем первую проверку сразу после старта сервера
checkScheduledTasks();

// Запуск сервера
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});

// Удаление задачи
app.delete('/api/tasks/:taskId', authenticateToken, (req, res) => {
  const { taskId } = req.params;
  
  // Проверяем, что пользователь является опекуном
  if (req.user.role !== 'guardian') {
    return res.status(403).json({ message: 'Только опекун может удалять задачи' });
  }

  try {
    // Проверяем, что задача принадлежит этому опекуну
    db.get('SELECT * FROM tasks WHERE id = ? AND guardian_id = ?', [taskId, req.user.id], (err, task) => {
      if (err) {
        console.error('Ошибка при проверке задачи:', err);
        return res.status(500).json({ message: 'Ошибка при удалении задачи' });
      }

      if (!task) {
        return res.status(404).json({ message: 'Задача не найдена или нет доступа' });
      }

      // Удаляем задачу
      db.run('DELETE FROM tasks WHERE id = ?', [taskId], function(err) {
        if (err) {
          console.error('Ошибка при удалении задачи:', err);
          return res.status(500).json({ message: 'Ошибка при удалении задачи' });
        }

        // Отправляем уведомление подопечному
        const notification = {
          title: 'Задача удалена',
          body: `Задача "${task.title}" была удалена опекуном`,
          type: 'task_deleted'
        };

        // Здесь можно добавить логику отправки уведомления подопечному
        // Например, через WebSocket или Push API

        res.json({ message: 'Задача успешно удалена' });
      });
    });
  } catch (error) {
    console.error('Ошибка при удалении задачи:', error);
    res.status(500).json({ message: 'Ошибка при удалении задачи' });
  }
});