# АЗС Онлайн presentation

Готовые файлы:

- `fuel-queue-pwa-presentation.pptx` - презентация PowerPoint из 6 полноэкранных слайдов.
- `fuel-queue-pwa-presentation.pdf` - PDF-версия для отправки одним файлом.
- `index.html` - редактируемая HTML-версия презентации.
- `slides/slide-01.png` ... `slides/slide-06.png` - отдельные PNG-слайды 1920x1080.
- `assets/` - сгенерированные иллюстрации для презентации.

## Логика показа

1. **Главный экран** - приложение контролирует очередь, допуск, лимиты, факт заправки и отчёты по 3 АЗС.
2. **Боль без системы** - ручной учёт даёт повторы, споры, ошибки в лимитах и разрозненную историю.
3. **Рабочий сценарий** - лимит, запись, проверка допуска, фиксация факта заправки.
4. **Удобство на смене** - кассир видит понятное решение: разрешено, запрещено или нужна проверка.
5. **Контроль для администрации** - единые правила, фактические литры, журнал действий и ручных решений.
6. **Главная ценность** - меньше ручного контроля и конфликтов, больше прозрачности.

## Обновление PNG

Если нужно переснять PNG после правок `index.html`, используйте Chrome в headless-режиме:

```powershell
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$presentation = Resolve-Path 'index.html'
$slidesDir = Resolve-Path 'slides'
$baseUri = ([Uri]$presentation.Path).AbsoluteUri
for ($i = 1; $i -le 6; $i++) {
  $shot = Join-Path $slidesDir.Path ('slide-{0:00}.png' -f $i)
  $url = "${baseUri}?slide=$i"
  & $chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 --force-device-scale-factor=1 --screenshot=$shot $url
}
```
