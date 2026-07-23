/* =========================================================
   i18n.js — Hushh multi-language support
   Supported: en (English), vi (Vietnamese)
   Usage:  import { t, setLanguage, getLanguage } from './i18n.js';
           t('key')              → translated string
           t('key', {n: 3})     → translated string with {n} replaced
   ========================================================= */

const LANGS = {
  en: {
    // ---- Header ----
    tagline:               'Understand what your little one needs',
    'app.sr-title':        'Hushh — on-device AI baby cry analyzer',
    'privacy-badge':       '🔒 On-device AI · no audio sent to cloud',

    // ---- Install banner ----
    'install.title': 'Add to Home Screen',
    'install.sub':   'Works offline · instant access',
    'install.btn':   'Install',

    // ---- Update banner ----
    'update.title': 'New version available',
    'update.sub':   'Tap update to get the latest improvements',
    'update.btn':   'Update',

    // ---- Model badge ----
    'model.loading':      '⏳ Loading on-device model…',
    'model.downloading':  '⬇ Syncing community model… {pct}%',
    'model.ready':        '🔒 On-device only',
    'model.personalized': 'Personalized model loaded',
    'model.heuristic':    'Ready (acoustic analysis mode)',
    'model.error':        '⚠️ Fallback mode',

    // ---- Record ----
    'record.hint.idle':       'Tap the button and hold your phone near the baby',
    'record.btn.idle':        'Record cry',
    'record.btn.stop':        'Tap to stop',
    'record.btn.processing':  'Processing…',
    'record.hint.recording':  'Recording… up to 30 seconds',
    'record.hint.processing': 'Analyzing on-device…',
    'audio-ready.recording':  'Recording ready ({dur}s)',

    // ---- Upload / analyze ----
    or:                'or',
    'upload.btn':      'Upload audio file (.wav · .mp3 · .m4a · .webm)',
    'upload.btn.aria': 'Upload audio file',
    'analyze.btn':         '🔍 Analyze cry',
    'analyze.btn.loading': '⏳ Analyzing…',
    'analyze.btn.aria':    'Analyze baby cry',

    // ---- Processing steps ----
    'step.features': 'Extracting acoustic features…',
    'step.classify': 'Running on-device classifier…',
    'step.prepare':  'Preparing results…',

    // ---- Result card ----
    'result.what-to-do':       'What to do',
    'result.signal-breakdown': 'Signal breakdown',
    'result.privacy-note':     'All analysis ran locally on your device. No audio was transmitted anywhere.',
    'result.uncertain':        'Signal was mixed — try recording 5+ seconds with less background noise for a clearer reading.',
    'result.feat.pitch':       'Pitch',
    'result.feat.rhythm':      'Rhythm',
    'result.feat.active-time': 'Active time',
    'result.feat.onset-rate':  'Onset rate',
    'result.confidence':       '{pct}% confidence',
    'urgency.label':           '{level} urgency',
    'urgency.high':            'Urgent',
    'urgency.medium':          'Moderate',
    'urgency.low':             'Gentle',

    // ---- Need meta — labels ----
    'need.hunger.label':    'Hungry',
    'need.tired.label':     'Sleepy',
    'need.pain.label':      'In pain or discomfort',
    'need.diaper.label':    'Needs a diaper change',
    'need.attention.label': 'Wants attention & comfort',
    'need.unknown.label':   'Unclear',

    // ---- Need meta — tips ----
    'need.hunger.tip.0': 'Offer the breast or a bottle — feeding is the first thing to try',
    'need.hunger.tip.1': 'Check the last feeding time; hunger cries often peak every 2–3 hours',
    'need.hunger.tip.2': 'Watch for rooting reflex: baby turning head and opening mouth',
    'need.hunger.tip.3': 'If formula-fed, prepare a fresh bottle at body temperature',
    'need.hunger.tip.4': 'After feeding, hold upright for 15–20 min to help with gas',

    'need.tired.tip.0': 'Create a calm, dim environment and reduce stimulation',
    'need.tired.tip.1': "Try gentle rocking or swaying — mimics the womb's motion",
    'need.tired.tip.2': 'Swaddle snugly to trigger the calming reflex',
    'need.tired.tip.3': 'White noise (fan, rain sounds) can mask startling stimuli',
    'need.tired.tip.4': 'Watch for sleepy cues: eye-rubbing, yawning, glazed look',

    'need.pain.tip.0': 'Check for any visible irritation: hair tourniquet on toes/fingers, diaper rash, clothing tags',
    'need.pain.tip.1': 'If accompanied by fever (>38 °C / 100.4 °F), contact a doctor promptly',
    'need.pain.tip.2': 'Try gas relief: bicycle legs, tummy massage clockwise, burping positions',
    'need.pain.tip.3': 'Colic-like crying that lasts >3 h/day, >3 days/week warrants medical evaluation',
    'need.pain.tip.4': 'Stay calm and hold baby firmly — your heartbeat soothes',

    'need.diaper.tip.0': 'Check diaper immediately — wet or soiled diapers cause skin irritation quickly',
    'need.diaper.tip.1': 'Clean thoroughly front-to-back and allow air-dry before re-diapering',
    'need.diaper.tip.2': 'Apply barrier cream (zinc oxide) if any redness is present',
    'need.diaper.tip.3': "Ensure diaper fit: snug at waist but two fingers should fit at the tummy",
    'need.diaper.tip.4': "Newborns may need 8–12 changes per day — that's completely normal",

    'need.attention.tip.0': 'Pick up and hold baby — you cannot spoil a newborn with too much holding',
    'need.attention.tip.1': 'Skin-to-skin contact regulates temperature, heart rate, and cortisol',
    'need.attention.tip.2': 'Make eye contact, smile, and talk softly — face recognition is calming',
    'need.attention.tip.3': 'Try a short walk outside; fresh air and gentle movement often help',
    'need.attention.tip.4': 'Offer a (clean) finger or pacifier to satisfy the sucking reflex',

    'need.unknown.tip.0': 'Ensure baby is comfortable and check basic needs first',
    'need.unknown.tip.1': 'Try feeding, then changing, then holding',

    // ---- History ----
    'history.title':        'Recent sessions',
    'history.clear':        'Clear',
    'session-count':        '{total} session analyzed on this device',
    'session-count.plural': '{total} sessions analyzed on this device',

    // ---- Feedback ----
    'feedback.question':         'Was this reading correct?',
    'feedback.yes':              '✓ Yes, correct',
    'feedback.no':               '✗ No, wrong',
    'feedback.picker.initial':   'What was it?',
    'feedback.picker.correct':   'What was it actually?',
    'feedback.saved':            'Saved! {count} of {total} needed to retrain.',
    'feedback.training-start':   'Thanks! Starting training with {count} samples…',
    'feedback.save-error':       'Thanks! (Save failed: {err})',

    // ---- Training panel ----
    'training.title':        '🧠 Training on-device…',
    'training.fitting':      'Fitting on your feedback…',
    'training.done-ok':      '✓ Model updated — results will improve.',
    'training.done-fail':    'Training failed: {err}',
    'training.worker-error': 'Worker error: {err}',
    'training.epoch':        'Epoch {epoch} / {epochs}',

    // ---- Toasts ----
    'toast.mic-denied':      'Microphone permission denied. Please allow access in your browser settings.',
    'toast.mic-error':       'Could not access microphone: {err}',
    'toast.too-short':       'Recording too short. Please record at least 2 seconds of crying.',
    'toast.not-audio':       'Please select an audio file.',
    'toast.analysis-failed': 'Analysis failed: {err}',

    // ---- iOS install modal ----
    'ios.modal.title':    'Install App on iOS',
    'ios.step1.title':    'Step 1: Tap Share',
    'ios.step1.desc':     'Tap the Share button at the bottom of your browser.',
    'ios.step2.title':    'Step 2: Add to Home Screen',
    'ios.step2.desc':     'Scroll down and tap "Add to Home Screen".',
    'ios.step3.title':    'Step 3: Tap Add',
    'ios.step3.desc':     'Tap "Add" in the top right corner to confirm.',
    'ios.modal.got-it':   'Got it!',

    // ---- Cloud model sync ----
    'cloud.title':            'Community Model',
    'cloud.desc':             'Share your trained model to help other parents. Your audio is never uploaded — only model weights.',
    'cloud.count':            '{count} parents contributed',
    'cloud.status.syncing':   '🔄 Syncing…',
    'cloud.status.synced':    '✓ Model synced',
    'cloud.status.uploading': '⬆ Uploading…',
    'cloud.status.error':     '⚠ Sync failed — will retry next session',

    // ---- Share ----
    'share.btn':    'Share with a parent friend',
    'share.text':   'My baby is {need} ({pct}% confidence). Hushh figured it out — free, private, no internet needed 🍼',
    'share.copied': 'Link copied to clipboard!',

    // ---- Feedback ----
    'feedback.footer.btn':     '💬 Send feedback',
    'feedback.modal.title':    'Send Feedback',
    'feedback.type.suggestion':'💡 Suggestion',
    'feedback.type.bug':       '🐛 Bug',
    'feedback.type.other':     '💬 Other',
    'feedback.label':          'What would you like to share?',
    'feedback.submit':         'Submit',
    'feedback.success.msg':    '✓ Thank you! Your feedback helps improve Hushh.',

    // ---- Medical disclaimer ----
    'disclaimer.btn':          '⚕️ Medical disclaimer',
    'disclaimer.modal.title':  '⚕️ Medical Disclaimer',
    'disclaimer.body.intro':   'This app is an assistive tool only and is not a medical device. It uses acoustic heuristics and should not replace parental judgment or medical advice.',
    'disclaimer.body.if':      'If your baby:',
    'disclaimer.symptom.0':    'Cries for more than 3 hours/day',
    'disclaimer.symptom.1':    'Has a fever above 38°C / 100.4°F',
    'disclaimer.symptom.2':    'Appears to be in severe pain',
    'disclaimer.symptom.3':    'Has any other concerning symptoms',
    'disclaimer.body.urgent':  'Please contact a pediatrician or healthcare provider immediately.',
    'disclaimer.got-it':       'Got it',
  },

  vi: {
    // ---- Header ----
    tagline:          'Hiểu điều bé yêu cần',
    'app.sr-title':   'Hushh — phân tích tiếng khóc bé trên thiết bị',
    'privacy-badge':  '🔒 AI trên thiết bị · không gửi âm thanh lên đám mây',

    // ---- Install banner ----
    'install.title': 'Thêm vào màn hình chính',
    'install.sub':   'Hoạt động ngoại tuyến · truy cập tức thì',
    'install.btn':   'Cài đặt',

    // ---- Update banner ----
    'update.title': 'Đã có phiên bản mới',
    'update.sub':   'Nhấn cập nhật để nhận cải tiến mới nhất',
    'update.btn':   'Cập nhật',

    // ---- Model badge ----
    'model.loading':      '⏳ Đang tải mô hình…',
    'model.downloading':  '⬇ Đang đồng bộ mô hình… {pct}%',
    'model.ready':        '🔒 Chỉ trên thiết bị',
    'model.personalized': 'Đã tải mô hình cá nhân hóa',
    'model.heuristic':    'Sẵn sàng (chế độ phân tích âm thanh)',
    'model.error':        '⚠️ Chế độ dự phòng',

    // ---- Record ----
    'record.hint.idle':       'Nhấn nút và giữ điện thoại gần bé',
    'record.btn.idle':        'Ghi tiếng khóc',
    'record.btn.stop':        'Nhấn để dừng',
    'record.btn.processing':  'Đang xử lý…',
    'record.hint.recording':  'Đang ghi… tối đa 30 giây',
    'record.hint.processing': 'Đang phân tích trên thiết bị…',
    'audio-ready.recording':  'Đã ghi xong ({dur}s)',

    // ---- Upload / analyze ----
    or:                'hoặc',
    'upload.btn':      'Tải file âm thanh (.wav · .mp3 · .m4a · .webm)',
    'upload.btn.aria': 'Tải file âm thanh',
    'analyze.btn':         '🔍 Phân tích tiếng khóc',
    'analyze.btn.loading': '⏳ Đang phân tích…',
    'analyze.btn.aria':    'Phân tích tiếng khóc của bé',

    // ---- Processing steps ----
    'step.features': 'Đang trích xuất đặc trưng âm thanh…',
    'step.classify': 'Đang chạy bộ phân loại trên thiết bị…',
    'step.prepare':  'Đang chuẩn bị kết quả…',

    // ---- Result card ----
    'result.what-to-do':       'Cần làm gì',
    'result.signal-breakdown': 'Phân tích tín hiệu',
    'result.privacy-note':     'Tất cả phân tích chạy cục bộ trên thiết bị. Không có âm thanh nào được truyền đi.',
    'result.uncertain':        'Tín hiệu không rõ — thử ghi trên 5 giây với ít tiếng ồn nền hơn để có kết quả chính xác hơn.',
    'result.feat.pitch':       'Cao độ',
    'result.feat.rhythm':      'Nhịp điệu',
    'result.feat.active-time': 'Thời gian khóc',
    'result.feat.onset-rate':  'Tần suất khởi phát',
    'result.confidence':       'độ tin cậy {pct}%',
    'urgency.label':           'mức độ {level}',
    'urgency.high':            'khẩn cấp',
    'urgency.medium':          'vừa phải',
    'urgency.low':             'nhẹ nhàng',

    // ---- Need meta — labels ----
    'need.hunger.label':    'Đói bụng',
    'need.tired.label':     'Buồn ngủ',
    'need.pain.label':      'Đau hoặc khó chịu',
    'need.diaper.label':    'Cần thay tã',
    'need.attention.label': 'Muốn được chú ý',
    'need.unknown.label':   'Chưa rõ',

    // ---- Need meta — tips ----
    'need.hunger.tip.0': 'Cho bú hoặc cho uống sữa — đây là điều đầu tiên cần thử',
    'need.hunger.tip.1': 'Kiểm tra lần bú cuối; tiếng khóc đói thường xuất hiện mỗi 2–3 giờ',
    'need.hunger.tip.2': 'Chú ý phản xạ tìm kiếm: bé quay đầu và mở miệng',
    'need.hunger.tip.3': 'Nếu bú bình, chuẩn bị bình sữa mới ở nhiệt độ cơ thể',
    'need.hunger.tip.4': 'Sau khi bú, giữ bé thẳng đứng 15–20 phút để giúp tiêu hóa khí',

    'need.tired.tip.0': 'Tạo môi trường yên tĩnh, ánh sáng mờ và giảm kích thích',
    'need.tired.tip.1': 'Thử đung đưa hoặc ẵm nhẹ — bắt chước chuyển động trong bụng mẹ',
    'need.tired.tip.2': 'Quấn chặt bé để kích hoạt phản xạ bình tĩnh',
    'need.tired.tip.3': 'Tiếng ồn trắng (quạt, tiếng mưa) có thể che khuất những âm thanh gây giật mình',
    'need.tired.tip.4': 'Chú ý dấu hiệu buồn ngủ: dụi mắt, ngáp, ánh mắt mờ nhạt',

    'need.pain.tip.0': 'Kiểm tra kích ứng: tóc quấn quanh ngón chân/tay, hăm tã, nhãn quần áo',
    'need.pain.tip.1': 'Nếu kèm sốt (>38°C / 100.4°F), liên hệ bác sĩ ngay',
    'need.pain.tip.2': 'Thử giảm đau bụng: đạp chân như đạp xe, xoa bụng theo chiều kim đồng hồ, vỗ ợ hơi',
    'need.pain.tip.3': 'Tiếng khóc dạng colic kéo dài >3 giờ/ngày, >3 ngày/tuần cần được khám bác sĩ',
    'need.pain.tip.4': 'Giữ bình tĩnh và ôm bé chắc chắn — nhịp tim của bạn giúp bé an tâm',

    'need.diaper.tip.0': 'Kiểm tra tã ngay — tã ướt hoặc bẩn gây kích ứng da rất nhanh',
    'need.diaper.tip.1': 'Vệ sinh kỹ từ trước ra sau và để khô thoáng trước khi mặc tã mới',
    'need.diaper.tip.2': 'Thoa kem bảo vệ (zinc oxide) nếu da có dấu hiệu đỏ',
    'need.diaper.tip.3': 'Đảm bảo tã vừa vặn: khít ở eo nhưng có thể lồng hai ngón tay vào bụng',
    'need.diaper.tip.4': 'Trẻ sơ sinh có thể cần thay 8–12 tã mỗi ngày — hoàn toàn bình thường',

    'need.attention.tip.0': 'Bế và ôm bé — bé sơ sinh không thể bị hư vì được bồng bế quá nhiều',
    'need.attention.tip.1': 'Tiếp xúc da kề da giúp điều hòa nhiệt độ, nhịp tim và cortisol',
    'need.attention.tip.2': 'Nhìn vào mắt bé, mỉm cười và nói chuyện nhẹ nhàng — nhận ra khuôn mặt sẽ xoa dịu bé',
    'need.attention.tip.3': 'Thử đi dạo ngắn ngoài trời; không khí và chuyển động nhẹ thường giúp ích',
    'need.attention.tip.4': 'Cho bé ngón tay sạch hoặc núm vú giả để thỏa mãn phản xạ bú',

    'need.unknown.tip.0': 'Đảm bảo bé được thoải mái và kiểm tra các nhu cầu cơ bản trước',
    'need.unknown.tip.1': 'Thử cho bú, rồi thay tã, rồi bế bé',

    // ---- History ----
    'history.title':        'Phiên gần đây',
    'history.clear':        'Xóa',
    'session-count':        '{total} phiên đã phân tích trên thiết bị này',
    'session-count.plural': '{total} phiên đã phân tích trên thiết bị này',

    // ---- Feedback ----
    'feedback.question':        'Kết quả này có chính xác không?',
    'feedback.yes':             '✓ Đúng, chính xác',
    'feedback.no':              '✗ Không, sai',
    'feedback.picker.initial':  'Bé đang cần gì?',
    'feedback.picker.correct':  'Thực ra bé đang cần gì?',
    'feedback.saved':           'Đã lưu! {count} trong {total} mẫu cần để huấn luyện lại.',
    'feedback.training-start':  'Cảm ơn! Bắt đầu huấn luyện với {count} mẫu…',
    'feedback.save-error':      'Cảm ơn! (Lưu thất bại: {err})',

    // ---- Training panel ----
    'training.title':        '🧠 Đang huấn luyện trên thiết bị…',
    'training.fitting':      'Điều chỉnh theo phản hồi của bạn…',
    'training.done-ok':      '✓ Mô hình đã cập nhật — kết quả sẽ cải thiện.',
    'training.done-fail':    'Huấn luyện thất bại: {err}',
    'training.worker-error': 'Lỗi worker: {err}',
    'training.epoch':        'Vòng {epoch} / {epochs}',

    // ---- Toasts ----
    'toast.mic-denied':      'Quyền microphone bị từ chối. Vui lòng cho phép truy cập trong cài đặt trình duyệt.',
    'toast.mic-error':       'Không thể truy cập microphone: {err}',
    'toast.too-short':       'Bản ghi quá ngắn. Vui lòng ghi ít nhất 2 giây tiếng khóc.',
    'toast.not-audio':       'Vui lòng chọn file âm thanh.',
    'toast.analysis-failed': 'Phân tích thất bại: {err}',

    // ---- iOS install modal ----
    'ios.modal.title':    'Cài đặt ứng dụng trên iOS',
    'ios.step1.title':    'Bước 1: Nhấn Chia sẻ',
    'ios.step1.desc':     'Nhấn nút Chia sẻ ở dưới cùng trình duyệt.',
    'ios.step2.title':    'Bước 2: Thêm vào màn hình chính',
    'ios.step2.desc':     'Cuộn xuống và nhấn "Thêm vào màn hình chính".',
    'ios.step3.title':    'Bước 3: Nhấn Thêm',
    'ios.step3.desc':     'Nhấn "Thêm" ở góc trên bên phải để xác nhận.',
    'ios.modal.got-it':   'Hiểu rồi!',

    // ---- Cloud model sync ----
    'cloud.title':            'Mô hình cộng đồng',
    'cloud.desc':             'Chia sẻ mô hình đã huấn luyện để giúp cha mẹ khác. Âm thanh không bao giờ được tải lên — chỉ có trọng số mô hình.',
    'cloud.count':            '{count} cha mẹ đã đóng góp',
    'cloud.status.syncing':   '🔄 Đang đồng bộ…',
    'cloud.status.synced':    '✓ Đã đồng bộ',
    'cloud.status.uploading': '⬆ Đang tải lên…',
    'cloud.status.error':     '⚠ Đồng bộ thất bại — sẽ thử lại sau',

    // ---- Share ----
    'share.btn':    'Chia sẻ với bạn bè có con nhỏ',
    'share.text':   'Bé của mình đang {need} ({pct}% độ tin cậy). Hushh phân tích được — miễn phí, riêng tư, không cần internet 🍼',
    'share.copied': 'Đã sao chép liên kết!',

    // ---- Feedback ----
    'feedback.footer.btn':     '💬 Gửi phản hồi',
    'feedback.modal.title':    'Gửi Phản Hồi',
    'feedback.type.suggestion':'💡 Góp ý',
    'feedback.type.bug':       '🐛 Lỗi',
    'feedback.type.other':     '💬 Khác',
    'feedback.label':          'Bạn muốn chia sẻ điều gì?',
    'feedback.submit':         'Gửi',
    'feedback.success.msg':    '✓ Cảm ơn bạn! Phản hồi của bạn giúp cải thiện Hushh.',

    // ---- Medical disclaimer ----
    'disclaimer.btn':          '⚕️ Tuyên bố y tế',
    'disclaimer.modal.title':  '⚕️ Tuyên Bố Y Tế',
    'disclaimer.body.intro':   'Ứng dụng này chỉ là công cụ hỗ trợ và không phải thiết bị y tế. Ứng dụng sử dụng phân tích âm thanh heuristic và không thể thay thế phán đoán của cha mẹ hay lời khuyên từ bác sĩ.',
    'disclaimer.body.if':      'Nếu bé của bạn:',
    'disclaimer.symptom.0':    'Khóc hơn 3 giờ mỗi ngày',
    'disclaimer.symptom.1':    'Sốt trên 38°C / 100.4°F',
    'disclaimer.symptom.2':    'Có vẻ đang đau nghiêm trọng',
    'disclaimer.symptom.3':    'Có bất kỳ triệu chứng đáng lo ngại nào khác',
    'disclaimer.body.urgent':  'Vui lòng liên hệ ngay bác sĩ nhi khoa hoặc nhà cung cấp dịch vụ y tế.',
    'disclaimer.got-it':       'Đã hiểu',
  }
};

const SUPPORTED = ['en', 'vi'];

function detectLang() {
  // localStorage can throw (private mode, storage disabled) and doesn't exist in Node
  let saved = null;
  try { saved = globalThis.localStorage?.getItem('hushh-lang'); } catch { /* unavailable */ }
  if (saved && SUPPORTED.includes(saved)) return saved;
  const browser = (globalThis.navigator?.language || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED.includes(browser) ? browser : 'en';
}

let _current = detectLang();

export function t(key, vars = {}) {
  const str = LANGS[_current]?.[key] ?? LANGS.en[key] ?? key;
  if (!vars || !Object.keys(vars).length) return str;
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), str);
}

export function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return;
  _current = lang;
  try { globalThis.localStorage?.setItem('hushh-lang', lang); } catch { /* unavailable */ }
  if (globalThis.document) document.documentElement.lang = lang;
}

export function getLanguage() { return _current; }
export const SUPPORTED_LANGS = SUPPORTED;
