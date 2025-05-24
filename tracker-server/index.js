const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const app = express();
const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Тестовый маршрут
app.get('/', (req, res) => {
  res.send('Server is running');
});

// Получение всех задач
app.get('/tasks', async (req, res) => {
  try {
    const tasks = await prisma.task.findMany();
    res.json(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при получении задач');
  }
});

// Добавление задачи вручную
app.post('/tasks', async (req, res) => {
  const { title, description, status } = req.body;
  try {
    const newTask = await prisma.task.create({
      data: { title, description, status },
    });
    res.json(newTask);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при создании задачи');
  }
});

// Загрузка и импорт задач из Excel
app.post('/upload', upload.single('excelFile'), async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.worksheets[0];

    const createdTasks = [];

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const title = row.getCell(1).value;
      const description = row.getCell(2).value;
      const status = row.getCell(3).value;

      if (title && description && status) {
        const task = await prisma.task.create({
          data: { title, description, status },
        });
        createdTasks.push(task);
      }
    }

    // Удаление файла после обработки
    fs.unlinkSync(req.file.path);

    res.json({ message: 'Задачи загружены из Excel', count: createdTasks.length });
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при обработке Excel файла');
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
