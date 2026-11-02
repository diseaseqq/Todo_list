// ===== СОСТОЯНИЕ ПРИЛОЖЕНИЯ =====
let tasks = [];
let categories = [];
let archivedTasks = [];
let currentFilter = 'all';
let currentCategoryFilter = null;
let currentSort = 'created';
let searchQuery = '';
let editingId = null;
let lastFocusedElement = null;
let csrfToken = null;
let currentAccount = null;
let categoriesById = new Map();
let categoryIdsByName = new Map();

async function apiRequest(path, options = {}) {
    const headers = { Accept: 'application/json' };
    const requestOptions = {
        method: options.method || 'GET',
        credentials: 'same-origin',
        headers
    };
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        requestOptions.body = JSON.stringify(options.body);
    }
    if (options.csrf !== false && requestOptions.method !== 'GET') {
        if (!csrfToken) await refreshCsrfToken();
        headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(path, requestOptions);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload?.error?.message || 'Не удалось выполнить запрос к серверу.');
        error.code = payload?.error?.code || 'request_failed';
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function refreshCsrfToken() {
    const payload = await apiRequest('/api/auth/csrf', { csrf: false });
    csrfToken = payload.csrf_token;
    return csrfToken;
}

function showLogin(message = '') {
    currentAccount = null;
    tasks = [];
    archivedTasks = [];
    categories = [];
    categoriesById.clear();
    categoryIdsByName.clear();
    editingId = null;
    document.getElementById('task-app').classList.add('hidden');
    document.getElementById('archive-btn').classList.add('hidden');
    document.getElementById('edit-modal').classList.add('hidden');
    document.getElementById('archive-modal').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('auth-loading').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
    const error = document.getElementById('login-error');
    error.textContent = message;
    error.classList.toggle('hidden', !message);
}

function showTaskApp(account) {
    currentAccount = account;
    document.getElementById('account-email').textContent = account.email;
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('task-app').classList.remove('hidden');
    document.getElementById('archive-btn').classList.remove('hidden');
}

function mapApiSubtask(subtask) {
    return { id: subtask.id, title: subtask.title, completed: Boolean(subtask.is_completed), sortOrder: Number(subtask.sort_order) };
}

function mapApiTask(task) {
    const category = task.category_id ? categoriesById.get(task.category_id)?.name || null : null;
    return {
        id: task.id,
        title: task.title,
        description: task.description,
        completed: Boolean(task.is_completed),
        priority: task.priority,
        dueDate: task.due_date,
        category,
        subtasks: (task.subtasks || []).map(mapApiSubtask),
        recurrence: normalizeRecurrence(task.recurrence),
        createdAt: Date.parse(task.created_at) || Date.now(),
        deletedAt: task.archived_at ? Date.parse(task.archived_at) || Date.now() : undefined,
        version: Number(task.version)
    };
}

function toApiTask(task) {
    const recurrence = normalizeRecurrence(task.recurrence);
    return {
        title: task.title,
        description: task.description || null,
        priority: task.priority,
        due_date: task.dueDate || null,
        category_id: task.category ? categoryIdsByName.get(task.category) || null : null,
        recurrence: recurrence ? { type: recurrence.type, ...(recurrence.type === 'custom' ? { interval: recurrence.interval } : {}) } : null
    };
}

async function loadRemoteData() {
    const [categoryPayload, activePayload, archivePayload] = await Promise.all([
        apiRequest('/api/categories'),
        apiRequest('/api/tasks?archived=false&sort=created&direction=desc'),
        apiRequest('/api/tasks?archived=true&sort=created&direction=desc')
    ]);
    categoriesById = new Map(categoryPayload.categories.map(category => [category.id, category]));
    categoryIdsByName = new Map(categoryPayload.categories.map(category => [category.name, category.id]));
    categories = categoryPayload.categories.map(category => category.name);
    tasks = activePayload.tasks.map(mapApiTask);
    archivedTasks = archivePayload.tasks.map(mapApiTask);
    renderAll();
    updateArchiveCount();
    if (!document.getElementById('archive-modal').classList.contains('hidden')) renderArchive();
}

function reportApiError(error) {
    if (error.status === 401) {
        showLogin('Сессия завершилась. Войдите снова.');
        return;
    }
    if (error.code === 'csrf_failed') {
        refreshCsrfToken().catch(() => {});
        Toast.warning('Защитный токен обновлён. Повторите действие.', 4000, 'Повторите запрос');
        return;
    }
    if (error.status === 409 && editingId !== null) {
        closeEditModal();
        Toast.warning('Задача изменилась на сервере. Актуальные данные загружены; откройте задачу заново.', 4500, 'Нужно обновить задачу');
        loadRemoteData().catch(() => {});
        return;
    }
    Toast.error(error.message || 'Не удалось сохранить изменения.', 4500, 'Ошибка сервера');
    if (error.status === 409) {
        loadRemoteData().catch(() => {});
    }
}

// ===== ТЕМНАЯ ТЕМА =====
const THEME_KEY = 'todo_theme';
let storageWarningPending = false;
let storageWarningScheduled = false;

// Загрузка сохраненной темы
function loadTheme() {
    const savedTheme = getStoredValue(THEME_KEY);
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        document.body.classList.add('dark-theme');
        const themeBtn = document.getElementById('theme-toggle-btn');
        if (themeBtn) themeBtn.textContent = '☀️';
    } else {
        document.body.classList.remove('dark-theme');
        const themeBtn = document.getElementById('theme-toggle-btn');
        if (themeBtn) themeBtn.textContent = '🌙';
    }
}

// Переключение темы
function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    setStoredValue(THEME_KEY, isDark ? 'dark' : 'light');
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) themeBtn.textContent = isDark ? '☀️' : '🌙';
}

// Инициализация кнопки переключения темы
const themeBtn = document.getElementById('theme-toggle-btn');
if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
}

// Константы для валидации
const MIN_TITLE_LENGTH = 3;
const MAX_TITLE_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 500; // 🆕
// Функция проверки длины названия
function validateTitle(title) {
    if (title.length < MIN_TITLE_LENGTH) {
        return `Название должно содержать минимум ${MIN_TITLE_LENGTH} символа`;
    }
    if (title.length > MAX_TITLE_LENGTH) {
        return `Название не должно превышать ${MAX_TITLE_LENGTH} символов`;
    }
    return null; // null = всё ок
}


// ===== РАБОТА С localStorage =====
function getStoredValue(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.warn(`Не удалось прочитать localStorage: ${key}`, error);
        return null;
    }
}

function setStoredValue(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.error(`Не удалось сохранить данные в localStorage: ${key}`, error);
        storageWarningPending = true;
        if (!storageWarningScheduled) {
            storageWarningScheduled = true;
            setTimeout(() => {
                storageWarningScheduled = false;
                if (storageWarningPending) {
                    storageWarningPending = false;
                    Toast.warning('Изменения не удалось сохранить в этом браузере. Освободите место в хранилище и повторите действие.', 0, 'Ошибка сохранения');
                }
            }, 0);
        }
        return false;
    }
}

function getSubtaskProgress(task) {
    const subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];
    const total = subtasks.length;
    const completed = subtasks.filter(subtask => subtask.completed).length;
    return { completed, total };
}

function normalizeRecurrence(recurrence) {
    if (!recurrence || typeof recurrence !== 'object') return null;

    const type = ['daily', 'weekly', 'monthly', 'custom'].includes(recurrence.type)
        ? recurrence.type
        : null;

    if (!type) return null;

    const interval = type === 'custom'
        ? Math.min(365, Math.max(1, Number.isInteger(recurrence.interval) ? recurrence.interval : 1))
        : 1;

    return { type, interval };
}

function getRecurrenceLabel(recurrence) {
    if (!recurrence) return '';

    if (recurrence.type === 'daily') return 'Повтор: каждый день';
    if (recurrence.type === 'weekly') return 'Повтор: каждую неделю';
    if (recurrence.type === 'monthly') return 'Повтор: каждый месяц';
    if (recurrence.type === 'custom') return `Повтор: каждые ${recurrence.interval} дн.`;

    return '';
}

function getRecurrenceFromInputs(selectId, intervalId) {
    const type = document.getElementById(selectId).value;

    if (!['daily', 'weekly', 'monthly', 'custom'].includes(type)) {
        return null;
    }

    const interval = type === 'custom'
        ? Math.min(365, Math.max(1, Number.parseInt(document.getElementById(intervalId).value, 10) || 1))
        : 1;

    return { type, interval };
}

function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function exportData() {
    const backup = {
        format: 'todo-list-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks,
        archivedTasks,
        categories
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `todo-backup-${formatDateInput(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    Toast.success('Резервная копия скачана', 3000, 'Готово');
}

// ===== УТИЛИТЫ =====
function parseDateOnly(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return null;
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

function isOverdue(task) {
    if (!task.dueDate || task.completed) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const due = parseDateOnly(task.dueDate);
    return due ? due < today : false;
}

function formatDate(dateStr) {
    const date = parseDateOnly(dateStr);
    if (!date) return '';

    return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function getPriorityLabel(p) {
    const labels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
    return labels[p] || p;
}

// ===== CRUD ОПЕРАЦИИ =====
async function addSubtask(taskId, input) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;

    const title = input.value.trim();
    if (!title) {
        input.focus();
        return;
    }

    if (title.length > 150) {
        Toast.warning('Подзадача не должна превышать 150 символов', 3000, 'Слишком длинное название');
        input.focus();
        return;
    }

    try {
        const response = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/subtasks`, {
            method: 'POST', body: { task_version: task.version, title }
        });
        task.version = response.task_version;
        task.subtasks = response.subtasks.map(mapApiSubtask);
        renderAll();
    } catch (error) {
        reportApiError(error);
        return;
    }

    requestAnimationFrame(() => {
        const nextInput = document.querySelector('.subtask-input[data-task-id="' + taskId + '"]');
        if (nextInput) nextInput.focus();
    });
}

async function toggleSubtask(taskId, subtaskId) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;

    const subtask = task.subtasks.find(item => item.id === subtaskId);
    if (!subtask) return;

    try {
        const response = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`, {
            method: 'PATCH', body: { task_version: task.version, is_completed: !subtask.completed }
        });
        task.version = response.task_version;
        task.subtasks = response.subtasks.map(mapApiSubtask);
        renderAll();
    } catch (error) {
        reportApiError(error);
    }
}

async function deleteSubtask(taskId, subtaskId) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;

    const index = task.subtasks.findIndex(item => item.id === subtaskId);
    if (index === -1) return;

    try {
        const response = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`, {
            method: 'DELETE', body: { task_version: task.version }
        });
        task.version = response.task_version;
        task.subtasks = response.subtasks.map(mapApiSubtask);
        renderAll();
    } catch (error) {
        reportApiError(error);
    }
}

async function addTask() {
    const titleInput = document.getElementById('task-input');
    const descriptionInput = document.getElementById('task-description');
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    
    if (!title) {
        Toast.error('Введите название задачи', 3000, 'Ошибка');
        return;
    }
    
    const error = validateTitle(title);
    if (error) {
        Toast.warning(error, 3500, 'Некорректное название');
        titleInput.focus();
        return;
    }
    
    // Проверка длины описания
    if (description.length > MAX_DESCRIPTION_LENGTH) {
       Toast.error(`Описание не должно превышать ${MAX_DESCRIPTION_LENGTH} символов`, 3500, `Некорректное написание`);
        descriptionInput.focus();
        return;
    }

    const task = {
        title: title,
        description: description || null,
        priority: document.getElementById('priority-input').value,
        dueDate: document.getElementById('date-input').value || null,
        category: document.getElementById('category-input').value || null,
        recurrence: getRecurrenceFromInputs('recurrence-input', 'recurrence-interval'),
    };

    try {
        const payload = await apiRequest('/api/tasks', { method: 'POST', body: toApiTask(task) });
        tasks.unshift(mapApiTask(payload.task));
    } catch (error) {
        reportApiError(error);
        return;
    }
    titleInput.value = '';
    descriptionInput.value = ''; // 🆕 Очищаем описание
    searchQuery = '';
    document.getElementById('search-input').value = '';
    document.getElementById('date-input').value = '';
    document.getElementById('recurrence-input').value = '';
    document.getElementById('recurrence-interval').value = 1;
    updateRecurrenceIntervalVisibility('recurrence-input', 'recurrence-interval');
    renderAll();
    Toast.success(`Задача добавлена`, 3000, 'Успешно');
}

async function deleteTask(id) {
    if (!confirm('Переместить задачу в архив?')) return;
    
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return;
    
    const task = tasks[taskIndex];
    try {
        const response = await apiRequest(`/api/tasks/${encodeURIComponent(id)}/archive`, {
            method: 'POST', body: { version: task.version }
        });
        tasks.splice(taskIndex, 1);
        archivedTasks.unshift(mapApiTask(response.task));
    } catch (error) {
        reportApiError(error);
        return;
    }
    renderAll();
    Toast.success(`Задача перемещена в архив`, 3000, 'Успешно');
}

async function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const nextCompleted = !task.completed;
    try {
        const response = await apiRequest(`/api/tasks/${encodeURIComponent(id)}/complete`, {
            method: 'POST', body: { version: task.version, is_completed: nextCompleted }
        });
        const updated = mapApiTask(response.task);
        tasks[tasks.findIndex(item => item.id === id)] = updated;
    } catch (error) {
        reportApiError(error);
        return;
    }
    try {
        await loadRemoteData();
    } catch (error) {
        Toast.warning('Изменение сохранено, но список не удалось обновить. Обновите страницу.', 4500, 'Список не обновлён');
    }
    renderAll();
    const status = tasks.find(item => item.id === id)?.completed ? 'выполнена' : 'возвращена в активные';
    Toast.success(`Задача "${task.title}" ${status}`, 2500, 'Статус изменён');
}

function openEditModal(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    lastFocusedElement = document.activeElement;
    editingId = id;
    document.getElementById('edit-title').value = task.title;
    const editTitleCounter = document.getElementById('edit-title').parentElement.querySelector('.char-counter');
    if (editTitleCounter) {
        const length = task.title.length;
        editTitleCounter.textContent = `${length} / ${MAX_TITLE_LENGTH}`;
        editTitleCounter.classList.toggle('counter-warning', length > 0 && length < MIN_TITLE_LENGTH);
        editTitleCounter.classList.remove('counter-error');
    }
    document.getElementById('edit-description').value = task.description || '';
    document.getElementById('edit-priority').value = task.priority;
    document.getElementById('edit-date').value = task.dueDate || '';
    document.getElementById('edit-category').value = task.category || '';
    const editRecurrence = task.recurrence || null;
    document.getElementById('edit-recurrence').value = editRecurrence?.type || '';
    document.getElementById('edit-recurrence-interval').value = editRecurrence?.interval || 1;
    updateRecurrenceIntervalVisibility('edit-recurrence', 'edit-recurrence-interval');
    
    //  Обновляем счётчик описания
    const editDescCounter = document.querySelector('#edit-description + .textarea-counter');
    if (editDescCounter) {
        const len = (task.description || '').length;
        editDescCounter.textContent = `${len} / ${MAX_DESCRIPTION_LENGTH}`;
        editDescCounter.classList.remove('counter-warning', 'counter-error');
    }
    
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('hidden');
    document.getElementById('edit-title').focus();
}

async function saveEdit() {
    const task = tasks.find(t => t.id === editingId);
    if (!task) return;

    const newTitle = document.getElementById('edit-title').value.trim();
    const newDescription = document.getElementById('edit-description').value.trim();
    
    if (!newTitle) {
       Toast.error('Введите название задачи', 3000, 'Ошибка');
        return;
    }
    
    const error = validateTitle(newTitle);
    if (error) {
        Toast.warning(error, 3500, 'Некорректное название');
        document.getElementById('edit-title').focus();
        return;
    }
    
    if (newDescription.length > MAX_DESCRIPTION_LENGTH) {
        Toast.error(`Описание не должно превышать ${MAX_DESCRIPTION_LENGTH} символов`, 3000, `Ошибка`);
        document.getElementById('edit-description').focus();
        return;
    }
    
    const updated = {
        ...task,
        title: newTitle,
        description: newDescription || null,
        priority: document.getElementById('edit-priority').value,
        dueDate: document.getElementById('edit-date').value || null,
        category: document.getElementById('edit-category').value || null,
        recurrence: getRecurrenceFromInputs('edit-recurrence', 'edit-recurrence-interval')
    };
    try {
        const payload = await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, {
            method: 'PATCH', body: { version: task.version, ...toApiTask(updated) }
        });
        tasks[tasks.findIndex(item => item.id === task.id)] = mapApiTask(payload.task);
    } catch (error) {
        reportApiError(error);
        return;
    }
    closeEditModal();
    renderAll();
    Toast.success(`Задача обновлена`, 3000, 'Изменения сохранены');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    editingId = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
    }
    lastFocusedElement = null;
}

// ===== КАТЕГОРИИ =====
async function addCategory() {
    const input = document.getElementById('new-category'); // ← правильный id
    const name = input.value.trim();
    
    if (!name) {
        Toast.error('Введите название категории!', 3000, `Ошибка`);
        return;
    }
    
    const MAX_CATEGORY_LENGTH = 50;
    if (name.length > MAX_CATEGORY_LENGTH) {
        Toast.warning(`Название категории не должно превышать ${MAX_CATEGORY_LENGTH} символов`, 3500, 'Слишком длинное название');
        input.focus();
        return;
    }

    if (categories.some(category => category.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'))) {
        Toast.error('Такая категория уже существует!', 3000, `Ошибка`);
        return;
    }

    try {
        const payload = await apiRequest('/api/categories', { method: 'POST', body: { name } });
        categoriesById.set(payload.category.id, payload.category);
        categoryIdsByName.set(payload.category.name, payload.category.id);
        categories.push(payload.category.name);
    } catch (error) {
        reportApiError(error);
        return;
    }
    input.value = '';
    renderAll();
    Toast.success(`Категория добавлена`, 3000, `Успешно`)
}

// ===== ФИЛЬТРАЦИЯ, ПОИСК, СОРТИРОВКА =====
function getFilteredTasks() {
    let result = [...tasks];

    if (currentFilter === 'active') result = result.filter(t => !t.completed);
    else if (currentFilter === 'done') result = result.filter(t => t.completed);
    else if (currentFilter === 'overdue') result = result.filter(t => isOverdue(t));

    if (currentCategoryFilter) {
        result = result.filter(t => t.category === currentCategoryFilter);
    }

    if (searchQuery) {
        const q = searchQuery.trim().toLocaleLowerCase('ru-RU');
        result = result.filter(t =>
            t.title.toLocaleLowerCase('ru-RU').includes(q) ||
            (t.description || '').toLocaleLowerCase('ru-RU').includes(q)
        );
    }

    const priorityOrder = { high: 3, medium: 2, low: 1 };
    
    result.sort((a, b) => {
        if (currentSort === 'created') return b.createdAt - a.createdAt;
        if (currentSort === 'dueDate') {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return (parseDateOnly(a.dueDate)?.getTime() || 0) - (parseDateOnly(b.dueDate)?.getTime() || 0);
        }
        if (currentSort === 'priority') return priorityOrder[b.priority] - priorityOrder[a.priority];
        if (currentSort === 'title') return a.title.localeCompare(b.title, 'ru');
        return 0;
    });

    return result;
}

// ===== СТАТИСТИКА =====
function updateStats() {
    const total = tasks.length;
    const done = tasks.filter(t => t.completed).length;
    const active = total - done;
    const overdue = tasks.filter(t => isOverdue(t)).length;
    const archived = archivedTasks.length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-done').textContent = done;
    document.getElementById('stat-overdue').textContent = overdue;
    document.getElementById('stat-archived').textContent = archived;

    // Визуальная индикация плашки
    const archiveStat = document.getElementById('archive-stat-btn');
    if (archived > 0) {
        archiveStat.classList.add('has-items');
    } else {
        archiveStat.classList.remove('has-items');
    }

    // Синхронизируем бейдж на плавающей кнопке
    updateArchiveCount();
}

// ===== РЕНДЕРИНГ =====
function renderTasks() {
    const list = document.getElementById('tasks-list');
    const emptyState = document.getElementById('empty-state');
    const filtered = getFilteredTasks();
    const emptyStateMessage = document.getElementById('empty-state-message');

    list.replaceChildren();

    if (filtered.length === 0) {
        emptyState.classList.remove('hidden');
        emptyStateMessage.textContent = tasks.length === 0
            ? 'Задач пока нет. Добавьте первую!'
            : 'Нет задач, подходящих под выбранные условия.';
        return;
    }

    emptyState.classList.add('hidden');

    filtered.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item';
        if (task.completed) li.classList.add('completed');
        if (isOverdue(task)) li.classList.add('overdue');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-checkbox';
        checkbox.checked = task.completed;
        checkbox.setAttribute('aria-label', `Отметить задачу «${task.title}» как выполненную`);
        checkbox.addEventListener('change', () => toggleTask(task.id));

        const info = document.createElement('div');
        info.className = 'task-info';

        const title = document.createElement('div');
        title.className = 'task-title';
        title.textContent = task.title;
        info.appendChild(title);

        if (task.description) {
            const description = document.createElement('div');
            description.className = 'task-description';
            description.textContent = task.description;
            info.appendChild(description);
        }

        const meta = document.createElement('div');
        meta.className = 'task-meta';

        const priority = document.createElement('span');
        priority.className = `priority-badge priority-${task.priority}`;
        priority.textContent = getPriorityLabel(task.priority);
        meta.appendChild(priority);

        if (task.dueDate) {
            const dueDate = document.createElement('span');
            dueDate.textContent = `📅 ${formatDate(task.dueDate)}`;
            meta.appendChild(dueDate);
        }

        if (task.category) {
            const category = document.createElement('span');
            category.className = 'category-badge';
            category.textContent = task.category;
            meta.appendChild(category);
        }

        const recurrenceLabel = getRecurrenceLabel(task.recurrence);
        if (recurrenceLabel) {
            const recurrence = document.createElement('span');
            recurrence.className = 'recurrence-badge';
            recurrence.textContent = recurrenceLabel;
            meta.appendChild(recurrence);
        }

        const progress = getSubtaskProgress(task);
        if (progress.total > 0) {
            const progressBadge = document.createElement('span');
            progressBadge.className = 'subtask-progress';
            progressBadge.textContent = 'Подзадачи: ' + progress.completed + '/' + progress.total;
            meta.appendChild(progressBadge);
        }

        info.appendChild(meta);

        const subtasks = document.createElement('div');
        subtasks.className = 'subtasks';

        task.subtasks.forEach(subtask => {
            const row = document.createElement('div');
            row.className = 'subtask-row';

            const subtaskCheckbox = document.createElement('input');
            subtaskCheckbox.type = 'checkbox';
            subtaskCheckbox.className = 'subtask-checkbox';
            subtaskCheckbox.checked = subtask.completed;
            subtaskCheckbox.setAttribute('aria-label', 'Отметить подзадачу «' + subtask.title + '» как выполненную');
            subtaskCheckbox.addEventListener('change', () => toggleSubtask(task.id, subtask.id));

            const subtaskTitle = document.createElement('span');
            subtaskTitle.className = 'subtask-title';
            if (subtask.completed) subtaskTitle.classList.add('completed');
            subtaskTitle.textContent = subtask.title;

            const removeSubtaskButton = document.createElement('button');
            removeSubtaskButton.type = 'button';
            removeSubtaskButton.className = 'btn-icon subtask-delete';
            removeSubtaskButton.title = 'Удалить подзадачу';
            removeSubtaskButton.setAttribute('aria-label', 'Удалить подзадачу «' + subtask.title + '»');
            removeSubtaskButton.textContent = '×';
            removeSubtaskButton.addEventListener('click', () => deleteSubtask(task.id, subtask.id));

            row.append(subtaskCheckbox, subtaskTitle, removeSubtaskButton);
            subtasks.appendChild(row);
        });

        const subtaskForm = document.createElement('div');
        subtaskForm.className = 'subtask-form';

        const subtaskInput = document.createElement('input');
        subtaskInput.type = 'text';
        subtaskInput.className = 'subtask-input';
        subtaskInput.dataset.taskId = task.id;
        subtaskInput.maxLength = 150;
        subtaskInput.placeholder = 'Добавить подзадачу…';
        subtaskInput.setAttribute('aria-label', 'Добавить подзадачу к задаче «' + task.title + '»');

        const addSubtaskButton = document.createElement('button');
        addSubtaskButton.type = 'button';
        addSubtaskButton.className = 'btn btn-small';
        addSubtaskButton.textContent = '+';
        addSubtaskButton.setAttribute('aria-label', 'Добавить подзадачу к задаче «' + task.title + '»');
        addSubtaskButton.addEventListener('click', () => addSubtask(task.id, subtaskInput));

        subtaskInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addSubtask(task.id, subtaskInput);
            }
        });

        subtaskForm.append(subtaskInput, addSubtaskButton);
        subtasks.appendChild(subtaskForm);
        info.appendChild(subtasks);

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'btn-icon btn-edit';
        editButton.title = 'Редактировать';
        editButton.setAttribute('aria-label', `Редактировать задачу «${task.title}»`);
        editButton.textContent = '✏️';
        editButton.addEventListener('click', () => openEditModal(task.id));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'btn-icon btn-delete';
        deleteButton.title = 'Удалить';
        deleteButton.setAttribute('aria-label', `Удалить задачу «${task.title}»`);
        deleteButton.textContent = '🗑️';
        deleteButton.addEventListener('click', () => deleteTask(task.id));

        li.append(checkbox, info, editButton, deleteButton);
        list.appendChild(li);
    });
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    const selectInputs = [
        document.getElementById('category-input'),
        document.getElementById('edit-category')
    ];

    // Обновляем выпадающие списки (показываем ВСЕ категории)
    selectInputs.forEach(sel => {
        const currentValue = sel.value;
        sel.innerHTML = '<option value="">Без категории</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            sel.appendChild(opt);
        });
        sel.value = currentValue;
    });

    // Рендерим категории для фильтрации и управления.
    list.innerHTML = '';
    const userCategories = categories;
    
    userCategories.forEach(cat => {
        const tag = document.createElement('div');
        tag.className = 'category-tag';
        if (currentCategoryFilter === cat) {
            tag.classList.add('active');
        }
        
        // Название категории
        const nameSpan = document.createElement('span');
        nameSpan.textContent = cat;
        nameSpan.style.cursor = 'pointer';
        nameSpan.style.flex = '1';
        nameSpan.addEventListener('click', () => toggleCategoryFilter(cat));
        tag.appendChild(nameSpan);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = '✎';
        editBtn.className = 'category-edit-btn';
        editBtn.title = `Переименовать категорию «${cat}»`;
        editBtn.setAttribute('aria-label', `Переименовать категорию «${cat}»`);
        editBtn.addEventListener('click', event => {
            event.stopPropagation();
            renameCategory(cat);
        });
        tag.appendChild(editBtn);
        
        // Кнопка удаления (×)
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.className = 'category-delete-btn';
        deleteBtn.title = `Удалить категорию «${cat}»`;
        deleteBtn.setAttribute('aria-label', `Удалить категорию «${cat}»`);
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Чтобы не срабатывал клик по тегу (фильтрация)
            deleteCategory(cat);
        });
        tag.appendChild(deleteBtn);
        
        list.appendChild(tag);
    });

    // Если пользовательских категорий нет — показываем подсказку
    if (userCategories.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'category-hint';
        hint.textContent = 'Создайте свою категорию выше ☝️';
        list.appendChild(hint);
    }
}

async function deleteCategory(categoryName) {
    if (!confirm(`Удалить категорию "${categoryName}"?`)) return;

    const categoryId = categoryIdsByName.get(categoryName);
    const category = categoriesById.get(categoryId);
    if (!category) return;
    try {
        await apiRequest(`/api/categories/${encodeURIComponent(categoryId)}`, {
            method: 'DELETE', body: { version: Number(category.version) }
        });
    } catch (error) {
        reportApiError(error);
        return;
    }
    
    // Удаляем категорию из массива
    categories = categories.filter(cat => cat !== categoryName);
    
    // Сбрасываем фильтр, если он был на эту категорию
    if (currentCategoryFilter === categoryName) {
        currentCategoryFilter = null;
    }
    
    categoriesById.delete(categoryId);
    categoryIdsByName.delete(categoryName);
    tasks.forEach(task => {
        if (task.category === categoryName) {
            task.category = null;
            task.version += 1;
        }
    });
    archivedTasks.forEach(task => {
        if (task.category === categoryName) {
            task.category = null;
            task.version += 1;
        }
    });
    await loadRemoteData().catch(() => {
        Toast.warning('Категория удалена, но список не удалось обновить. Обновите страницу.', 4500, 'Список не обновлён');
    });
    
    // Перерисовываем всё
    renderAll();
    Toast.success(`Категория удалена`, 3000, `Успешно`)
}

async function renameCategory(categoryName) {
    const categoryId = categoryIdsByName.get(categoryName);
    const category = categoriesById.get(categoryId);
    if (!category) return;
    const newName = prompt('Новое название категории:', categoryName)?.trim();
    if (!newName || newName === categoryName) return;
    if (newName.length > 50) {
        Toast.warning('Название категории не должно превышать 50 символов.', 3500, 'Слишком длинное название');
        return;
    }

    try {
        const response = await apiRequest(`/api/categories/${encodeURIComponent(categoryId)}`, {
            method: 'PATCH', body: { version: Number(category.version), name: newName }
        });
        categories = categories.map(name => name === categoryName ? response.category.name : name);
        categoriesById.set(categoryId, response.category);
        categoryIdsByName.delete(categoryName);
        categoryIdsByName.set(response.category.name, categoryId);
        tasks.forEach(task => { if (task.category === categoryName) task.category = response.category.name; });
        archivedTasks.forEach(task => { if (task.category === categoryName) task.category = response.category.name; });
        if (currentCategoryFilter === categoryName) currentCategoryFilter = response.category.name;
        renderAll();
        if (!document.getElementById('archive-modal').classList.contains('hidden')) renderArchive();
        Toast.success('Категория переименована', 3000, 'Изменения сохранены');
    } catch (error) {
        reportApiError(error);
    }
}

function toggleCategoryFilter(category) {
    if (currentCategoryFilter === category) {
        currentCategoryFilter = null;
    } else {
        currentCategoryFilter = category;
    }
    renderAll();
}

function renderAll() {
    renderTasks();
    renderCategories();
    updateStats();
}

// Восстановить задачу из архива
async function restoreTask(id) {
    const taskIndex = archivedTasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return;
    
    const task = archivedTasks[taskIndex];
    try {
        const response = await apiRequest(`/api/tasks/${encodeURIComponent(id)}/restore`, {
            method: 'POST', body: { version: task.version }
        });
        archivedTasks.splice(taskIndex, 1);
        tasks.unshift(mapApiTask(response.task));
    } catch (error) {
        reportApiError(error);
        return;
    }
    renderAll(); // ← renderAll() уже вызывает updateStats()
    Toast.success(`Задача восстановлена`, 3000, `Успешно`)
    renderArchive();
}

// Полностью удалить из архива
async function deletePermanently(id) {
    if (!confirm('Удалить задачу навсегда? Это действие нельзя отменить.')) return;
    
    const task = archivedTasks.find(item => item.id === id);
    if (!task) return;
    try {
        await apiRequest(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'DELETE', body: { version: task.version }
        });
        archivedTasks = archivedTasks.filter(item => item.id !== id);
    } catch (error) {
        reportApiError(error);
        return;
    }
    renderArchive();
    updateStats(); // ← Было updateArchiveCount(), меняем на updateStats()
    Toast.success(`Задача полностью удалена`, 3000, `Успешно`)
}

// Восстановить все задачи из архива
async function restoreAllTasks() {
    if (archivedTasks.length === 0) return;
    if (!confirm(`Восстановить все ${archivedTasks.length} задач из архива?`)) return;
    
    try {
        await apiRequest('/api/archive/restore-all', { method: 'POST', body: {} });
    } catch (error) {
        reportApiError(error);
        return;
    }
    tasks.unshift(...archivedTasks.map(task => ({ ...task, deletedAt: undefined, version: task.version + 1 })));
    archivedTasks = [];
    renderAll(); // ← renderAll() уже вызывает updateStats()
    Toast.success(`Задачи восстановлены`, 3000, `Успешно`)
    renderArchive();
}

// Очистить архив
async function clearArchive() {
    if (archivedTasks.length === 0) return;
    if (!confirm(`Удалить все ${archivedTasks.length} задач из архива навсегда?`)) return;
    
    try {
        await apiRequest('/api/archive', { method: 'DELETE', body: { confirm: true } });
        archivedTasks = [];
    } catch (error) {
        reportApiError(error);
        return;
    }
    renderArchive();
    updateStats(); // ← Было updateArchiveCount(), меняем на updateStats()
    Toast.success(`Архив очищен`, 3000, `Успешно`)
}

// Обновить счётчик архива
function updateArchiveCount() {
    const badge = document.getElementById('archive-count');
    badge.textContent = archivedTasks.length;
    
    if (archivedTasks.length === 0) {
        badge.style.display = 'none';
    } else {
        badge.style.display = 'flex';
    }
}

// Открыть архив
function openArchive() {
    lastFocusedElement = document.activeElement;
    document.getElementById('archive-modal').classList.remove('hidden');
    renderArchive();
    document.getElementById('close-archive-btn').focus();
}

// Закрыть архив
function closeArchive() {
    document.getElementById('archive-modal').classList.add('hidden');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
    }
    lastFocusedElement = null;
}

// Отрендерить список архива
function renderArchive() {
    const list = document.getElementById('archive-list');
    const emptyState = document.getElementById('archive-empty');
    
    list.innerHTML = '';
    
    if (archivedTasks.length === 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        
        archivedTasks.forEach(task => {
            const li = document.createElement('li');
            li.className = 'archive-item';
            
            const deletedDate = task.deletedAt 
                ? new Date(task.deletedAt).toLocaleDateString('ru-RU', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : '';
            
            const info = document.createElement('div');
            info.className = 'archive-item-info';

            const title = document.createElement('div');
            title.className = 'archive-item-title';
            title.textContent = task.title;
            info.appendChild(title);

            const meta = document.createElement('div');
            meta.className = 'archive-item-meta';

            if (task.category) {
                const category = document.createElement('span');
                category.className = 'category-badge';
                category.textContent = task.category;
                meta.appendChild(category);
            }

            const progress = getSubtaskProgress(task);
            if (progress.total > 0) {
                const progressBadge = document.createElement('span');
                progressBadge.className = 'subtask-progress';
                progressBadge.textContent = 'Подзадачи: ' + progress.completed + '/' + progress.total;
                meta.appendChild(progressBadge);
            }

            if (deletedDate) {
                const deleted = document.createElement('span');
                deleted.textContent = `Удалено: ${deletedDate}`;
                meta.appendChild(deleted);
            }

            info.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'archive-item-actions';

            const restoreButton = document.createElement('button');
            restoreButton.type = 'button';
            restoreButton.className = 'btn btn-restore';
            restoreButton.textContent = 'Восстановить';
            restoreButton.setAttribute('aria-label', `Восстановить задачу «${task.title}»`);
            restoreButton.addEventListener('click', () => restoreTask(task.id));

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'btn btn-delete-permanent';
            deleteButton.textContent = 'Удалить';
            deleteButton.setAttribute('aria-label', `Удалить задачу «${task.title}» навсегда`);
            deleteButton.addEventListener('click', () => deletePermanently(task.id));

            actions.append(restoreButton, deleteButton);
            li.append(info, actions);
            
            list.appendChild(li);
        });

    }
    
    updateArchiveCount();
}

// ===== ОБРАБОТЧИКИ СОБЫТИЙ =====
document.getElementById('export-data-btn').addEventListener('click', exportData);

document.getElementById('add-btn').addEventListener('click', addTask);

document.getElementById('task-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask();
});

// ← Обработчик для блока categories-panel
document.getElementById('add-category-btn').addEventListener('click', addCategory);

document.getElementById('new-category').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCategory();
});

document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTasks();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTasks();
    });
});

document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderTasks();
});

function updateRecurrenceIntervalVisibility(selectId, intervalId) {
    const select = document.getElementById(selectId);
    const interval = document.getElementById(intervalId);
    const custom = select.value === 'custom';
    interval.classList.toggle('hidden', !custom);
    interval.setAttribute('aria-hidden', String(!custom));
}

document.getElementById('recurrence-input').addEventListener('change', () => {
    updateRecurrenceIntervalVisibility('recurrence-input', 'recurrence-interval');
});

document.getElementById('edit-recurrence').addEventListener('change', () => {
    updateRecurrenceIntervalVisibility('edit-recurrence', 'edit-recurrence-interval');
});

document.getElementById('apply-edit-btn').addEventListener('click', saveEdit);

document.getElementById('cancel-edit-btn').addEventListener('click', closeEditModal);

document.getElementById('edit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'edit-modal') closeEditModal();
});

// Обработчики архива
document.getElementById('archive-btn').addEventListener('click', openArchive);
document.getElementById('close-archive-btn').addEventListener('click', closeArchive);
document.getElementById('restore-all-btn').addEventListener('click', restoreAllTasks);
document.getElementById('clear-archive-btn').addEventListener('click', clearArchive);

document.getElementById('archive-modal').addEventListener('click', (e) => {
    if (e.target.id === 'archive-modal') closeArchive();
});

// Клавиатурная навигация по модальным окнам
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const editModal = document.getElementById('edit-modal');
    const archiveModal = document.getElementById('archive-modal');

    if (!editModal.classList.contains('hidden')) {
        closeEditModal();
    } else if (!archiveModal.classList.contains('hidden')) {
        closeArchive();
    }
});

// Клик и Enter/Space по плашке архива в статистике
const archiveStat = document.getElementById('archive-stat-btn');
archiveStat.addEventListener('click', openArchive);
archiveStat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openArchive();
    }
});
// Счётчик символов в поле создания задачи
// ===== СЧЁТЧИКИ СИМВОЛОВ =====

// Обёртка для поля создания задачи
const titleInputWrapper = document.createElement('div');
titleInputWrapper.className = 'input-with-counter';

// Вставляем обёртку перед инпутом создания
const taskInput = document.getElementById('task-input');
taskInput.parentNode.insertBefore(titleInputWrapper, taskInput);

// Перемещаем инпут внутрь обёртки
titleInputWrapper.appendChild(taskInput);

// Создаём счётчик НАД инпутом
const titleCounter = document.createElement('div');
titleCounter.className = 'char-counter char-counter-top';
titleInputWrapper.insertBefore(titleCounter, taskInput);

// Обновление счётчика при вводе
taskInput.addEventListener('input', () => {
    const len = taskInput.value.length;
    titleCounter.textContent = `${len} / ${MAX_TITLE_LENGTH}`;
    
    if (len < MIN_TITLE_LENGTH && len > 0) {
        titleCounter.classList.add('counter-warning');
        titleCounter.classList.remove('counter-error');
    } else if (len > MAX_TITLE_LENGTH) {
        titleCounter.classList.remove('counter-warning');
        titleCounter.classList.add('counter-error');
    } else {
        titleCounter.classList.remove('counter-warning', 'counter-error');
    }
});

// Инициализация счётчика при загрузке
titleCounter.textContent = `0 / ${MAX_TITLE_LENGTH}`;


// --- То же самое для поля редактирования ---

const editTitleInput = document.getElementById('edit-title');
const editTitleWrapper = document.createElement('div');
editTitleWrapper.className = 'input-with-counter';

editTitleInput.parentNode.insertBefore(editTitleWrapper, editTitleInput);
editTitleWrapper.appendChild(editTitleInput);

const editTitleCounter = document.createElement('div');
editTitleCounter.className = 'char-counter char-counter-top';
editTitleWrapper.insertBefore(editTitleCounter, editTitleInput);

editTitleInput.addEventListener('input', () => {
    const len = editTitleInput.value.length;
    editTitleCounter.textContent = `${len} / ${MAX_TITLE_LENGTH}`;
    
    if (len < MIN_TITLE_LENGTH && len > 0) {
        editTitleCounter.classList.add('counter-warning');
        editTitleCounter.classList.remove('counter-error');
    } else if (len > MAX_TITLE_LENGTH) {
        editTitleCounter.classList.remove('counter-warning');
        editTitleCounter.classList.add('counter-error');
    } else {
        editTitleCounter.classList.remove('counter-warning', 'counter-error');
    }
});
// ===== СЧЁТЧИК СИМВОЛОВ ДЛЯ ОПИСАНИЯ =====

// Для формы создания
const descInput = document.getElementById('task-description');
const descCounter = document.createElement('div');
descCounter.className = 'textarea-counter';
descCounter.textContent = `0 / ${MAX_DESCRIPTION_LENGTH}`;
descInput.parentNode.appendChild(descCounter);

descInput.addEventListener('input', () => {
    const len = descInput.value.length;
    descCounter.textContent = `${len} / ${MAX_DESCRIPTION_LENGTH}`;
    
    if (len > MAX_DESCRIPTION_LENGTH) {
        descCounter.classList.add('counter-error');
    } else if (len > MAX_DESCRIPTION_LENGTH - 50) {
        descCounter.classList.add('counter-warning');
        descCounter.classList.remove('counter-error');
    } else {
        descCounter.classList.remove('counter-warning', 'counter-error');
    }
});

// Для модального окна редактирования
const editDescInput = document.getElementById('edit-description');
const editDescCounter = document.createElement('div');
editDescCounter.className = 'textarea-counter';
editDescCounter.textContent = `0 / ${MAX_DESCRIPTION_LENGTH}`;
editDescInput.parentNode.appendChild(editDescCounter);

editDescInput.addEventListener('input', () => {
    const len = editDescInput.value.length;
    editDescCounter.textContent = `${len} / ${MAX_DESCRIPTION_LENGTH}`;
    
    if (len > MAX_DESCRIPTION_LENGTH) {
        editDescCounter.classList.add('counter-error');
    } else if (len > MAX_DESCRIPTION_LENGTH - 50) {
        editDescCounter.classList.add('counter-warning');
        editDescCounter.classList.remove('counter-error');
    } else {
        editDescCounter.classList.remove('counter-warning', 'counter-error');
    }
});
// ===== ИНИЦИАЛИЗАЦИЯ =====
loadTheme(); // Загружаем тему перед остальными данными

document.getElementById('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById('login-submit');
    const error = document.getElementById('login-error');
    error.textContent = '';
    error.classList.add('hidden');
    submit.disabled = true;
    submit.textContent = 'Входим…';
    try {
        await refreshCsrfToken();
        const payload = await apiRequest('/api/auth/login', {
            method: 'POST',
            body: {
                email: document.getElementById('login-email').value.trim(),
                password: document.getElementById('login-password').value
            }
        });
        csrfToken = payload.csrf_token;
        document.getElementById('login-password').value = '';
        showTaskApp(payload.account);
        await loadRemoteData();
    } catch (requestError) {
        showLogin(requestError.message || 'Не удалось войти. Проверьте email и пароль.');
        document.getElementById('login-password').value = '';
    } finally {
        submit.disabled = false;
        submit.textContent = 'Войти';
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await apiRequest('/api/auth/logout', { method: 'POST', body: {} });
        csrfToken = null;
        tasks = [];
        archivedTasks = [];
        categories = [];
        renderAll();
        showLogin();
        await refreshCsrfToken();
    } catch (error) {
        reportApiError(error);
    }
});

async function bootstrap() {
    try {
        await refreshCsrfToken();
        const payload = await apiRequest('/api/auth/me', { csrf: false });
        csrfToken = payload.csrf_token;
        showTaskApp(payload.account);
        await loadRemoteData();
    } catch (error) {
        if (error.status === 401) {
            showLogin();
            return;
        }
        showLogin('Не удалось подключиться к серверу. Обновите страницу и попробуйте снова.');
    }
}

bootstrap();

