# 🛠 Инструкция по запуску веб-приложения на локальном сервере

## Содержание
- [Технологический стек](https://github.com/howdilla/Planner/edit/main/INSTALL.md#%EF%B8%8F-%D1%82%D0%B5%D1%85%D0%BD%D0%BE%D0%BB%D0%BE%D0%B3%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9-%D1%81%D1%82%D0%B5%D0%BA)
- [Инструкция по установке и запуску](https://github.com/howdilla/Planner/edit/main/INSTALL.md#-%D0%B8%D0%BD%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%86%D0%B8%D1%8F-%D0%BF%D0%BE-%D1%83%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%BA%D0%B5-%D0%B8-%D0%B7%D0%B0%D0%BF%D1%83%D1%81%D0%BA%D1%83).

## ⚙️ Технологический стек

- Серверная часть - Node.js
- Интерфейс - HTML
- Язык разработки - JavaScript (Node.js)
- Передача данных - fetch() API
- Обмен данными - JSON
- Система управления базами данных - PostgreSQL

## 📖 Инструкция по установке и запуску 

### 1. Установка необходимого ПО  
Перед началом работы необходимо установить:
- Node.js (включает npm)
- PostgreSQL

### 2. Настройка проекта
1. Создайте папку для проекта, используя командную строку:  
   ![image](https://github.com/user-attachments/assets/e540c91c-93a6-4f71-b9ea-d3f3947268e5)
2. Инициализируйте проект Node.js, используя командную строку:  
   ![image](https://github.com/user-attachments/assets/e3141aa0-f615-4d2c-8503-7cd0fff63504)
3. Установите необходимые зависимости, используя командную строку:
   ![image](https://github.com/user-attachments/assets/509005a3-0c9e-48aa-89b3-d1dfbbbe22ed)

### 3. Структура проекта
Скопируйте следующую структуру папок и файлов в ваш проект:  
![image](https://github.com/user-attachments/assets/1b0083c9-aea7-4ac7-882c-db4cd409b53a)

### 4. Настройка сервера
1. Скопируйте содержимое файла server.js из нашего проекта в ваш файл server.js.

2. Добавьте папку views с HTML-страницами из нашего проекта в ваш проект.

3. Создайте файл .env и настройте переменные окружения (пример):  
![image](https://github.com/user-attachments/assets/b74ebc13-37ee-496f-b020-0322a869728a)

### 5. Настройка базы данных 
1. Создайте базу данных в PostgreSQL:  
   ![image](https://github.com/user-attachments/assets/a0090e18-205e-4e4c-8d17-85ce6f545a55)
2. Создайте следующие таблицы:
   ![image](https://github.com/user-attachments/assets/6af10fa7-b8fd-4d26-b9f3-df1aa623e085)
   ![image](https://github.com/user-attachments/assets/ffa9d0ba-85d9-4066-99d4-c4d1f62f03de)
   ![image](https://github.com/user-attachments/assets/97361bac-4129-4388-8ba8-fd0b1d05cf04)





### 6. Запуск приложения
Запустите сервер, используя командную строку:  
![image](https://github.com/user-attachments/assets/71873d11-0614-4a93-9edd-857fb4846662)  
Приложение будет доступно по адресу: http://localhost:3000 (или другому порту, указанному в server.js).

