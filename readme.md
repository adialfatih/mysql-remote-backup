# 🗄️ MySQL Backup Tool (Node.js + Express + WebSocket)

Aplikasi sederhana untuk melakukan **backup database MySQL** melalui antarmuka web interaktif.
Dibangun menggunakan **Node.js**, **Express**, **MySQL2 (Pool Connection)**, dan **WebSocket** dengan tampilan **SweetAlert2** untuk progress bar realtime.

---

## 🚀 Fitur Utama

* 🔌 **Input koneksi dinamis**
  User dapat memasukkan Host, Username, Password, dan Nama Database langsung dari form web.

* ✅ **Validasi koneksi otomatis**
  Sebelum backup dimulai, sistem akan melakukan pengecekan koneksi terlebih dahulu.

* 🧱 **Backup terpisah antara Struktur & Data**

  * File pertama: Struktur tabel lengkap (`_schema_YYYYMMDD_HHMMSS.sql`)
  * File kedua: Isi record (`_data_YYYYMMDD_HHMMSS.sql`)

* 📊 **Progress bar realtime dengan SweetAlert2**
  Menampilkan status proses dan persentase berjalan secara live menggunakan WebSocket.

* 💾 **Penyimpanan otomatis hasil backup**
  Semua hasil disimpan di folder:

  ```
  public/backup/database/
  ```

* 🧹 **Manajemen file backup**
  Halaman khusus untuk melihat semua hasil backup dengan tabel berisi:

  ```
  NO | NAMA DB | TANGGAL BACKUP | JENIS (Struktur/Data) | Aksi
  ```

  Dilengkapi tombol **Unduh** dan **Hapus** (dengan konfirmasi SweetAlert).

---

## 🏗️ Struktur Project

```
.
├── app.js
├── package.json
├── .gitignore
└── public/
    ├── index.html        # Form input & tombol "Simpan & Backup"
    ├── backups.html      # Daftar hasil backup
    ├── script.js
    ├── styles.css
    └── backup/
        └── database/     # Folder hasil backup SQL
```

---

## ⚙️ Cara Menjalankan

```bash
npm install
npm start
```

Buka browser dan akses:

```
http://localhost:3000
```

Isi form dengan data koneksi MySQL kamu, lalu klik **Simpan & Backup**.

Untuk melihat daftar hasil backup:

```
http://localhost:3000/backups.html
```

---

## 🧾 Catatan

* Folder `public/backup/database` diabaikan oleh Git (lihat `.gitignore`).
* File hasil backup dapat dihapus melalui halaman `backups.html`.
* Format file hasil backup:

  ```
  {database}_schema_YYYYMMDD_HHMMSS.sql
  {database}_data_YYYYMMDD_HHMMSS.sql
  ```

---

## 🛠️ Teknologi yang Digunakan

* Node.js
* Express.js
* MySQL2 (Promise Pool Connection)
* WebSocket (ws)
* SweetAlert2
* HTML, CSS, dan Vanilla JS

---

## 📄 Lisensi

Proyek ini dibuat untuk kebutuhan pribadi / internal.
Boleh digunakan dan dimodifikasi secara bebas selama menyertakan atribusi.

---

> 💡 **Dibuat oleh:** Adi (Grafamedia)
> **Versi:** 1.0.0
> **Deskripsi:** Web-based MySQL Backup Tool dengan progress realtime.
