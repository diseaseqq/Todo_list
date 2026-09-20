// ===== МОДУЛЬ ТОСТ-УВЕДОМЛЕНИЙ =====
const Toast = {
    container: null,
    
    // Инициализация
    init() {
        this.container = document.getElementById('toast-container');
    },
    
    // Показать уведомление
    show(message, type = 'info', duration = 3000, title = '') {
        if (!this.container) this.init();
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        // Иконки для разных типов
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: '️'
        };
        
        // Заголовки по умолчанию
        const defaultTitles = {
            success: 'Успешно',
            error: 'Ошибка',
            warning: 'Внимание',
            info: 'Информация'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" aria-label="Закрыть">×</button>
            <div class="toast-progress" style="animation-duration: ${duration}ms; color: var(--${type === 'success' ? 'success' : type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'primary'})"></div>
        `;
        
        this.container.appendChild(toast);
        
        // Закрытие по кнопке
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => this.remove(toast));
        
        // Автоудаление
        if (duration > 0) {
            setTimeout(() => this.remove(toast), duration);
        }
        
        return toast;
    },
    
    // Удалить уведомление
    remove(toast) {
        if (toast.classList.contains('removing')) return;
        
        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    },
    
    // Утилитарные методы
    success(message, duration = 3000, title = '') {
        return this.show(message, 'success', duration, title);
    },
    
    error(message, duration = 4000, title = '') {
        return this.show(message, 'error', duration, title);
    },
    
    warning(message, duration = 3500, title = '') {
        return this.show(message, 'warning', duration, title);
    },
    
    info(message, duration = 3000, title = '') {
        return this.show(message, 'info', duration, title);
    }
};

// Инициализация при загрузке
Toast.init();