// ===== СОСТОЯНИЕ ПРИЛОЖЕНИЯ =====
let tasks = [];
let categories = [];
const defaultCategories = ['Работа', 'Личное', 'Учёба', 'Покупки', 'Спорт', 'Другое'];
let archivedTasks = [];
let currentFilter = 'all';
let currentCategoryFilter = null;
let currentSort = 'created';
let searchQuery = '';
let editingId = null;
let lastFocusedElement = null;

// ===== ТЕМНАЯ ТЕМА =====
const THEME_KEY = 'todo_theme';

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
        return false;
    }
}

function parseStoredArray(key, fallback = []) {
    const raw = getStoredValue(key);
    if (!raw) return fallback;

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
        console.warn(`Не удалось загрузить данные из localStorage: ${key}`, error);
        return fallback;
    }
}

function normalizeSubtasks(items) {
    const usedIds = new Set();

    if (!Array.isArray(items)) return [];

    return items
        .filter(item => item && typeof item === 'object')
        .map(item => {
            const title = typeof item.title === 'string' ? item.title.trim() : '';
            if (!title) return null;

            let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : generateId();
            while (usedIds.has(id)) {
                id = generateId();
            }
            usedIds.add(id);

            return {
                id,
                title: title.slice(0, 150),
                completed: Boolean(item.completed)
            };
        })
        .filter(Boolean);
}

function getSubtaskProgress(task) {
    const total = task.subtasks.length;
    const completed = task.subtasks.filter(subtask => subtask.completed).length;
    return { completed, total };
}

function normalizeTask(task) {
    if (!task || typeof task !== 'object') return null;

    const title = typeof task.title === 'string' ? task.title.trim() : '';
    if (!title) return null;

    const priority = ['low', 'medium', 'high'].includes(task.priority)
        ? task.priority
        : 'medium';

    const dueDate = typeof task.dueDate === 'string' && parseDateOnly(task.dueDate)
        ? task.dueDate
        : null;

    const category = typeof task.category === 'string' && task.category.trim()
        ? task.category.trim()
        : null;

    return {
        id: typeof task.id === 'string' && task.id.trim() ? task.id.trim() : generateId(),
        title: title.slice(0, MAX_TITLE_LENGTH),
        description: typeof task.description === 'string'
            ? task.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || null
            : null,
        completed: Boolean(task.completed),
        priority,
        dueDate,
        category,
        subtasks: normalizeSubtasks(task.subtasks),
        createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now(),
        ...(Number.isFinite(task.deletedAt) ? { deletedAt: task.deletedAt } : {})
    };
}

function normalizeTasks(items) {
    const usedIds = new Set();

    return items
        .map(normalizeTask)
        .filter(Boolean)
        .map(task => {
            let id = task.id;

            while (usedIds.has(id)) {
                id = generateId();
            }

            usedIds.add(id);
            return { ...task, id };
        });
}

function normalizeCategories(items) {
    const result = [];
    const seen = new Set();

    items
        .filter(item => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(category => {
            const key = category.toLocaleLowerCase('ru-RU');
            if (!seen.has(key)) {
                seen.add(key);
                result.push(category);
            }
        });

    return result;
}

function loadData() {
    tasks = normalizeTasks(parseStoredArray('todo_tasks'));
    archivedTasks = normalizeTasks(parseStoredArray('todo_archived'));

    const savedCategories = normalizeCategories(parseStoredArray('todo_categories'));
    categories = mergeCategories(savedCategories, defaultCategories);

    saveTasks();
    saveArchivedTasks();
    saveCategories();
}
function saveArchivedTasks() {
    setStoredValue('todo_archived', JSON.stringify(archivedTasks));
}

// Функция совмещения двух массивов категорий без дубликатов
function mergeCategories(saved, defaults) {
    const result = [...defaults];
    const existing = new Set(defaults.map(cat => cat.toLocaleLowerCase('ru-RU')));

    saved.forEach(cat => {
        const key = cat.toLocaleLowerCase('ru-RU');
        if (!existing.has(key)) {
            existing.add(key);
            result.push(cat);
        }
    });

    return result;
}
function saveTasks() {
    setStoredValue('todo_tasks', JSON.stringify(tasks));
}

function saveCategories() {
    setStoredValue('todo_categories', JSON.stringify(categories));
}

// ===== УТИЛИТЫ =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

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
function addSubtask(taskId, input) {
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

    task.subtasks.push({
        id: generateId(),
        title,
        completed: false
    });

    saveTasks();
    renderAll();

    requestAnimationFrame(() => {
        const nextInput = document.querySelector('.subtask-input[data-task-id="' + taskId + '"]');
        if (nextInput) nextInput.focus();
    });
}

function toggleSubtask(taskId, subtaskId) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;

    const subtask = task.subtasks.find(item => item.id === subtaskId);
    if (!subtask) return;

    subtask.completed = !subtask.completed;
    saveTasks();
    renderAll();
}

function deleteSubtask(taskId, subtaskId) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;

    const index = task.subtasks.findIndex(item => item.id === subtaskId);
    if (index === -1) return;

    task.subtasks.splice(index, 1);
    saveTasks();
    renderAll();
}

function addTask() {
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
        id: generateId(),
        title: title,
        description: description || null, // 🆕 Описание (null если пустое)
        completed: false,
        priority: document.getElementById('priority-input').value,
        dueDate: document.getElementById('date-input').value || null,
        category: document.getElementById('category-input').value || null,
        createdAt: Date.now()
    };

    tasks.push(task);
    saveTasks();
    titleInput.value = '';
    descriptionInput.value = ''; // 🆕 Очищаем описание
    document.getElementById('date-input').value = '';
    renderAll();
    Toast.success(`Задача добавлена`, 3000, 'Успешно');
}

function deleteTask(id) {
    if (!confirm('Переместить задачу в архив?')) return;
    
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return;
    
    // Удаляем из активных задач
    const [task] = tasks.splice(taskIndex, 1);
    
    // Добавляем в архив с датой удаления
    task.deletedAt = Date.now();
    archivedTasks.push(task);
    
    saveTasks();
    saveArchivedTasks();
    renderAll();
    Toast.success(`Задача перемещена в архив`, 3000, 'Успешно');
}

function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        saveTasks();
        renderAll();
        const status = task.completed ? 'выполнена' : 'возвращена в активные';
        Toast.success(`Задача "${task.title}" ${status}`, 2500, 'Статус изменён');
    }
}

function openEditModal(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    lastFocusedElement = document.activeElement;
    editingId = id;
    document.getElementById('edit-title').value = task.title;
    document.getElementById('edit-description').value = task.description || '';
    document.getElementById('edit-priority').value = task.priority;
    document.getElementById('edit-date').value = task.dueDate || '';
    document.getElementById('edit-category').value = task.category || '';
    
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

function saveEdit() {
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
    
    task.title = newTitle;
    task.description = newDescription || null; // 🆕
    task.priority = document.getElementById('edit-priority').value;
    task.dueDate = document.getElementById('edit-date').value || null;
    task.category = document.getElementById('edit-category').value || null;

    saveTasks();
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
function addCategory() {
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

    categories.push(name);
    saveCategories(); // Сохраняем в localStorage
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
        const q = searchQuery.toLowerCase();
        result = result.filter(t => t.title.toLowerCase().includes(q));
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

    list.replaceChildren();

    if (filtered.length === 0) {
        emptyState.classList.remove('hidden');
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

    // Рендерим теги только для пользовательских категорий
    list.innerHTML = '';
    const userCategories = categories.filter(cat => !defaultCategories.includes(cat));
    
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
        
        // Кнопка удаления (×)
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.className = 'category-delete-btn';
        deleteBtn.title = 'Удалить категорию';
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

function deleteCategory(categoryName) {
    if (!confirm(`Удалить категорию "${categoryName}"?`)) return;
    
    // Удаляем категорию из массива
    categories = categories.filter(cat => cat !== categoryName);
    
    // Сбрасываем фильтр, если он был на эту категорию
    if (currentCategoryFilter === categoryName) {
        currentCategoryFilter = null;
    }
    
    // Убираем категорию у активных и архивных задач
    tasks.forEach(task => {
        if (task.category === categoryName) {
            task.category = null;
        }
    });
    archivedTasks.forEach(task => {
        if (task.category === categoryName) {
            task.category = null;
        }
    });
    
    // Сохраняем изменения
    saveCategories();
    saveTasks();
    saveArchivedTasks();
    
    // Перерисовываем всё
    renderAll();
    Toast.success(`Категория удалена`, 3000, `Успешно`)
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
function restoreTask(id) {
    const taskIndex = archivedTasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return;
    
    const [task] = archivedTasks.splice(taskIndex, 1);
    delete task.deletedAt;
    
    tasks.push(task);
    
    saveTasks();
    saveArchivedTasks();
    renderAll(); // ← renderAll() уже вызывает updateStats()
    Toast.success(`Задача восстановлена`, 3000, `Успешно`)
    renderArchive();
}

// Полностью удалить из архива
function deletePermanently(id) {
    if (!confirm('Удалить задачу навсегда? Это действие нельзя отменить.')) return;
    
    archivedTasks = archivedTasks.filter(t => t.id !== id);
    
    saveArchivedTasks();
    renderArchive();
    updateStats(); // ← Было updateArchiveCount(), меняем на updateStats()
    Toast.success(`Задача полностью удалена`, 3000, `Успешно`)
}

// Восстановить все задачи из архива
function restoreAllTasks() {
    if (archivedTasks.length === 0) return;
    if (!confirm(`Восстановить все ${archivedTasks.length} задач из архива?`)) return;
    
    archivedTasks.forEach(task => {
        delete task.deletedAt;
        tasks.push(task);
    });
    
    archivedTasks = [];
    
    saveTasks();
    saveArchivedTasks();
    renderAll(); // ← renderAll() уже вызывает updateStats()
    Toast.success(`Задачи восстановлены`, 3000, `Успешно`)
    renderArchive();
}

// Очистить архив
function clearArchive() {
    if (archivedTasks.length === 0) return;
    if (!confirm(`Удалить все ${archivedTasks.length} задач из архива навсегда?`)) return;
    
    archivedTasks = [];
    
    saveArchivedTasks();
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
loadData();
renderAll();

