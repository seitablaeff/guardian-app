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
const wss = new WebSocket.Server({ server });

// Хранилище для активных соединений
const clients = new Map();

// Обработка WebSocket соединений
wss.on('connection', (ws, req) => {
  console.log('Новое WebSocket соединение');
  
  // Получаем токен из URL
  const url = new URL(req.url, 'ws://localhost');
  const token = url.searchParams.get('token');
  
  if (!token) {
    console.log('Отсутствует токен, закрываем соединение');
    ws.close(1008, 'Токен не предоставлен');
    return;
  }

  // Проверяем токен
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Ошибка верификации токена:', err.message);
      ws.close(1008, 'Недействительный токен');
      return;
    }

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
        message: 'Соединение установлено'
      }));
    } catch (error) {
      console.error('Ошибка при отправке подтверждения:', error);
    }

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
});

// Функция для отправки уведомлений
const sendNotification = (userId, notification) => {
  console.log('Попытка отправить уведомление пользователю:', userId);
  const client = clients.get(userId);
  
  if (!client) {
    console.log('Пользователь не найден в активных соединениях');
    return;
  }

  if (client.ws.readyState === WebSocket.OPEN) {
    try {
      console.log('Отправляем уведомление:', notification);
      client.ws.send(JSON.stringify(notification));
      client.lastActivity = Date.now();
    } catch (error) {
      console.error('Ошибка при отправке уведомления:', error);
      clients.delete(userId);
    }
  } else {
    console.log('WebSocket соединение не активно');
    clients.delete(userId);
  }
};

// Настройка CORS
app.use(cors({
  origin: 'http://localhost:5173', // URL вашего React-приложения
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

// Обновление статуса задачи
app.patch('/api/tasks/:taskId', authenticateToken, validateData, (req, res) => {
  const { status, lastUpdated } = req.body;
  const { taskId } = req.params;

  try {
    // Проверяем доступ к задаче и получаем текущую версию
    db.get(`
      SELECT t.*, u.name as guardian_name, d.name as dependent_name 
      FROM tasks t
      JOIN users u ON t.guardian_id = u.id
      JOIN users d ON t.dependent_id = d.id
      WHERE t.id = ? AND (t.guardian_id = ? OR t.dependent_id = ?)
    `, [taskId, req.user.id, req.user.id], (err, task) => {
      if (err) {
        console.error('Ошибка при проверке задачи:', err);
        return res.status(500).json({ message: 'Ошибка при обновлении задачи' });
      }

      if (!task) {
        return res.status(404).json({ message: 'Задача не найдена' });
      }

      // Проверяем конфликт версий
      if (lastUpdated && new Date(lastUpdated) < new Date(task.last_updated)) {
        return res.status(409).json({ 
          message: 'Конфликт версий',
          currentVersion: task.last_updated,
          currentStatus: task.status
        });
      }

      // Обновляем задачу
      const now = new Date().toISOString();
      db.run(
        'UPDATE tasks SET status = ?, last_updated = ? WHERE id = ?',
        [status, now, taskId],
        function(err) {
          if (err) {
            console.error('Ошибка при обновлении задачи:', err);
            return res.status(500).json({ message: 'Ошибка при обновлении задачи' });
          }

          // Отправляем уведомление о конфликте, если он был
          if (lastUpdated && new Date(lastUpdated) < new Date(task.last_updated)) {
            const notification = {
              title: 'Обнаружен конфликт версий',
              body: `Задача "${task.title}" была изменена другим пользователем. Текущий статус: ${task.status}`,
              type: 'conflict'
            };

            if (req.user.role === 'guardian') {
              console.log(`Отправка уведомления опекуну ${task.guardian_name}:`, notification);
            } else {
              console.log(`Отправка уведомления подопечному ${task.dependent_name}:`, notification);
            }
          }

          res.json({ 
            id: taskId,
            status,
            lastUpdated: now
          });
        }
      );
    });
  } catch (error) {
    console.error('Ошибка при обновлении задачи:', error);
    res.status(500).json({ message: 'Ошибка при обновлении задачи' });
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

    const tasks = await db.all(`
      SELECT t.*, u.id as user_id, u.role
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      WHERE t.status != 'completed'
      AND t.date IS NOT NULL
      AND t.time IS NOT NULL
      AND datetime(t.date || 'T' || t.time) BETWEEN datetime(?) AND datetime(?)
    `, [now.toISOString(), thirtyMinutesFromNow.toISOString()]);

    console.log('Найдено задач для уведомлений:', tasks.length);

    for (const task of tasks) {
      const taskDateTime = new Date(`${task.date}T${task.time}`);
      const timeDiff = taskDateTime - now;
      
      // Отправляем уведомление опекуну
      if (task.role === 'guardian') {
        sendNotification(task.user_id, {
          type: 'task_reminder',
          title: 'Напоминание о задаче',
          body: `Скоро наступает задача:\n${task.title}\n${task.description ? `Описание: ${task.description}` : ''}\nВремя: ${task.time}`
        });
      }

      // Отправляем уведомление подопечному
      if (task.role === 'dependent') {
        sendNotification(task.user_id, {
          type: 'task_reminder',
          title: 'Напоминание о задаче',
          body: `Скоро наступает задача:\n${task.title}\n${task.description ? `Описание: ${task.description}` : ''}\nВремя: ${task.time}`
        });
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке запланированных задач:', error);
  }
};

// Запускаем проверку задач каждую минуту
setInterval(checkScheduledTasks, 60000);

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