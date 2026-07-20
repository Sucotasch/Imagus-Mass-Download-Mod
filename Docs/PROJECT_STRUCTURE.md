# Архитектура проекта Imagus Reborn MD (Manifest V3)

Этот документ описывает структуру расширения, роли файлов и механизмы взаимодействия между компонентами.

## 1. Обзор компонентов

### Фоновые процессы (Background)
*   **`src-mv3/background/service.js`**: "Мозг" расширения. Работает как Service Worker.
    *   **Роль**: Управляет очередями загрузки, валидацией URL, обновлением правил (Sieve), хранением настроек и координацией между вкладками.
    *   **Зависимости**: Основной потребитель `defaults.json` и `sieve.json`.

### Контентные скрипты (Content Scripts)
*   **`src-mv3/content/content.js`**: Внедряется в веб-страницы.
    *   **Роль**: Перехват нажатий клавиш (Ctrl+Q), сканирование DOM, первичная фильтрация элементов по видимости и отправка задач в фоновый процесс.
    *   **Особенность**: Временно "подменяет" функции Imagus (`PVI.set`, `PVI.show`) для захвата результатов разрешения правил.

### Интерфейс (UI)
*   **`src-mv3/options/options.js/html`**: Страница настроек.
*   **`src-mv3/options/download-progress.js/html`**: Панель управления массовой загрузкой.
    *   **Роль**: Отображает состояние очередей из Background в реальном времени. Позволяет останавливать/возобновлять процессы.

## 2. Система обмена сообщениями (Message Bus)

Взаимодействие происходит через `chrome.runtime.sendMessage` и `chrome.tabs.sendMessage`.

| Команда | Откуда | Куда | Описание |
| :--- | :--- | :--- | :--- |
| `downloadAll` | Popup/Hotkey | Content | Запуск процесса сканирования страницы. |
| `downloadMass` | Content | Background | Отправка одиночного найденного URL в очередь. |
| `resolveAndDownloadGroups` | Content | Background | Отправка массивов URL (когда Imagus нашел несколько вариантов) для анализа. |
| `openDownloadProgress` | Content | Background | Открытие вкладки прогресса. |
| `updateStatus` | Content/Background | Progress Tab | Обновление текстового статуса ("Scanned X/Y"). |
| `updateFilterStats` | Content | Background | Передача статистики фильтрации (found, filtered). |
| `updateStats` | Background | Progress Tab | Обновление общей статистики. |
| `updateDownloadStatus` | Background | Progress Tab | Передача состояния конкретного файла (URL, статус, прогресс). |
| `registerProgressTab` | Progress Tab | Background | Регистрация ID вкладки прогресса для адресной рассылки обновлений. |
| `stopScanning` | Progress Tab/Content | Background | Полная остановка всех очередей и сброс состояния. |
| `getDownloadStatus` | Progress Tab | Background | Запрос текущего состояния всех загрузок. |
| `retryDownload` | Progress Tab | Background | Повтор загрузки конкретного файла. |
| `clearCompletedDownloads` | Progress Tab | Background | Очистка завершенных загрузок из прогресса. |
| `clearAllDownloads` | Progress Tab | Background | Полная очистка прогресса и статистики. |
| `groupAnalysisComplete` | Background | Content | Уведомление о завершении анализа URL-групп. |

## 3. Схема данных и настроек (`defaults.json`)

Основные параметры массовой загрузки сосредоточены в объекте `da`:

*   `maxConcurrentFilters`: Сколько HEAD/GET запросов выполняется одновременно для проверки размера/типа.
*   `maxConcurrentDownloads`: Лимит одновременных закачек в Chrome.
*   `minImageSize` / `minVideoSize`: Пороги фильтрации (в КБ/МБ).
*   `excludedExtensions`: Список расширений-изгоев (через запятую).
*   `excludedKeywords`: Слова в URL/классах, которые блокируют элемент (например, "banner").

## 4. Карта зависимостей (Что будет, если изменить...)

*   **Изменение `defaults.json`**: Требует обновления логики в `options.js` (для отображения) и `service.js` (для применения). Если добавить новое поле, оно должно быть в `da` или `hz`.
*   **Изменение структуры сообщения в `updateDownloadStatus`**: Сломает отрисовку строк в `download-progress.js`.
*   **Изменение `PVI.find` в `content.js`**: Может нарушить работу основного Imagus (увеличение по наведению).
*   **Изменение `cfg.get`/`cfg.set` в `service.js`**: Повлияет на сохранение всех настроек расширения.
