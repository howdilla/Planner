const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'Server',
    password: '0000',
    port: 5432,
});

pool.connect()
    .then(() => console.log('БД подключена'))
    .catch(err => console.error('Ошибка подключения к БД', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000
    },
    name: 'sessionId'
}));

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    next();
};

app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/home');
    res.render('reg', { error: null });
});

app.get('/home', async (req, res) => {
    const user = req.session.user;

    if (!user || user?.role !== 'leader') {
        return res.redirect('/member-home');
    }

    const query = `
        SELECT
            COUNT(*) FILTER (WHERE author = $1 AND status = 'В процессе') AS author_count,
            COUNT(*) FILTER (
                WHERE $1 = ANY(string_to_array(COALESCE(executors, ''), ','))
                AND status = 'В процессе'
            ) AS executor_count,
            COUNT(*) FILTER (
                WHERE $1 = ANY(string_to_array(COALESCE(commentators, ''), ','))
                AND status = 'В процессе'
            ) AS commentator_count
        FROM tasks;
    `;

    try {
        const result = await pool.query(query, [user.email]);
        const counts = result.rows[0];

        res.render('index', {
            user: {
                email: user.email,
                name: user.name,
                lastname: user.lastname,
                role: user.role
            },
            counts: {
                author: counts.author_count,
                executor: counts.executor_count,
                commentator: counts.commentator_count
            }
        });
    } catch (err) {
        console.error('Ошибка при получении количества задач:', err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/member-home', async (req, res) => {
    try {
        const user = req.session.user;

        if (!user || user.role !== 'member') {
            return res.redirect('/home');
        }

        const email = user.email;

        const query = `
            SELECT
                COUNT(*) FILTER (WHERE author = $1 AND status = 'В процессе') AS author_count,
                COUNT(*) FILTER (
                    WHERE $1 = ANY(string_to_array(COALESCE(executors, ''), ','))
                    AND status = 'В процессе'
                ) AS executor_count,
                COUNT(*) FILTER (
                    WHERE $1 = ANY(string_to_array(COALESCE(commentators, ''), ','))
                    AND status = 'В процессе'
                ) AS commentator_count
            FROM tasks;
        `;

        const result = await pool.query(query, [email]);
        const counts = result.rows[0];

        res.render('mem_index', {
            user,
            counts: {
                author: counts.author_count || 0,
                executor: counts.executor_count || 0,
                commentator: counts.commentator_count || 0
            }
        });

    } catch (err) {
        console.error('Ошибка загрузки /member-home:', err);
        res.status(500).render('500');
    }
});

app.post('/register', async (req, res) => {
    const { name, lastname, email, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (name, lastname, email, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [name, lastname, email, hash, role]
        );
        req.session.user = {
            email: result.rows[0].email,
            name: result.rows[0].name,
            lastname: result.rows[0].lastname,
            role: result.rows[0].role
        };
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка регистрации:', err);
        res.json({ success: false, message: 'Пользователь уже существует или ошибка сервера.' });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.json({ success: false, message: 'Неверный email или пароль' });

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.json({ success: false, message: 'Неверный email или пароль' });

        req.session.user = {
            email: user.email,
            name: user.name,
            lastname: user.lastname,
            role: user.role
        };
        req.session.save(err => {
            if (err) return res.json({ success: false, message: 'Ошибка сервера' });
            res.json({ success: true, redirectTo: user.role === 'leader' ? '/home' : '/member-home' });
        });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.json({ success: false, message: 'Ошибка входа' });
    }
});

app.get('/info', (req, res) => {
    res.render('info');
});

// Получение задач
app.get('/tasks', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role === 'member') return res.redirect('/mem_tasks');

        // Получаем счетчики задач
        const countsQuery = `
            SELECT
                COUNT(*) FILTER (WHERE author = $1 AND status = 'В процессе') AS author_count,
                COUNT(*) FILTER (
                    WHERE $1 = ANY(string_to_array(COALESCE(executors, ''), ','))
                    AND status = 'В процессе'
                ) AS executor_count,
                COUNT(*) FILTER (
                    WHERE $1 = ANY(string_to_array(COALESCE(commentators, ''), ','))
                    AND status = 'В процессе'
                ) AS commentator_count
            FROM tasks
            WHERE user_email = $1;
        `;
        const countsResult = await pool.query(countsQuery, [req.session.user.email]);
        const counts = countsResult.rows[0];

        // Получаем сами задачи
        const tasksResult = await pool.query('SELECT * FROM tasks WHERE user_email = $1', [req.session.user.email]);
        const tasks = tasksResult.rows.map(task => ({
            id: task.id,
            name: task.name,
            description: task.description,
            startDate: task.start_date,
            endDate: task.end_date,
            plannedDays: task.planned_days,
            project: task.project,
            price: task.price,
            tags: task.tags ? task.tags.split(',') : [],
            status: task.status,
            type: task.type,
            priority: task.priority,
            author: task.author,
            executors: task.executors ? task.executors.split(',') : [],
            commentators: task.commentators ? task.commentators.split(',') : [],
            files: task.files ? task.files.split(',') : [],
            completed: task.completed,
            timeSpent: task.time_spent,
            completionDate: task.completion_date
        }));

        const projects = await pool.query(
            'SELECT id, name FROM projects WHERE user_email = $1',
            [req.session.user.email]
        );
        const membersRes = await pool.query('SELECT id, name FROM team_members');
        const teamMembers = membersRes.rows.map(m => ({
            id: m.id,
            name: m.name,
        }));

        res.render('tasks', {
            tasks,
            user: req.session.user,
            teamMembers,
            projects: projects.rows,
            counts: {
                author: counts.author_count || 0,
                executor: counts.executor_count || 0,
                commentator: counts.commentator_count || 0
            }
        });

    } catch (err) {
        console.error('Ошибка загрузки задач:', err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/mem_tasks', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'member') return res.redirect('/tasks');

        const countsQuery = `
            SELECT
                COUNT(*) FILTER (WHERE author = $1 AND status = 'В процессе') AS author_count,
                COUNT(*) FILTER (
                    WHERE $1 = ANY(string_to_array(COALESCE(executors, ''), ','))
                    AND status = 'В процессе'
                ) AS executor_count,
                COUNT(*) FILTER (
                    WHERE $1 = ANY(string_to_array(COALESCE(commentators, ''), ','))
                    AND status = 'В процессе'
                ) AS commentator_count
            FROM tasks
            WHERE user_email = $1;
        `;
        const countsResult = await pool.query(countsQuery, [req.session.user.email]);
        const counts = countsResult.rows[0];

        const result = await pool.query('SELECT * FROM tasks WHERE user_email = $1', [req.session.user.email]);
        const tasks = result.rows.map(task => ({
            id: task.id,
            name: task.name,
            description: task.description,
            startDate: task.start_date,
            endDate: task.end_date,
            plannedDays: task.planned_days,
            project: task.project,
            price: task.price,
            tags: task.tags ? task.tags.split(',') : [],
            status: task.status,
            type: task.type,
            priority: task.priority,
            author: task.author,
            executors: task.executors ? task.executors.split(',') : [],
            commentators: task.commentators ? task.commentators.split(',') : [],
            files: task.files ? task.files.split(',') : [],
            completed: task.completed,
            timeSpent: task.time_spent,
            completionDate: task.completion_date
        }));
        const projects = await pool.query(
            'SELECT id, name FROM projects WHERE user_email = $1',
            [req.session.user.email]
        );

        res.render('mem_task', {
            tasks,
            user: req.session.user,
            teamMembers: [],
            projects: projects.rows,
            counts: {
                author: counts.author_count || 0,
                executor: counts.executor_count || 0,
                commentator: counts.commentator_count || 0
            }
        });
    } catch (err) {
        console.error('Ошибка загрузки задач:', err);
        res.status(500).send('Ошибка сервера');
    }
});

async function recalculateProjectPrice(projectId) {
    const res = await pool.query('SELECT SUM(price) FROM tasks WHERE project = $1', [projectId]);
    const total = res.rows[0].sum || 0;

    await pool.query('UPDATE projects SET total_price = $1 WHERE id = $2', [total, projectId]);
}

async function recalculatePortfolioPrice(portfolioId) {
    const res = await pool.query('SELECT SUM(total_price) FROM projects WHERE portfolio_id = $1', [portfolioId]);
    const total = res.rows[0].sum || 0;

    await pool.query('UPDATE portfolios SET total_price = $1 WHERE id = $2', [total, portfolioId]);
}


app.post('/tasks', requireAuth, async (req, res) => {
    const {
        name, description, start_date, end_date, price, planned_days = 0,
        tags, status = 'new', project, type, priority, executors, commentators,
        files, completed = false, time_spent = 0, completion_date
    } = req.body;

    if (!name) {
        return res.status(400).json({
            success: false,
            message: 'Необходимо заполнить все поля'
        });
    }

    try {
        const result = await pool.query(`
            INSERT INTO tasks (
                name, description, start_date, end_date, planned_days, project, price, tags, status,
                type, priority, author, executors, commentators, files, completed, time_spent,
                completion_date, user_email
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19
            ) RETURNING *`,
            [
                name,
                description,
                start_date || null,
                end_date || null,
                planned_days,
                project || null,
                price || 0,
                tags ? tags.join(',') : null,
                status,
                type || 'task',
                priority || 'medium',
                req.session.user.email,
                Array.isArray(executors) ? executors.join(',') : null,
                Array.isArray(commentators) ? commentators.join(',') : null,
                Array.isArray(files) ? files.join(',') : null,
                completed,
                time_spent,
                completion_date || null,
                req.session.user.email
            ]
        );

        const createdTask = result.rows[0];

        if (createdTask.project) {
            await recalculateProjectPrice(createdTask.project);
            const projectRes = await pool.query('SELECT portfolio_id FROM projects WHERE id = $1', [createdTask.project]);
            if (projectRes.rows.length > 0) {
                await recalculatePortfolioPrice(projectRes.rows[0].portfolio_id);
            }
        }

        res.json({
            success: true,
            task: createdTask,
            redirectTo: req.session.user.role === 'member' ? '/mem_tasks' : '/tasks'
        });
    } catch (err) {
        console.error('Ошибка при добавлении задачи:', err);
        res.status(400).json({ success: false, message: 'Необходимо заполнить все поля' });
    }
});

app.put('/tasks/:id/update', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const taskData = req.body;

        const result = await pool.query(`
            UPDATE tasks SET 
                name = $1, description = $2, start_date = $3, end_date = $4, planned_days = $5,
                project = $6, price = $7, tags = $8, status = $9, type = $10, priority = $11,
                author = $12, executors = $13, commentators = $14, files = $15,
                completed = $16, time_spent = $17, completion_date = $18
            WHERE id = $19 AND user_email = $20 RETURNING *`,
            [
                taskData.name,
                taskData.description,
                taskData.start_date || null,
                taskData.end_date || null,
                taskData.planned_days || 0,
                taskData.project || null,
                taskData.price || 0,
                taskData.tags ? taskData.tags.join(',') : null,
                taskData.status || 'new',
                taskData.type || 'task',
                taskData.priority || 'medium',
                taskData.author || null,
                taskData.executors ? taskData.executors.join(',') : null,
                taskData.commentators ? taskData.commentators.join(',') : null,
                taskData.files ? taskData.files.join(',') : null,
                taskData.completed || false,
                taskData.time_spent || 0,
                taskData.completion_date || null,
                taskId,
                req.session.user.email
            ]
        );

        if (result.rows.length === 0) return res.status(404).json({ message: 'Задача не найдена' });

        res.json(result.rows[0]);
        const updatedTask = result.rows[0];

        if (updatedTask.project) {
            await recalculateProjectPrice(updatedTask.project);
            const projectRes = await pool.query('SELECT portfolio_id FROM projects WHERE id = $1', [updatedTask.project]);
            if (projectRes.rows.length > 0) {
                await recalculatePortfolioPrice(projectRes.rows[0].portfolio_id);
            }
        }
    } catch (err) {
        console.error('Ошибка при обновлении задачи:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Завершение задачи с расчетом времени
app.post('/tasks/:id/complete', requireAuth, async (req, res) => {
    const taskId = req.params.id;
    try {
        const result = await pool.query(
            'SELECT start_date FROM tasks WHERE id = $1 AND user_email = $2',
            [taskId, req.session.user.email]
        );

        if (result.rows.length === 0) return res.status(404).json({ message: 'Задача не найдена' });

        const startDate = new Date(result.rows[0].start_date);
        const now = new Date();
        const diffDays = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));

        await pool.query(`
            UPDATE tasks
            SET completed = true, status = 'completed', completion_date = $1, time_spent = $2
            WHERE id = $3 AND user_email = $4`,
            [now.toISOString(), diffDays, taskId, req.session.user.email]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при завершении задачи:', err);
        res.status(500).json({ message: 'Ошибка при завершении задачи' });
    }
});

app.post('/tasks/:id/delete', requireAuth, async (req, res) => {
    const taskId = req.params.id;
    try {
        const taskResult = await pool.query('SELECT project FROM tasks WHERE id = $1 AND user_email = $2', [taskId, req.session.user.email]);
        const projectId = taskResult.rows[0]?.project;

        await pool.query('DELETE FROM tasks WHERE id = $1 AND user_email = $2', [taskId, req.session.user.email]);

        if (projectId) {
            await recalculateProjectPrice(projectId);
            const projectRes = await pool.query('SELECT portfolio_id FROM projects WHERE id = $1', [projectId]);
            if (projectRes.rows.length > 0) {
                await recalculatePortfolioPrice(projectRes.rows[0].portfolio_id);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при удалении задачи:', err);
        res.status(500).json({ success: false, message: 'Ошибка при удалении задачи' });
    }
});


app.get('/user', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT name, lastname, email, role FROM users WHERE email = $1', [req.session.user.email]);

        if (result.rows.length === 0) {
            return res.status(404).render('404'); 
        }

        const user = result.rows[0];

        
        res.render(user.role === 'member' ? 'user_memb' : 'user', {
            user: {
                name: user.name,
                lastname: user.lastname,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Ошибка загрузки данных пользователя:', err);
        res.status(500).render('500');
    }
});

app.post('/user/update', requireAuth, async (req, res) => {
    const { name, lastname, email } = req.body;
    const currentEmail = req.session.user.email;

    try {
        const result = await pool.query(`
            UPDATE users
            SET name = $1, lastname = $2, email = $3
            WHERE email = $4
            RETURNING *`,
            [name, lastname, email, currentEmail]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        req.session.user = {
            email: result.rows[0].email,
            name: result.rows[0].name,
            lastname: result.rows[0].lastname,
            role: result.rows[0].role
        };

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при обновлении пользователя:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/user/delete', requireAuth, async (req, res) => {
    try {
        // Удаляем все задачи пользователя сначала
        await pool.query('DELETE FROM tasks WHERE user_email = $1', [req.session.user.email]);

        // Затем удаляем самого пользователя
        await pool.query('DELETE FROM users WHERE email = $1', [req.session.user.email]);

        // Уничтожаем сессию
        req.session.destroy(err => {
            if (err) {
                console.error('Ошибка при удалении сессии:', err);
                return res.status(500).json({ success: false, message: 'Ошибка при удалении сессии' });
            }

            res.json({
                success: true,
                redirect: '/?accountDeleted=true'
            });
        });
    } catch (err) {
        console.error('Ошибка при удалении учетной записи:', err);
        res.status(500).json({
            success: false,
            message: 'Ошибка при удалении учетной записи'
        });
    }
});

app.get('/port_project', requireAuth, (req, res) => {
    res.render('port_project', { user: req.session.user });
});

app.get('/port_memb', requireAuth, (req, res) => {
    res.render('port_memb', { user: req.session.user });
});

app.get('/project', requireAuth, (req, res) => {
    const { role } = req.session.user;

    console.log('Роль пользователя при /project:', role);

    if (role === 'leader') {
        return res.redirect('/port_project');
    }

    if (role === 'member') {
        return res.redirect('/port_memb');
    }

    return res.status(403).render('403');
});


// Получение всех портфелей и проектов
app.get('/api/portfolios', requireAuth, async (req, res) => {
    try {
        const portfoliosRes = await pool.query('SELECT * FROM portfolios WHERE user_email = $1', [req.session.user.email]);
        const portfolios = portfoliosRes.rows;

        for (const portfolio of portfolios) {
            const projectsRes = await pool.query('SELECT * FROM projects WHERE portfolio_id = $1', [portfolio.id]);
            const projects = projectsRes.rows;

            for (const project of projects) {
                const tasksRes = await pool.query('SELECT * FROM tasks WHERE project = $1', [project.id]);
                project.tasks = tasksRes.rows;
            }

            portfolio.projects = projects;
        }

        res.json({ success: true, portfolios });
    } catch (err) {
        console.error('Ошибка при загрузке портфелей:', err);
        res.json({ success: false, message: 'Ошибка сервера' });
    }
});



// Создание портфеля
app.post('/api/portfolios', requireAuth, async (req, res) => {
    const {
        name, description, plannedDeadline, status, plannedTime, actualTime,
        risks, features, responsible, currentDeadline
    } = req.body;

    try {
        await pool.query(`
            INSERT INTO portfolios (
                name, description, planned_deadline, status, planned_time,
                actual_time, risks, features, responsible, current_deadline, user_email
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [name, description, plannedDeadline, status, plannedTime, actualTime,
            risks, features, responsible, currentDeadline, req.session.user.email]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка создания портфеля:', err);
        res.json({ success: false, message: 'Ошибка сервера' });
    }
});

// Обновление портфеля
app.put('/api/portfolios/:id', requireAuth, async (req, res) => {
    const id = req.params.id;
    const {
        name, description, plannedDeadline, status, plannedTime, actualTime,
        risks, features, responsible, currentDeadline
    } = req.body;

    try {
        await pool.query(`
            UPDATE portfolios SET
                name = $1, description = $2, planned_deadline = $3, status = $4,
                planned_time = $5, actual_time = $6, risks = $7, features = $8,
                responsible = $9, current_deadline = $10
            WHERE id = $11 AND user_email = $12
        `, [name, description, plannedDeadline, status, plannedTime, actualTime,
            risks, features, responsible, currentDeadline, id, req.session.user.email]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка обновления портфеля:', err);
        res.json({ success: false, message: 'Ошибка сервера' });
    }
});

// Удаление портфеля
app.delete('/api/portfolios/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id); 

    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Некорректный ID' });
    }

    try {
        await pool.query(
            'DELETE FROM tasks WHERE project IN (SELECT CAST(id AS VARCHAR) FROM projects WHERE portfolio_id = $1)',
            [id]
        );
        await pool.query('DELETE FROM projects WHERE portfolio_id = $1', [id]);
        await pool.query('DELETE FROM portfolios WHERE id = $1 AND user_email = $2', [id, req.session.user.email]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка удаления портфеля:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});




// Создание проекта
app.post('/api/projects', requireAuth, async (req, res) => {
    const {
        name, description, plannedDeadline, status, plannedTime, actualTime,
        risks, features, responsible, currentDeadline, portfolioId
    } = req.body;

    const userEmail = req.session.user.email;

    if (!userEmail) {
        return res.status(401).json({ success: false, message: 'Пользователь не авторизован' });
    }

    if (!portfolioId) {
        return res.status(400).json({ success: false, message: 'portfolioId обязателен' });
    }

    try {
        await pool.query(`
            INSERT INTO projects 
            (name, description, planned_deadline, status, planned_time, actual_time,
             risks, features, responsible, current_deadline, user_email, portfolio_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            name, description, plannedDeadline, status, plannedTime, actualTime,
            risks, features, responsible, currentDeadline, userEmail, portfolioId
        ]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка создания проекта:', err);
        res.json({ success: false, message: 'Ошибка сервера' });
    }
});

// Обновление проекта
app.put('/api/projects/:id', requireAuth, async (req, res) => {
    const id = req.params.id;
    const {
        portfolioId, name, description, plannedDeadline, status,
        plannedTime, actualTime, risks, features, responsible, currentDeadline
    } = req.body;

    try {
        await pool.query(`
            UPDATE projects SET
                portfolio_id = $1, name = $2, description = $3, planned_deadline = $4,
                status = $5, planned_time = $6, actual_time = $7, risks = $8,
                features = $9, responsible = $10, current_deadline = $11
            WHERE id = $12
        `, [portfolioId, name, description, plannedDeadline, status,
            plannedTime, actualTime, risks, features, responsible, currentDeadline, id]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка обновления проекта:', err);
        res.json({ success: false, message: 'Ошибка сервера' });
    }
});


// Удаление проекта
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id); 

    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Некорректный ID проекта' });
    }

    try {
        // Удаляем задачи, связанные с проектом
        await pool.query(
            'DELETE FROM tasks WHERE project IN (SELECT CAST(id AS VARCHAR) FROM projects WHERE portfolio_id = $1)',
            [id]
        );


        // Удаляем сам проект
        await pool.query('DELETE FROM projects WHERE id = $1 AND user_email = $2', [id, req.session.user.email]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка удаления проекта:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.get('/boards', requireAuth, async (req, res) => {
    try {
        const {
            status, priority, project, tag,
            dateFrom, dateTo, portfolio, user
        } = req.query;

        let query = 'SELECT * FROM tasks WHERE user_email = $1';
        const values = [req.session.user.email];
        let index = 2;

        if (status) {
            query += ` AND status = $${index++}`;
            values.push(status);
        }

        if (priority) {
            query += ` AND priority = $${index++}`;
            values.push(priority);
        }

        if (project) {
            query += ` AND project = $${index++}`;
            values.push(project);
        }

        if (tag) {
            query += ` AND tags ILIKE $${index++}`;
            values.push(`%${tag}%`);
        }

        if (user) {
            query += ` AND executors ILIKE $${index++}`;
            values.push(`%${user}%`);
        }

        if (dateFrom && dateTo) {
            query += ` AND (start_date::date BETWEEN $${index} AND $${index + 1})`;
            values.push(dateFrom, dateTo);
            index += 2;
        } else if (dateFrom) {
            query += ` AND start_date::date = $${index++}`;
            values.push(dateFrom);
        } else if (dateTo) {
            query += ` AND start_date::date = $${index++}`;
            values.push(dateTo);
        }

        if (portfolio) {
            const projectsOfPortfolio = await pool.query(
                'SELECT id FROM projects WHERE portfolio_id = $1 AND user_email = $2',
                [portfolio, req.session.user.email]
            );
            const projectIds = projectsOfPortfolio.rows.map(p => p.id);

            if (projectIds.length > 0) {
                query += ` AND project = ANY($${index++})`;
                values.push(projectIds);
            } else {
                return res.render('desk', {
                    tasks: [],
                    user: req.session.user,
                    projects: [],
                    portfolios: [],
                    users: [],
                    tags: [],
                    status, priority, project, tag, dateFrom, dateTo, portfolio, user
                });
            }
        }

        const result = await pool.query(query, values);

        const tasks = result.rows.map(task => ({
            id: task.id,
            name: task.name,
            description: task.description,
            startDate: task.start_date,
            endDate: task.end_date,
            completionDate: task.completion_date,
            plannedDays: task.planned_days,
            project: task.project,
            price: task.price,
            tags: task.tags ? task.tags.split(',') : [],
            status: task.status,
            type: task.type,
            priority: task.priority,
            author: task.author,
            executors: task.executors ? task.executors.split(',') : [],
            commentators: task.commentators ? task.commentators.split(',') : [],
            files: task.files ? task.files.split(',') : [],
            completed: task.completed,
            timeSpent: task.time_spent
        }));

        const projects = (await pool.query(
            'SELECT id, name FROM projects WHERE user_email = $1',
            [req.session.user.email]
        )).rows;

        const portfolios = (await pool.query(
            'SELECT id, name FROM portfolios WHERE user_email = $1',
            [req.session.user.email]
        )).rows;

        const users = (await pool.query(
            'SELECT id, name FROM team_members'
        )).rows;

        const tagsRaw = await pool.query('SELECT DISTINCT tags FROM tasks WHERE tags IS NOT NULL');
        const tagSet = new Set();
        tagsRaw.rows.forEach(row => {
            row.tags.split(',').map(tag => tag.trim()).forEach(tag => tagSet.add(tag));
        });
        const tags = [...tagSet];

        if (req.session.user.role === 'member') {
            res.render('desk_memb', {
                tasks,
                user: req.session.user,
                projects,
                portfolios,
                users,
                tags,
                status, priority, project, tag, dateFrom, dateTo, portfolio, user
            });
        } else {
            res.render('desk', {
                tasks,
                user: req.session.user,
                projects,
                portfolios,
                users,
                tags,
                status, priority, project, tag, dateFrom, dateTo, portfolio, user
            });
        }
    } catch (err) {
        console.error('Ошибка при загрузке доски задач:', err);
        res.status(500).send('Ошибка сервера');
    }
});


app.get('/ochered', requireAuth, (req, res) => {
    const role = req.session.user.role;

    if (role === 'leader') {
        res.redirect('/queue/leader');
    } else if (role === 'member') {
        res.redirect('/queue/member');
    } else {
        res.status(403).render('403'); // доступ запрещён
    }
});

app.get('/queue/leader', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tasks WHERE user_email = $1', [req.session.user.email]);

        const tasks = result.rows.map(task => ({
            id: task.id,
            name: task.name,
            description: task.description,
            startDate: task.start_date,
            endDate: task.end_date,
            plannedDays: task.planned_days,
            project: task.project,
            price: task.price,
            tags: task.tags ? task.tags.split(',') : [],
            status: task.status,
            type: task.type,
            priority: task.priority,
            author: task.author,
            executors: task.executors ? task.executors.split(',') : [],
            commentators: task.commentators ? task.commentators.split(',') : [],
            files: task.files ? task.files.split(',') : [],
            completed: task.completed,
            timeSpent: task.time_spent,
            completionDate: task.completion_date
        }));

        res.render('ocher', { tasks });
    } catch (err) {
        console.error('Ошибка загрузки очереди (leader):', err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/queue/member', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tasks WHERE user_email = $1', [req.session.user.email]);

        const tasks = result.rows.map(task => ({
            id: task.id,
            name: task.name,
            description: task.description,
            startDate: task.start_date,
            endDate: task.end_date,
            plannedDays: task.planned_days,
            project: task.project,
            price: task.price,
            tags: task.tags ? task.tags.split(',') : [],
            status: task.status,
            type: task.type,
            priority: task.priority,
            author: task.author,
            executors: task.executors ? task.executors.split(',') : [],
            commentators: task.commentators ? task.commentators.split(',') : [],
            files: task.files ? task.files.split(',') : [],
            completed: task.completed,
            timeSpent: task.time_spent,
            completionDate: task.completion_date
        }));

        res.render('ocher_memb', { tasks });
    } catch (err) {
        console.error('Ошибка загрузки очереди (member):', err);
        res.status(500).send('Ошибка сервера');
    }
});


app.get('/goals', requireAuth, async (req, res) => {
    const role = req.session.user.role;

    if (role === 'leader') {
        res.render('celi');
    } else if (role === 'member') {
        res.render('celi_memb'); 
    } else {
        res.status(403).render('403'); // роль не определена
    }
});

app.get('/api/goals', requireAuth, async (req, res) => {
    try {
        const email = req.session.user.email;
        const result = await pool.query(
            'SELECT * FROM celi WHERE user_email = $1 ORDER BY id DESC',
            [email]
        );
        res.json(result.rows); 
    } catch (err) {
        console.error('Ошибка при получении целей:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


app.post('/api/goals', requireAuth, async (req, res) => {
    const { title, start_date, end_date, deadline, progress, files } = req.body;
    const email = req.session.user.email;
    try {
        await pool.query(
            `INSERT INTO celi (title, start_date, end_date, deadline, progress, files, user_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [title, start_date, end_date, deadline, progress || 0, JSON.stringify(files || []), email]
        );
        res.redirect('/goals');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при добавлении цели');
    }
});



app.post('/api/goals/update/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, start_date, end_date, deadline, progress, files } = req.body;
    const email = req.session.user.email;
    try {
        await pool.query(
            `UPDATE celi SET title = $1, start_date = $2, end_date = $3, deadline = $4, progress = $5, files = $6
             WHERE id = $7 AND user_email = $8`,
            [title, start_date, end_date, deadline, progress, JSON.stringify(files || []), id, email]
        );
        res.redirect('/goals');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при обновлении цели');
    }
});

app.post('/api/goals/delete/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const email = req.session.user.email;
    try {
        await pool.query(
            'DELETE FROM celi WHERE id = $1 AND user_email = $2',
            [id, email]
        );
        res.redirect('/goals');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении цели');
    }
});


app.post('/invite', requireAuth, async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, message: 'Некорректный email' });
    }

    try {
        
        const inviter = req.session.user;

        const transporter = nodemailer.createTransport({
            service: 'gmail', // можно заменить на 'yandex'
            auth: {
                user: 'k.forsova@gmail.com',        
                pass: 'ksxt rlht meez uytc'            
            }
        });

        const mailOptions = {
            from: `"Planner" <your_email@gmail.com>`,
            to: email,
            subject: 'Приглашение в систему планирования Planner',
            html: `
                <p>Здравствуйте!</p>
                <p>Пользователь <strong>${inviter.name} ${inviter.lastname}</strong> (${inviter.email}) приглашает вас присоединиться к системе управления задачами Planner.</p>
                <p><a href="http://localhost:3000/">Нажмите здесь, чтобы зарегистрироваться</a></p>
            `
        };

        
        await transporter.sendMail(mailOptions);

        res.json({ success: true, message: 'Приглашение отправлено на ' + email });
    } catch (err) {
        console.error('Ошибка при отправке письма:', err);
        res.status(500).json({ success: false, message: 'Не удалось отправить письмо' });
    }
});

app.get('/team', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const role = user.role || 'member';

        const membersRes = await pool.query('SELECT * FROM team_members');
        const members = membersRes.rows;

        for (let member of members) {
            const tasksRes = await pool.query('SELECT * FROM tasks WHERE user_email = $1', [member.email]);
            member.tasks = tasksRes.rows.map(task => ({
                id: task.id,
                title: task.name,
                project: task.project,
                priority: task.priority,
                dueDate: task.end_date
            }));
        }

        res.render(role === 'member' ? 'team_memb' : 'team', {
            user,
            teamMembers: members
        });
    } catch (err) {
        console.error('Ошибка при загрузке команды:', err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/api/search-users', requireAuth, async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 1) return res.json([]);

    try {
        const result = await pool.query(`
            SELECT name, lastname FROM users
            WHERE name ILIKE $1 OR lastname ILIKE $1
        `, [`%${q}%`]);

        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при поиске пользователей:', err);
        res.status(500).json([]);
    }
});


app.post('/api/add-to-team', requireAuth, async (req, res) => {
    const { name, lastname } = req.body;
    if (!name || !lastname) return res.status(400).json({ success: false });

    try {
        const exists = await pool.query(
            'SELECT 1 FROM team_member WHERE name = $1 AND lastname = $2',
            [name, lastname]
        );

        if (exists.rowCount > 0) return res.json({ success: false, message: 'Уже в команде' });

        await pool.query(
            'INSERT INTO team_member (name, lastname) VALUES ($1, $2)',
            [name, lastname]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка при добавлении в команду:', err);
        res.status(500).json({ success: false });
    }
});

app.get('/reports', requireAuth, async (req, res) => {
    try {
        const email = req.session.user.email;
        const role = req.session.user.role || 'member';

        // Получаем все проекты пользователя
        const projectsRes = await pool.query(
            'SELECT id, name, status FROM projects WHERE user_email = $1',
            [email]
        );
        const projects = projectsRes.rows;

        // Получаем все задачи пользователя
        const tasksRes = await pool.query(
            'SELECT * FROM tasks WHERE user_email = $1',
            [email]
        );

        // Форматируем задачи и связываем с проектами
        const tasks = tasksRes.rows.map(task => {
            const project = projects.find(p => Number(p.id) === Number(task.project));
            return {
                id: task.id,
                name: task.name,
                startDate: task.start_date,
                endDate: task.end_date,
                status: task.status,
                priority: task.priority,
                type: task.type,
                projectId: task.project, 
                projectName: project ? project.name : 'Без проекта',
                timeSpent: task.time_spent || 0,
                completed: task.completed
            };
       
        });
        console.log("tasks:", tasksRes.rows.map(t => ({
            id: t.id,
            name: t.name,
            project_id: t.project_id
        })));
        console.log(projects);
        const template = role === 'member' ? 'otch_memb' : 'otch';

        res.render(template, {
            user: req.session.user,
            tasks,
            projects
        });

    } catch (err) {
        console.error('Ошибка загрузки /reports:', err);
        res.status(500).send('Ошибка сервера');
    }
});


app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.redirect('/home');
        res.clearCookie('sessionId');
        res.redirect('/');
    });
});

app.use((req, res) => res.status(404).render('404'));
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);
    res.status(500).render('500');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
