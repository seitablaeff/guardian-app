const CACHE_NAME = 'guardian-app-v1';
const API_CACHE_NAME = 'api-cache-v1';

// Кэшируем основные файлы и ресурсы
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll([
          '/',
          '/index.html',
          '/src/main.jsx',
          '/src/App.jsx',
          '/src/index.css',
          '/src/App.css',
          '/src/config.js',
          '/src/store.js',
          '/src/utils/db.js',
          '/src/components/AuthView.jsx',
          '/src/components/GuardianView.jsx',
          '/src/components/DependentView.jsx',
          '/src/components/LinkDependent.jsx'
        ]);
      }),
      caches.open(API_CACHE_NAME)
    ])
  );
});

// Обработка запросов
self.addEventListener('fetch', (event) => {
  // Обработка API-запросов
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      caches.open(API_CACHE_NAME).then(async (cache) => {
        try {
          // Пробуем получить ответ из кэша
          const cachedResponse = await cache.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }

          // Если в кэше нет, делаем сетевой запрос
          const response = await fetch(event.request);
          
          // Кэшируем успешные ответы
          if (response.ok) {
            const responseToCache = response.clone();
            cache.put(event.request, responseToCache);
          }
          
          return response;
        } catch (error) {
          console.error('Ошибка при обработке API-запроса:', error);
          // Возвращаем заглушку для офлайн-режима
          return new Response(
            JSON.stringify({ 
              error: 'offline',
              message: 'Нет подключения к интернету'
            }),
            {
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      })
    );
    return;
  }

  // Обработка остальных запросов
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }

        return fetch(event.request)
          .then((response) => {
            // Кэшируем только успешные GET-запросы
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // Если запрос не удался, возвращаем index.html
            return caches.match('/index.html')
              .then((response) => {
                if (response) {
                  return response;
                }
                // Если index.html не найден в кэше, возвращаем заглушку
                return new Response(
                  '<html><body><h1>Офлайн-режим</h1><p>Пожалуйста, проверьте подключение к интернету.</p></body></html>',
                  {
                    headers: { 'Content-Type': 'text/html' }
                  }
                );
              });
          });
      })
  );
});

// Очистка старых кэшей
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
}); 