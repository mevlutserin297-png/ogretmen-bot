import json
import io
import os
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, MessageHandler, filters
from docx import Document

# Bot Token'ı Render üzerindeki Environment Variable alanından alacak
BOT_TOKEN = os.environ.get("BOT_TOKEN")

async def web_app_data_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    raw_data = update.message.web_app_data.data
    data = json.loads(raw_data)
    
    evrak_turu = data.get("evrakTuru", "sok")
    okul_adi = data.get("okulAdi", "Belirtilmedi").upper()
    sinif = data.get("sinif", "Belirtilmedi")
    ogretmen_adi = data.get("ogretmenAdi", "Belirtilmedi")
    detaylar = data.get("detaylar", "Gündem maddeleri görüşülmüştür.")

    doc = Document()
    
    if evrak_turu == "sok":
        dosya_adi = f"SOK_Tutanagi_{sinif}.docx"
        doc.add_heading(f"{okul_adi}\n{sinif} SINIFI ŞÖK TOPLANTI TUTANAĞI", level=1)
        doc.add_paragraph(f"Sınıf Rehber Öğretmeni: {ogretmen_adi}")
        doc.add_heading("Alınan Kararlar ve Değerlendirmeler", level=2)
        doc.add_paragraph(detaylar)
        
    elif evrak_turu == "bep":
        dosya_adi = f"BEP_Plani_{sinif}.docx"
        doc.add_heading(f"{okul_adi}\nBİREYSELLEŞTİRİLMİŞ EĞİTİM PLANI (BEP)", level=1)
        doc.add_paragraph(f"Sorumlu Öğretmen: {ogretmen_adi} | Sınıf: {sinif}")
        doc.add_heading("Eğitsel Amaçlar ve Performans Notları", level=2)
        doc.add_paragraph(detaylar)
        
    else:
        dosya_adi = f"Evrak_{sinif}.docx"
        doc.add_heading(f"{okul_adi} - EĞİTİM DOKÜMANI", level=1)
        doc.add_paragraph(f"Öğretmen: {ogretmen_adi} | Sınıf: {sinif}")
        doc.add_paragraph(detaylar)

    target_stream = io.BytesIO()
    doc.save(target_stream)
    target_stream.seek(0)
    
    await update.message.reply_text("⏳ Evrağınız Word formatında hazırlanıyor...")
    await update.message.reply_document(
        document=target_stream,
        filename=dosya_adi,
        caption=f"✅ {okul_adi} - {sinif} belgeniz hazırlandı."
    )

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, web_app_data_handler))
    print("Bot aktif, öğretmenlerin evrak talepleri bekleniyor...")
    app.run_polling()

if __name__ == "__main__":
    main()
