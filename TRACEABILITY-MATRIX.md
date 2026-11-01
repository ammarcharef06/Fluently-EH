# TRACEABILITY MATRIX — Fluently

هذه هي المصفوفة الوحيدة لتتبع المتطلبات. كل صف يربط معرّف متطلب بمصدره وقرار المنتج وبوابة خارطة الطريق واختبار القبول. لا تكرر مصفوفة مستقلة في وثيقة أخرى؛ وثائق المنصات قد تحتوي جداول قبول تفصيلية لكنها لا تستبدل هذا الربط.

**الحالات:** `مخطط` = لم يُختبر بعد، `قيد الاختبار` = يجري تنفيذ التجربة، `اجتاز` = يوجد دليل نتيجة قابل للمراجعة، `فشل` = لم يحقق معيار القبول، `مستبعد` = لا ينطبق بقرار صريح.

| Req ID | المتطلب القابل للتحقق | مصدر الحقيقة | القرار | بوابة المرحلة | اختبار القبول / الدليل | الحالة |
|---|---|---|---|---|---|---|
| PLAT-001 | يبنى تطبيق المتعلم للويب وAndroid وWindows من واجهة React/TypeScript مشتركة | PRD §4، ARCHITECTURE §2 | DECISIONS 73 | P1 ثم P2 | P1-PLAT-001: بناء وتشغيل probe لكل هدف | مخطط |
| PLAT-002 | تكون لوحة الإدارة تطبيق ويب مستقلًا بمدخل بناء منفصل، لا جزءًا من PWA المتعلم | ARCHITECTURE §3.2–4، PARITY | DECISIONS 63، 72 | P2 هيكل؛ P7 وظائف | P2-ADMIN-001: مسار بناء منفصل واختبار صلاحية خادمية لاحقًا | مخطط |
| PKG-001A | تتضمن حزمة Android APK **حزمة المنهج المضمّنة** كاملة وقت البناء | PRD §13.4، PLATFORM-REQUIREMENTS §3، OFFLINE-AND-SYNC §5 | DECISIONS 77، 107، 121 | P1 H2a/H4؛ P4؛ P10 | H2a: بناء APK وقراءة placeholder/checksum من داخله؛ H4: حزمة اختبار داخل APK ورفض تغيير بايت واحد | مخطط — بانتظار مراجعة معايير الشاهد |
| PKG-001B | تتضمن توزيعات Windows EXE **حزمة المنهج المضمّنة** كاملة وقت البناء | PRD §13.4، PLATFORM-REQUIREMENTS §4، OFFLINE-AND-SYNC §5 | DECISIONS 77، 107، 121؛ DECISIONS §E-9 | قبل إطلاق Windows؛ خارج P1 الحالي | H2b يعاد فتحه فقط بعد: (1) Windows runner + Rust/Tauri/Node/WebView2 موثقة، (2) إثبات build/install/runtime-read + tamper rejection، (3) شهادة Authenticode موثوقة وتكلفة/تجديد مقبولان ومفتاح محفوظ خارج Git | مؤجل بقرار — غير مُثبت — خارج نطاق المرحلة 1 بسبب غياب Rust/Tauri والتوقيع |
| H2A-APK | يثبت APK على runner موثق ويقرأ placeholder من APK المثبت ويطبع checksum يطابق قيمة محسوبة قبل التغليف | experiments/phase-1/H2a-apk-capacitor/README.md | DECISIONS §E-10 | P1؛ تاريخ القطع 2026-11-05 23:59 Africa/Algiers | نجاح/فشل/جزئي محدد مسبقًا؛ CI build مستقل عن install-on-emulator؛ checksum المتوقع من build output + expected.sha256 artifact لنفس run ID؛ CHECKSUM/RESULT آليان؛ احتفاظ artifacts لمدة 30 يومًا | قيد التنفيذ — اعتماد H2a صدر؛ لا كود H4 |
| H4-ANDROID | يعمل التحقق على حزمة اختبار مضمّنة كما ستُشحن داخل APK؛ تُقبل السليمة وتُرفض نسخة معدل منها بايت واحد | experiments/phase-1/H2a-apk-capacitor/README.md، PLATFORM-REQUIREMENTS §3، OFFLINE-AND-SYNC §5 | DECISIONS 88، 150؛ DECISIONS §E-10 | P1 بعد H2a؛ Android فقط | حالتان: payload سليم + manifest سليم ينتجان MATCH/ACTIVATION:ACCEPTED؛ payload معدل بايتًا واحدًا قبل التغليف + manifest الأصلي ينتج MISMATCH/ACTIVATION:REJECTED. يعاد بناء APK وتوقيعه debug بعد تجهيز كل حالة | مخطط — Android فقط؛ بعد H2a |
| PKG-002 | ينزّل Web/PWA **حزمة المنهج المنزّلة عند أول استخدام** بعد تسجيل الدخول؛ لا يضمّنها في ملفات الويب الثابتة | PRD §13.4، PLATFORM-REQUIREMENTS §2، OFFLINE-AND-SYNC §5 | DECISIONS 99 | P1 probe؛ P4 engine؛ P5 learner | P1-PKG-002: اختبار تنزيل ZIP والتحقق؛ P4/P5: اختبار متصفح فعلي | مخطط |
| PKG-003 | لا تُفعّل الحزمة قبل التحقق من manifest والمخطط والحجم والبصمات | OFFLINE-AND-SYNC §5، ARCHITECTURE §6 | DECISIONS 88، 150 | P1 ثم P4 | P1-PKG-003: H4 يختبر تعديل بايت واحد؛ P4: schema/hash/تفعيل آمن | مخطط |
| PKG-004 | تُرفض مسارات ZIP الخطرة والملفات المكررة وغير المعلنة والملفات التنفيذية غير المسموح بها | RELEASE-AND-TESTING §7، OFFLINE-AND-SYNC §5 | DECISIONS 150 | P1 ثم P4 | P1-PKG-004: traversal/duplicate/undeclared fixtures | مخطط |
| PKG-005 | يبقى إصدار المنهج النشط متاحًا إذا فشل التحقق أو التفعيل لإصدار جديد | OFFLINE-AND-SYNC §5–6 | DECISIONS 122 | P1 ثم P4 | P1-PKG-005: فشل الحزمة الجديدة لا يغيّر active pointer | مخطط |
| OFF-001 | تستمر الدروس والاختبارات والمراجعة والصوت المنزّل دون اتصال بعد توفر الحزمة محليًا | PRD §13، OFFLINE-AND-SYNC §1–3 | DECISIONS 75، 116 | P1 ثم P4/P5 | P1-OFF-001: تحقق الحزمة محليًا؛ P5: رحلة درس كاملة Offline | مخطط |
| SYNC-001 | إعادة إرسال العملية نفسها لا تنشئ نتيجة مكررة، ولا تحذف العملية المحلية قبل إقرار الخادم | OFFLINE-AND-SYNC §7–8 | DECISIONS 76 | P1 ثم P9 | P1-SYNC-001: idempotency probe؛ P9: انقطاع/إعادة إرسال/تعارض | مخطط |
| DATA-001 | يستخدم IndexedDB على الويب وSQLite في التطبيقات الأصلية مع ترحيلات آمنة | PRD §16، ARCHITECTURE §2 و§6 | DECISIONS 95 | P1 ثم P2/P3 | P1-DATA-001: فتح/قراءة/كتابة وإعادة تشغيل؛ P3 migrations | مخطط |
| AUTH-001 | يدعم الدخول الأول عبر Google أو البريد وكلمة المرور، مع تأكيد البريد عند انطباقه | PRD §3 و§14 | DECISIONS 83، 84، 126 | P1 مزود؛ P3 تكامل | P1-AUTH-001: تحقق التدفق التجريبي لكل مسار | مخطط |
| COST-001 | لا يعتمد مزودًا يتطلب فترة تجريبية أو بطاقة أو فوترة تلقائية لتشغيل الوظائف الأساسية | INFRASTRUCTURE-AND-COSTS §1 و§4، DECISIONS §E | DECISIONS 101، 108، 120، 125 | P1 gate | P1-COST-001: شروط رسمية + تجربة تسجيل دون بطاقة + حدود الخطة | مخطط |
| AUDIO-001 | لا يطلب التطبيق إذن ميكروفون ولا يسجل صوت المتعلم ولا يمنحه درجة نطق | PRD §10، PLATFORM-REQUIREMENTS، PARITY | DECISIONS 10، 48، 147 | كل المراحل؛ تحقق قبل الإصدار | P1-AUDIO-001: فحص الأذونات/المكونات؛ Release security test | مخطط |
| ADMIN-001 | تخضع كل عملية إدارة لتفويض خادمي مستقل عن إخفاء عناصر الواجهة | ARCHITECTURE §3.2، PRD §15 | DECISIONS 63، 72، 129 | P3 أساس الصلاحيات؛ P7 لوحة الإدارة | P3-ADMIN-001: وصول مرفوض لحساب غير مخول | مخطط |
| CONTENT-001 | لا ينشر محتوى تعليمي قبل مراجعة بشرية واعتماد مخول، وتسجل حالة المراجعة مع الإصدار | PRD §15، CONTENT-EDITOR، CONTENT-STANDARDS | DECISIONS 64، 149 | P7 نظام؛ P8 المحتوى | P7-CONTENT-001: منع نشر مسودة غير معتمدة | مخطط |
| ASSESS-001 | يتطلب الإتقان محاولات متعددة وأسئلة جديدة، مع خطة علاجية عند التعثر | PRD §10–12، ASSESSMENT-SYSTEM | DECISIONS 40–44 | P6 | P6-ASSESS-001: حالات نجاح/فشل وأسئلة جديدة | مخطط |
| PRIV-001 | يمكن تصدير بيانات المتعلم وطلب حذف الحساب وإبطال الجلسات، مع توضيح تأخر حذف جهاز غير متصل | PRD §14، OFFLINE-AND-SYNC §10 | DECISIONS 82، 90 | P3 ثم P9 | P3-PRIV-001 وP9-PRIV-002: حذف/إبطال/جهاز Offline | مخطط |
| LIC-001 | لا تضاف مادة خارجية إلا مع حقوق إعادة الاستخدام والتوزيع والإشعارات اللازمة | PRD §17، CONTRIBUTING، LICENSE-CONTENT | DECISIONS 102–105، 148 | P1 فحص الأدوات؛ P7/P8 محتوى | P1-LIC-001: مراجعة الترخيص لكل أصل تجريبي | مخطط |
| SEC-001 | لا توجد أسرار أو مفاتيح توقيع أو بيانات شخصية داخل المستودع أو حزم المحتوى العامة | AGENTS §1 و§3، SECURITY-AND-PRIVACY | DECISIONS 85–91 | كل بوابة | SEC-001: secret scan + review | مخطط |
| UPD-001 | يتحدث المحتوى مستقلًا عن التطبيق عندما يكون schema متوافقًا، مع رفض النسخة غير المتوافقة | ARCHITECTURE §9، OFFLINE-AND-SYNC §6 | DECISIONS 100، 122، 123 | P1 ثم P4/P10 | P1-UPD-001: min/max schema compatibility probe | مخطط |
| AND-001 | يوقع APK بمفتاح إصدار ثابت، ويؤكد المستخدم التثبيت عبر النظام | PLATFORM-REQUIREMENTS §3، RELEASE-AND-TESTING §8 | DECISIONS 113 | P1 prototype؛ P10 release | P1-AND-001: بناء/توقيع تجريبي بلا أسرار؛ P10: ترقية على جهاز فعلي | مخطط |
| WIN-001 | تحفظ بيانات Windows في مساحة المستخدم، وتتحقق سلامة التحديث دون فتح منفذ وارد | PLATFORM-REQUIREMENTS §4 | DECISIONS 73، 95؛ DECISIONS §E-9 | خارج P1 الحالي؛ قبل إصدار Windows | H2b مؤجل؛ يلزم runner Windows وRust/Tauri وقرار Authenticode مستقل | مؤجل بقرار — غير مُثبت |

## سجل نتائج المرحلة 1

> بدأ تنفيذ H2a؛ المحاولة الأولى فشلت في تهيئة SDK قبل البناء (run 41350401442)، وسُجل السبب؛ المحاولات 1–4 تعثرت قبل إنتاج APK؛ الرابعة أظهرت أن سطر assemble لم ينتقل فعليًا إلى مجلد android. سُجلت جميعها في الشاهد ويُصلح أمر assemble. كود H4 لم يبدأ. H2b مؤجل بقرار ولا يوصف بالفشل. H4 قابل للاختبار على Android فقط بعد H2a؛ لا يُعمم على Windows.


| Test ID | البيئة / الإصدار | النتيجة | الدليل | التاريخ | ملاحظات |
|---|---|---|---|---|---|
| H2a-APK | لم ينفذ بعد | معايير مكتوبة — بانتظار المراجعة الصريحة | — | 2026-11-05 23:59 | APK 128 MiB، checksum مستقل، Logcat آلي؛ artifacts 30 يومًا |
| H2b-EXE | لم ينفذ؛ مؤجل بقرار | مؤجل — غير مُثبت | — | قبل قرار إطلاق Windows | الشروط الثلاثة في ملف H2b: runner/toolchain، مسار build/runtime/tamper، وشهادة Authenticode موثوقة |
| H4-ANDROID | لم ينفذ بعد H2a | مخطط — Android فقط | — | بعد H2a وقبل 2026-11-05 إن سمح الوقت | حالة سليمة MATCH/ACCEPTED وحالة معدّلة MISMATCH/REJECTED؛ يعاد بناء وتوقيع APK لكل حالة |

**قاعدة التحديث:** بعد كل تجربة، حدّث صف المتطلب وسجل نتيجة الاختبار في هذا الملف ضمن PR نفسه الذي يغير القرار أو التنفيذ ذي الصلة. لا تضع "اجتاز" دون سجل دليل قابل لإعادة الفحص.
