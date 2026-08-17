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

// BOT TOKENİNİ BURAYA YAZ
const BOT_TOKEN = "BURAYA_BOT_TOKEN_GELECEK";

const database = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const DB_BACKED_TYPES = ['sene_basi_zumre', 'sok_tutanagi', 'veli_toplantisi'];

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
      if (!database[data.brans] || !database[data.brans][data.evrak_turu]) {
        return res.status(404).json({ message: 'Sistemde bu evrak tanımlı değil.' });
      }
      hazirMetinler = database[data.brans][data.evrak_turu];
    }

    const templatePath = path.resolve(__dirname, 'templates', `${data.evrak_turu}_sablon.docx`);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ message: `Şablon bulunamadı: ${data.evrak_turu}` });

    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      nullGetter: function () { return ''; }
    });

    const ogretmenAdi = 'Mevlüt Hoca'; // Sabitlendi
    const tarihDegeri = data.toplanti_tarihi || data.tarih || new Date().toLocaleDateString('tr-TR');

    // Dinamik listeyi evrak türüne göre doğru array'e yönlendirme
    let ogretmenler = [], ogrenciler = [], hedefler = [], maddeler = [];
    if (data.evrak_modu === 'teacher' && data.dinamik_liste) {
        ogretmenler = data.dinamik_liste.map((ad, i) => ({ sira: (i + 1).toString(), ogretmen_adi: ad }));
    }
    if (data.evrak_modu === 'student' && data.dinamik_liste) {
        ogrenciler = data.dinamik_liste.map((ad, i) => ({ sira: (i + 1).toString(), ogrenci_adi: ad }));
    }
    if (data.evrak_turu === 'bep_taslagi' && data.dinamik_liste) {
        hedefler = data.dinamik_liste.map((metin, i) => ({ hedef_no: (i + 1).toString(), hedef_metni: metin }));
    }
    if (['ders_kesim_raporu', 'yillik_plan', 'gunluk_plan'].includes(data.evrak_turu) && data.dinamik_liste) {
        maddeler = data.dinamik_liste.map((metin, i) => ({ sira: (i + 1).toString(), madde_metni: metin }));
    }

    const renderData = {
      EGITIM_YILI: data.egitim_yili || '2026-2027',
      OKUL_ADI: data.okul_adi || '',
      OKUL_MUDURU: data.okul_muduru || '',
      SINIF: data.sinif || '',
      TOPLANTI_TARIHI: tarihDegeri,
      TOPLANTI_SAATI: data.toplanti_saati || '',
      TOPLANTI_YERI: data.toplanti_yeri || 'Öğretmenler Odası',
      TARIH: tarihDegeri,
      
      ZUMRE_BASKANI: ogretmenAdi,
      HAZIRLAYAN_OGRETMEN: ogretmenAdi,
      SEVK_EDEN_OGRETMEN: ogretmenAdi,
      SINIF_REHBER_OGRETMENI: ogretmenAdi,

      OGRENCI_ADI: data.ogrenci_adi || '',
      VELI_ADI: data.veli_adi || '',
      SEVK_NEDENI: data.aciklama_nedeni || '',
      IZIN_NEDENI: data.aciklama_nedeni || '',
      GORUSME_KONUSU: data.aciklama_nedeni || '',
      TANI: data.tani || '',
      DONEM: data.donem || '',
      DERS_ADI: data.ders_adi || 'Matematik',
      KONU: data.konu || '',
      IZIN_TARIHI: data.izin_tarihi || tarihDegeri,

      gundem_maddeleri: hazirMetinler.gundem_maddeleri || [],
      gorusmeler: hazirMetinler.gorusmeler || [],
      alinan_kararlar: hazirMetinler.alinan_kararlar || [],
      
      ogretmenler: ogretmenler,
      ogrenciler: ogrenciler,
      hedefler: hedefler,
      maddeler: maddeler
    };

    doc.render(renderData);
    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    const fileName = data.brans ? `${data.evrak_turu}_${data.brans}.docx` : `${data.evrak_turu}.docx`;

    if (!data.telegram_user_id) {
        return res.status(400).json({ message: "Telegram ID eksik." });
    }

    await sendToTelegram(BOT_TOKEN, data.telegram_user_id, buf, fileName);
    res.json({ message: "Evrak başarıyla Telegram'a gönderildi!" });

  } catch (error) {
    console.error("Hata:", error);
    res.status(500).json({ message: "İşlem sırasında hata oluştu." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor...`));
