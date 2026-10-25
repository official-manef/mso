# Demo fork: official-manef/mso

Fork ini adalah **demo publik** dari [`rahmanef63/mso`](https://github.com/rahmanef63/mso),
bukan rilis produksi dan bukan sumber instalasi. Perbedaan dengan upstream:

## 1. PTY dihapus

Terminal PTY asli (`node-pty` / shell interaktif di host) dihapus dari fork demo. Demo
tidak menjalankan shell interaktif nyata; permukaan shell dirender sebagai UI demo.
Jangan menganggap capability shell di demo sebagai bukti capability shell di upstream.

## 2. Build demo

Frontend/backend dibangun sebagai build demo (tanpa layanan host nyata, tanpa kredensial
operator). Deploy dilakukan lewat Vercel deploy hook, bukan lewat `scripts/install.sh`
atau `mso update`.

## 3. Auto-sync harian

Workflow [`.github/workflows/sync-upstream.yml`](../.github/workflows/sync-upstream.yml)
menjalankan sinkronisasi terjadwal:

- cron `0 3 * * *` (03:00 UTC setiap hari) dan `workflow_dispatch` manual;
- checkout `main` dengan `fetch-depth: 0`, tambah remote
  `https://github.com/rahmanef63/mso.git`, fetch, lalu
  `git merge --no-edit upstream/main` dan push ke `origin main`;
- memakai `GITHUB_TOKEN` bawaan (`permissions: contents: write`).

Setelah itu [`.github/workflows/deploy-hook.yml`](../.github/workflows/deploy-hook.yml)
trip dari `workflow_run` sync (atau manual) dan POST ke `VERCEL_DEPLOY_HOOK_URL`.

## 4. Konflik = gagal, bukan ditimpa

Merge **tidak** memakai `|| true` atau strategi `-X ours/theirs`. Jika upstream
berubah di file yang sengaja berbeda di fork demo (mis. penghapusan PTY, konfigurasi
build demo), job sync **gagal dan tampil merah di UI Actions**. Perbaiki manual:
selesaikan konflik di `main`, lalu jalankan ulang workflow. Fork demo tidak boleh
menutupi divergensi dengan menimpa perubahan upstream.

## Menjaga fork ini

1. `git remote add upstream https://github.com/rahmanef63/mso.git` (sekali saja).
2. `git fetch upstream main && git merge upstream/main` lokal untuk melihat konflik lebih awal.
3. Simpan divergensi demo sekecil mungkin; setiap konflik berulang adalah sinyal bahwa
   patch demo perlu dirapikan atau dipindah ke lapisan konfigurasi.

Dokumen ini collateral demo, bukan otoritas teknis MSO. Otoritas tetap
[`ARCHITECTURE.md`](./ARCHITECTURE.md) dan [`CLAUDE.md`](../CLAUDE.md).
