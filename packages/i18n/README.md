# @fluently/i18n

حزمة ترجمة مشتركة مستقلة عن React والمتصفح، توفر قاموسًا typed للعربية والإنجليزية واتجاه النص المناسب لكل لغة.

## الاستخدام

```ts
import { getDirection, resolveLocale, t } from '@fluently/i18n';

const locale = resolveLocale('ar-DZ');
const direction = getDirection(locale); // 'rtl'
const title = t('home', locale);
const progress = t('stepProgress', 'en', { current: 2, total: 5 });
```

`t()` يعيد نصًا عاديًا؛ مسؤولية الواجهة ضبط `lang` و`dir` على العنصر المناسب. لا تنفذ الحزمة أي تعديل على DOM أو تخزين لتفضيلات المستخدم.

المفاتيح مشتركة النوع بين اللغتين، واللغة غير المدعومة تعود إلى اللغة الاحتياطية المحددة (العربية افتراضيًا).
