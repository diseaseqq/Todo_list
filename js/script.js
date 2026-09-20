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

// ===== ТЕМНАЯ ТЕМА =====
const THEME_KEY = 'todo_theme';

// Загрузка сохраненной темы
function loadTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
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
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
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
function loadData() {
    const savedTasks = localStorage.getItem('todo_tasks');
    const savedArchived = localStorage.getItem('todo_archived');
    const savedCategories = localStorage.getItem('todo_categories');
    
    if (savedTasks) tasks = JSON.parse(savedTasks);
    if (savedArchived) archivedTasks = JSON.parse(savedArchived);
    
    if (savedCategories) {
        categories = JSON.parse(savedCategories);
    } else {
        categories = [...defaultCategories];
        saveCategories();
    }
}
function saveArchivedTasks() {
    localStorage.setItem('todo_archived', JSON.stringify(archivedTasks));
}

// Функция совмещения двух массивов категорий без дубликатов
function mergeCategories(saved, defaults) {
    // Создаём Set из сохранённых категорий (для быстрого поиска дубликатов)
    const merged = new Set(saved);
    
    // Добавляем дефолтные категории, которых ещё нет
    defaults.forEach(cat => merged.add(cat));
    
    // Возвращаем массив: сначала дефолтные (в их порядке), потом пользовательские
    const result = [...defaults];
    saved.forEach(cat => {
        if (!defaults.includes(cat)) {
            result.push(cat);
        }
    });
    
    return result;
}
function saveTasks() {
    localStorage.setItem('todo_tasks', JSON.stringify(tasks));
}

function saveCategories() {
    localStorage.setItem('todo_categories', JSON.stringify(categories));
}

// ===== УТИЛИТЫ =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function isOverdue(task) {
    if (!task.dueDate || task.completed) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDate);
    return due < today;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getPriorityLabel(p) {
    const labels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
    return labels[p] || p;
}

// ===== CRUD ОПЕРАЦИИ =====
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
    
    document.getElementById('edit-modal').classList.remove('hidden');
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
}

// ===== КАТЕГОРИИ =====
function addCategory() {
    const input = document.getElementById('new-category'); // ← правильный id
    const name = input.value.trim();
    
    if (!name) {
        Toast.error('Введите название категории!', 3000, `Ошибка`);
        return;
    }
    
    if (categories.includes(name)) {
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
            return new Date(a.dueDate) - new Date(b.dueDate);
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

    list.innerHTML = '';

    if (filtered.length === 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        
        filtered.forEach(task => {
            const li = document.createElement('li');
            li.className = 'task-item';
            if (task.completed) li.classList.add('completed');
            if (isOverdue(task)) li.classList.add('overdue');

            li.innerHTML = `
    <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
    <div class="task-info">
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
        <div class="task-meta">
            <span class="priority-badge priority-${task.priority}">
                ${getPriorityLabel(task.priority)}
            </span>
            ${task.dueDate ? `<span>📅 ${formatDate(task.dueDate)}</span>` : ''}
            ${task.category ? `<span class="category-badge">${escapeHtml(task.category)}</span>` : ''}
        </div>
    </div>
    <button class="btn-icon" title="Редактировать">✏️</button>
    <button class="btn-icon" title="Удалить">🗑️</button>
`;

            li.querySelector('.task-checkbox').addEventListener('change', () => toggleTask(task.id));
            li.querySelectorAll('.btn-icon')[0].addEventListener('click', () => openEditModal(task.id));
            li.querySelectorAll('.btn-icon')[1].addEventListener('click', () => deleteTask(task.id));

            list.appendChild(li);
        });
    }
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
    
    // Убираем категорию у всех задач, где она была выбрана
    tasks.forEach(task => {
        if (task.category === categoryName) {
            task.category = null;
        }
    });
    
    // Сохраняем изменения
    saveCategories();
    saveTasks();
    
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
    updateArchiveCount(); // ← Добавь эту строку
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    Toast.success(`Категория востановлена`, 3000, `Успешно`)
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
    Toast.success(`Задачи востановлены`, 3000, `Успешно`)
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
    document.getElementById('archive-modal').classList.remove('hidden');
    renderArchive();
}

// Закрыть архив
function closeArchive() {
    document.getElementById('archive-modal').classList.add('hidden');
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
            
            li.innerHTML = `
                <div class="archive-item-info">
                    <div class="archive-item-title">${escapeHtml(task.title)}</div>
                    <div class="archive-item-meta">
                        ${task.category ? `<span class="category-badge">${escapeHtml(task.category)}</span>` : ''}
                        ${deletedDate ? `<span>Удалено: ${deletedDate}</span>` : ''}
                    </div>
                </div>
                <div class="archive-item-actions">
                    <button class="btn btn-restore" data-id="${task.id}">Восстановить</button>
                    <button class="btn btn-delete-permanent" data-id="${task.id}">Удалить</button>
                </div>
            `;
            
            list.appendChild(li);
        });
        
        // Обработчики кнопок
        list.querySelectorAll('.btn-restore').forEach(btn => {
            btn.addEventListener('click', () => restoreTask(btn.dataset.id));
        });
        
        list.querySelectorAll('.btn-delete-permanent').forEach(btn => {
            btn.addEventListener('click', () => deletePermanently(btn.dataset.id));
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
// Клик по плашке архива в статистике — открывает архив
document.getElementById('archive-stat-btn').addEventListener('click', openArchive);
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
editTitleCounter.textContent = `0 / ${MAX_TITLE_LENGTH}`;
// ===== ИНИЦИАЛИЗАЦИЯ =====
loadTheme(); // Загружаем тему перед остальными данными
loadData();
renderAll();

// описание задач. в нижний правый угл пост уведомление действий, пункт 25, 26 проверить, темная тема и светлая 