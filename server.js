const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const app = express();
app.use(cors());
app.use(express.json());
// public klasöründeki index.html (Telegram Web App arayüzü) otomatik servis edilir
app.use(express.static(path.join(__dirname, 'public')));

const database = JSON.parse(fs.readFileSync('./database.json', 'utf8'));

// Bu türler branşa göre veritabanından hazır gündem/karar metni çeker (öğretmen odaklı tutanaklar)
const DB_BACKED_TYPES = ['sene_basi_zumre', 'sok_tutanagi', 'veli_toplantisi'];
// Bu türler doğrudan formdan doldurulur, veritabanı gerektirmez (öğrenci odaklı / tekil evraklar)
const FORM_ONLY_TYPES = [
  'veli_izin_dilekcesi', 'bep_taslagi', 'oturma_plani',
  'baskanlik_secimi', 'rehberlik_sevk', 'ders_kesim_raporu',
  'veli_gorusme', 'yillik_plan', 'gunluk_plan'
];

app.post('/evrak-olustur', (req, res) => {
  try {
    const {
      brans,
      evrak_turu,
      egitim_yili,
      okul_adi,
      toplanti_tarihi,
      toplanti_saati,
      toplanti_yeri,
      zumre_baskani,
      okul_muduru,
      ogretmenler,
      ogrenciler,
      sinif,
      ogrenci_adi,
      veli_adi,
      izin_tarihi,
      izin_nedeni,
      tani,
      hazirlayan_ogretmen,
      tarih,
      hedefler,
      sinif_rehber_ogretmeni,
      secilen_baskan,
      sevk_nedeni,
      sevk_eden_ogretmen,
      ders_adi,
      donem,
      konu,
      gorusme_konusu,
      gorusme_tarihi,
      maddeler
    } = req.body;

    if (!evrak_turu) {
      return res.status(400).json({ message: 'Evrak türü zorunludur.' });
    }

    let hazirMetinler = { gundem_maddeleri: [], gorusmeler: [], alinan_kararlar: [] };

    if (DB_BACKED_TYPES.includes(evrak_turu)) {
      if (!brans) {
        return res.status(400).json({ message: 'Bu evrak türü için branş seçimi zorunludur.' });
      }
      if (!database[brans] || !database[brans][evrak_turu]) {
        return res.status(404).json({ message: 'Bu branş veya evrak türü henüz sistemde tanımlı değil.' });
      }
      hazirMetinler = database[brans][evrak_turu];
    } else if (!FORM_ONLY_TYPES.includes(evrak_turu)) {
      return res.status(404).json({ message: 'Bilinmeyen evrak türü: ' + evrak_turu });
    }

    const templatePath = path.resolve(__dirname, 'templates', `${evrak_turu}_sablon.docx`);

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ message: `Şablon dosyası bulunamadı: ${evrak_turu}_sablon.docx` });
    }

    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      nullGetter: function () { return ''; } // eksik alan varsa hata vermek yerine boş bırak
    });

    const renderData = {
      EGITIM_YILI: egitim_yili || '2026-2027',
      OKUL_ADI: okul_adi || '',
      TOPLANTI_TARIHI: toplanti_tarihi || '',
      TOPLANTI_SAATI: toplanti_saati || '',
      TOPLANTI_YERI: toplanti_yeri || '',
      ZUMRE_BASKANI: zumre_baskani || '',
      OKUL_MUDURU: okul_muduru || '',
      SINIF: sinif || '',
      OGRENCI_ADI: ogrenci_adi || '',
      VELI_ADI: veli_adi || '',
      IZIN_TARIHI: izin_tarihi || '',
      IZIN_NEDENI: izin_nedeni || '',
      TANI: tani || '',
      HAZIRLAYAN_OGRETMEN: hazirlayan_ogretmen || '',
      TARIH: tarih || toplanti_tarihi || '',
      SINIF_REHBER_OGRETMENI: sinif_rehber_ogretmeni || '',
      SECILEN_BASKAN: secilen_baskan || '',
      SEVK_NEDENI: sevk_nedeni || '',
      SEVK_EDEN_OGRETMEN: sevk_eden_ogretmen || '',
      DERS_ADI: ders_adi || '',
      DONEM: donem || '',
      KONU: konu || '',
      GORUSME_KONUSU: gorusme_konusu || '',
      GORUSME_TARIHI: gorusme_tarihi || '',
      maddeler: (maddeler || []).map((m, i) => ({ sira: (i + 1).toString(), madde_metni: m })),
      gundem_maddeleri: hazirMetinler.gundem_maddeleri || [],
      gorusmeler: hazirMetinler.gorusmeler || [],
      alinan_kararlar: hazirMetinler.alinan_kararlar || [],
      ogretmenler: (ogretmenler || []).map((ad, i) => ({ sira: (i + 1).toString(), ogretmen_adi: ad })),
      ogrenciler: (ogrenciler || []).map((ad, i) => ({ sira: (i + 1).toString(), ogrenci_adi: ad })),
      hedefler: (hedefler || []).map((h, i) => ({ hedef_no: (i + 1).toString(), hedef_metni: h }))
    };

    doc.render(renderData);

    const buf = doc.getZip().generate({ type: 'nodebuffer' });

    const fileName = brans ? `${evrak_turu}_${brans}.docx` : `${evrak_turu}.docx`;
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buf);

  } catch (error) {
    console.error("Evrak oluşturulurken hata:", error);
    if (error.properties && error.properties.errors instanceof Array) {
      const errorMessages = error.properties.errors
        .map((e) => e.properties && e.properties.explanation)
        .join('\n');
      console.error("Şablon Hataları:\n" + errorMessages);
    }
    res.status(500).json({ message: "Evrak oluşturulamadı. Şablon veya veri hatası olabilir." });
  }
});

// Basit sağlık kontrolü
app.get('/', (req, res) => {
  res.send('Evrak motoru çalışıyor. Web App için /index.html adresine gidin.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor... Evrak motoru hazır!`);
});
