const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// AŞAĞIDAKİ SATIRA KENDİ BOT TOKENİNİ YAPIŞTIR
const BOT_TOKEN = "8958865902:AAF-3yEeTEhaObOBm0IqHc9q8kvc5gTpnRU";

const database = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const DB_BACKED_TYPES = ['sene_basi_zumre', 'sok_tutanagi', 'veli_toplantisi'];
const FORM_ONLY_TYPES = [
  'veli_izin_dilekcesi', 'bep_taslagi', 'oturma_plani',
  'baskanlik_secimi', 'rehberlik_sevk', 'ders_kesim_raporu',
  'veli_gorusme', 'yillik_plan', 'gunluk_plan'
];

// Telegram'a dosya gönderme fonksiyonu (Garantili yöntem)
function sendToTelegram(token, chatId, buffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----TelegramBotBoundary' + Math.random().toString(16).slice(2);
    const head = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="chat_id"`,
      '', chatId,
      `--${boundary}`,
      `Content-Disposition: form-data; name="document"; filename="${filename}"`,
      `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
      '', ''
    ].join('\r\n');
    const tail = `\r\n--${boundary}--\r\n`;
    
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/sendDocument`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(head) + buffer.length + Buffer.byteLength(tail)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => res.statusCode === 200 ? resolve(data) : reject(new Error(data)));
    });
    
    req.on('error', reject);
    req.write(head);
    req.write(buffer);
    req.write(tail);
    req.end();
  });
}

app.post('/evrak-olustur', async (req, res) => {
  try {
    const data = req.body;
    if (!data.evrak_turu) return res.status(400).json({ message: 'Evrak türü zorunludur.' });

    let hazirMetinler = { gundem_maddeleri: [], gorusmeler: [], alinan_kararlar: [] };

    if (DB_BACKED_TYPES.includes(data.evrak_turu)) {
      if (!data.brans) return res.status(400).json({ message: 'Branş zorunludur.' });
      if (!database[data.brans] || !database[data.brans][data.evrak_turu]) {
        return res.status(404).json({ message: 'Sistemde bu evrak tanımlı değil.' });
      }
      hazirMetinler = database[data.brans][data.evrak_turu];
    }

    const templatePath = path.resolve(__dirname, 'templates', `${data.evrak_turu}_sablon.docx`);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ message: `Şablon bulunamadı.` });

    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      nullGetter: function () { return ''; }
    });

    const renderData = {
      EGITIM_YILI: data.egitim_yili || '2026-2027',
      OKUL_ADI: data.okul_adi || '',
      TOPLANTI_TARIHI: data.toplanti_tarihi || '',
      TOPLANTI_SAATI: data.toplanti_saati || '',
      TOPLANTI_YERI: data.toplanti_yeri || '',
      ZUMRE_BASKANI: data.zumre_baskani || '',
      OKUL_MUDURU: data.okul_muduru || '',
      SINIF: data.sinif || '',
      gundem_maddeleri: hazirMetinler.gundem_maddeleri || [],
      gorusmeler: hazirMetinler.gorusmeler || [],
      alinan_kararlar: hazirMetinler.alinan_kararlar || [],
      ogretmenler: (data.ogretmenler || []).map((ad, i) => ({ sira: (i + 1).toString(), ogretmen_adi: ad })),
      ogrenciler: (data.ogrenciler || []).map((ad, i) => ({ sira: (i + 1).toString(), ogrenci_adi: ad }))
    };

    doc.render(renderData);
    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    const fileName = data.brans ? `${data.evrak_turu}_${data.brans}.docx` : `${data.evrak_turu}.docx`;

    if (!data.telegram_user_id) {
        return res.status(400).json({ message: "Telegram kullanıcı kimliğiniz alınamadı." });
    }
    
    if (BOT_TOKEN === "BURAYA_KENDI_TOKENINI_YAPISTIR") {
        return res.status(500).json({ message: "Bot Token girilmemiş! Lütfen server.js içini kontrol edin." });
    }

    await sendToTelegram(BOT_TOKEN, data.telegram_user_id, buf, fileName);
    res.json({ message: "Evrak başarıyla Telegram'a gönderildi!" });

  } catch (error) {
    console.error("Hata:", error);
    res.status(500).json({ message: "İşlem sırasında bir hata oluştu." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor...`));
