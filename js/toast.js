// ===== МОДУЛЬ ТОСТ-УВЕДОМЛЕНИЙ =====
const Toast = {
    container: null,

    init() {
        this.container = document.getElementById('toast-container');
    },

    show(message, type = 'info', duration = 3000, title = '') {
        if (!this.container) this.init();
        if (!this.container) return null;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const defaultTitles = {
            success: 'Успешно',
            error: 'Ошибка',
            warning: 'Внимание',
            info: 'Информация'
        };

        const icon = document.createElement('div');
        icon.className = 'toast-icon';
        icon.textContent = icons[type] || icons.info;

        const content = document.createElement('div');
        content.className = 'toast-content';

        const toastTitle = title || defaultTitles[type];
        if (toastTitle) {
            const titleElement = document.createElement('div');
            titleElement.className = 'toast-title';
            titleElement.textContent = toastTitle;
            content.appendChild(titleElement);
        }

        const messageElement = document.createElement('div');
        messageElement.className = 'toast-message';
        messageElement.textContent = String(message);
        content.appendChild(messageElement);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Закрыть');
        closeBtn.textContent = '×';

        const progress = document.createElement('div');
        progress.className = 'toast-progress';
        progress.style.animationDuration = `${duration}ms`;
        const colorVar = type === 'success' ? 'success'
            : type === 'error' ? 'danger'
            : type === 'warning' ? 'warning'
            : 'primary';
        progress.style.color = `var(--${colorVar})`;

        toast.append(icon, content, closeBtn, progress);
        this.container.appendChild(toast);

        closeBtn.addEventListener('click', () => this.remove(toast));

        if (duration > 0) {
            setTimeout(() => this.remove(toast), duration);
        }

        return toast;
    },

    remove(toast) {
        if (!toast || toast.classList.contains('removing')) return;

        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    },

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

Toast.init();
